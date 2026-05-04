import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentEvent,
  AgentInfo,
  Conversation,
  FileNode,
  Message,
  Project,
  ReasoningEffort,
  RefImage,
} from '@ogf/contracts';
import type { PendingSliceEntry, QuestionFormAnswers } from '@ogf/contracts';
import {
  cancelRun,
  clearPendingSlices,
  createConversation,
  createProject,
  createRun,
  deleteFile,
  fetchAgents,
  fetchAnalyze,
  fetchConversations,
  fetchFileContent,
  fetchFileTree,
  fetchMessages,
  fetchPendingSlices,
  fetchProjects,
  fetchRefs,
  openProject,
  removeConversation,
  removeProject,
  subscribeRun,
  writeFileContent,
} from './lib/api.js';
import { Turn, type TurnStatus } from './components/Turn.js';
import { SpecProgressCard } from './components/SpecProgressCard.js';
import { FileTree } from './components/FileTree.js';
import { FileEditor } from './components/FileEditor.js';
import { SceneEditor } from './components/SceneEditor.js';
import { PlayPane } from './components/PlayPane.js';
import { Sidebar, type Theme } from './components/Sidebar.js';
// v2: StatusBar removed from the layout. Component file kept for now in
// case we want to revive it as a tooltip / overlay later.
// import { StatusBar } from './components/StatusBar.js';
import { Dropzone, type DropzoneHandle } from './components/Dropzone.js';
import { FolderPickerModal } from './components/FolderPickerModal.js';
import { PendingChangesModal } from './components/PendingChangesModal.js';
import { ImportCodexSessionModal } from './components/ImportCodexSessionModal.js';
import { I } from './components/icons.js';
import { useDialog } from './lib/dialog.js';

interface UiTurn {
  id: string;
  userText: string;
  events: AgentEvent[];
  status: TurnStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

const LS_PROJECT = 'ogf:lastProject';
const LS_CONVERSATION = 'ogf:lastConversation';
const LS_THEME = 'ogf:theme';
const LS_SPLIT = 'ogf:split';
const LS_DENSITY = 'ogf:density';
const LS_TREE_W = 'ogf:treeWidth';
const LS_TREE_COLLAPSED = 'ogf:treeCollapsed';
const LS_SIDEBAR_W = 'ogf:sidebarWidth';
const LS_LAST_FILE_PREFIX = 'ogf:lastFile:'; // per-project: { tab, relPath }

type Tab = 'assets' | 'scenes' | 'play';
type Density = 'compact' | 'regular' | 'comfy';

export function App() {
  const { confirm: askConfirm, notify } = useDialog();

  // Theme — v2 default is LIGHT (Claude / Linear / Vercel direction).
  // Existing users who explicitly chose 'dark' keep their preference via localStorage.
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(LS_THEME) as Theme) ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  // Density
  const [density, setDensity] = useState<Density>(
    () => (localStorage.getItem(LS_DENSITY) as Density) ?? 'regular',
  );
  useEffect(() => {
    document.body.dataset.density = density;
    localStorage.setItem(LS_DENSITY, density);
  }, [density]);

  // Agent
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);

  // Project
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [showOpenModal, setShowOpenModal] = useState(false);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Chat
  const [turns, setTurns] = useState<UiTurn[]>([]);
  // Defaults chosen for OGF use case: gpt-5.5 + xhigh reasoning. The user
  // is doing real game refactoring (Sengoku, megaman_new) where rule-following
  // and multi-file coherence matter more than latency or token cost.
  const [model, setModel] = useState<string>('gpt-5.5');
  const [reasoning, setReasoning] = useState<ReasoningEffort>('xhigh');
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  // Form ids the user has submitted in this conversation. Locks the form
  // card so it stays visible in chat history but can't be re-submitted.
  // Reset by the useEffect below whenever the active conversation changes.
  const [submittedForms, setSubmittedForms] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSubmittedForms(new Set());
  }, [conversationId]);

  // Files / editor
  const [tab, setTab] = useState<Tab>('assets');
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ relPath: string; fileKind?: FileNode['fileKind'] } | null>(null);
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());
  const [showNewFile, setShowNewFile] = useState(false);
  const [usedAssets, setUsedAssets] = useState<Set<string>>(new Set());
  const [mainScene, setMainScene] = useState<string | null>(null);
  // Web projects: data/*.json that data/levels.json lists. Used to route file
  // clicks — only THESE go to the Scenes tab. Other JSONs (catalogs / wave
  // files / arbitrary data) stay in the Assets tab so they don't fail the
  // SceneEditor's mapSize check.
  const [webLevelFiles, setWebLevelFiles] = useState<Set<string>>(new Set());

  // Navigation history (back/forward through tab + file selection)
  type NavState = { tab: Tab; selectedFile: { relPath: string; fileKind?: FileNode['fileKind'] } | null };
  const navStackRef = useRef<NavState[]>([{ tab: 'assets', selectedFile: null }]);
  const navIndexRef = useRef(0);
  const applyingHistoryRef = useRef(false);
  const [, forceNavRender] = useState(0);

  function recordNav(state: NavState) {
    if (applyingHistoryRef.current) return;
    const stack = navStackRef.current;
    const idx = navIndexRef.current;
    const top = stack[idx];
    if (top && top.tab === state.tab && top.selectedFile?.relPath === state.selectedFile?.relPath) {
      return;
    }
    // truncate forward history when navigating from a non-tip state
    const truncated = stack.slice(0, idx + 1);
    truncated.push(state);
    // cap stack
    const MAX = 50;
    const start = Math.max(0, truncated.length - MAX);
    navStackRef.current = truncated.slice(start);
    navIndexRef.current = navStackRef.current.length - 1;
    forceNavRender((n) => n + 1);
  }

  function applyNav(state: NavState) {
    applyingHistoryRef.current = true;
    setTab(state.tab);
    setSelectedFile(state.selectedFile);
    // release flag on next tick
    window.setTimeout(() => {
      applyingHistoryRef.current = false;
    }, 0);
    forceNavRender((n) => n + 1);
  }

  function navBack() {
    if (navIndexRef.current <= 0) return;
    navIndexRef.current -= 1;
    applyNav(navStackRef.current[navIndexRef.current]);
  }
  function navForward() {
    if (navIndexRef.current >= navStackRef.current.length - 1) return;
    navIndexRef.current += 1;
    applyNav(navStackRef.current[navIndexRef.current]);
  }

  // Record a nav state whenever tab or selectedFile changes (unless we're applying history)
  useEffect(() => {
    recordNav({ tab, selectedFile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedFile?.relPath]);

  // Persist last tab + selectedFile per project so reload returns to where you left off.
  useEffect(() => {
    if (!project) return;
    if (selectedFile) {
      localStorage.setItem(
        LS_LAST_FILE_PREFIX + project.path,
        JSON.stringify({
          tab,
          relPath: selectedFile.relPath,
          fileKind: selectedFile.fileKind,
        }),
      );
    } else {
      localStorage.setItem(LS_LAST_FILE_PREFIX + project.path, JSON.stringify({ tab }));
    }
  }, [project?.path, tab, selectedFile?.relPath, selectedFile?.fileKind]);

  // Bumps after a Codex run modifies disk so SceneEditor can refetch.
  const [sceneReloadKey, setSceneReloadKey] = useState(0);

  // Reference images
  const [refs, setRefs] = useState<RefImage[]>([]);

  const [showImportSession, setShowImportSession] = useState(false);

  // Pending slicing changes
  const [pending, setPending] = useState<PendingSliceEntry[]>([]);
  const [showPending, setShowPending] = useState(false);
  // Bumps whenever sprite slicing metadata changes (slicer save, revert, discard).
  // FileEditor uses this to re-fetch its sidecar / pipeline meta / usages.
  const [metadataRev, setMetadataRev] = useState(0);
  const bumpMetadataRev = () => setMetadataRev((n) => n + 1);

  const refreshPending = useCallback(async (p: Project | null) => {
    if (!p) {
      setPending([]);
      return;
    }
    try {
      const r = await fetchPendingSlices(p.path);
      setPending(r.pending);
    } catch {
      setPending([]);
    }
  }, []);

  // Split
  const [split, setSplit] = useState<number>(() => {
    const saved = Number(localStorage.getItem(LS_SPLIT));
    return Number.isFinite(saved) && saved >= 28 && saved <= 80 ? saved : 64;
  });
  useEffect(() => {
    localStorage.setItem(LS_SPLIT, String(split));
  }, [split]);

  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(LS_TREE_W));
    return Number.isFinite(saved) && saved >= 160 && saved <= 600 ? saved : 248;
  });
  useEffect(() => {
    localStorage.setItem(LS_TREE_W, String(treeWidth));
  }, [treeWidth]);

  const [treeCollapsed, setTreeCollapsed] = useState<boolean>(
    () => localStorage.getItem(LS_TREE_COLLAPSED) === '1',
  );
  useEffect(() => {
    localStorage.setItem(LS_TREE_COLLAPSED, treeCollapsed ? '1' : '0');
  }, [treeCollapsed]);

  // Sidebar width — user-resizable via drag handle on the right edge of the
  // .side column. Clamped 180–360; persists to localStorage.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(LS_SIDEBAR_W));
    return Number.isFinite(saved) && saved >= 180 && saved <= 360 ? saved : 240;
  });
  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_W, String(sidebarWidth));
  }, [sidebarWidth]);
  function onSidebarDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(180, Math.min(360, startW + (ev.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const convoRef = useRef<HTMLDivElement>(null);

  const refreshTree = useCallback(async (p: Project | null) => {
    if (!p) {
      setFileTree(null);
      setUsedAssets(new Set());
      return;
    }
    try {
      const r = await fetchFileTree(p.path);
      setFileTree(r.tree);
    } catch {
      setFileTree(null);
    }
    fetchAnalyze(p.path)
      .then((a) => {
        setUsedAssets(new Set(a.usedAssets));
        setMainScene(a.mainScene ?? null);
      })
      .catch(() => {
        setUsedAssets(new Set());
        setMainScene(null);
      });
  }, []);

  // Web only: read data/levels.json and remember which file paths are levels.
  // The Sengoku layout has data/<scene>-collision-map.json next to data/
  // catalogs (enemies.json, items.json, ...). Only the level files should
  // route to the Scenes tab; catalogs stay in Assets to avoid the
  // 'JSON file is not a level (missing mapSize)' error from SceneEditor.
  const loadWebLevelRegistry = useCallback(async (p: Project) => {
    if (p.engine !== 'web') {
      setWebLevelFiles(new Set());
      return;
    }
    try {
      const r = await fetchFileContent(p.path, 'data/levels.json');
      if (!r.content) {
        setWebLevelFiles(new Set());
        return;
      }
      const parsed = JSON.parse(r.content) as unknown;
      // Accept either shape (both are conventional):
      //   { "levels": [ { id, file }, ... ] }   ← bootstrap template
      //   [ { id, file }, ... ]                 ← bare array (Codex sometimes
      //                                           prefers this for catalogs)
      let entries: Array<{ id?: string; file?: string }> = [];
      if (Array.isArray(parsed)) {
        entries = parsed as Array<{ id?: string; file?: string }>;
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { levels?: unknown }).levels)) {
        entries = (parsed as { levels: Array<{ id?: string; file?: string }> }).levels;
      }
      const files = new Set<string>();
      for (const lv of entries) {
        if (typeof lv.file === 'string') files.add(lv.file.replace(/\\/g, '/'));
      }
      setWebLevelFiles(files);
    } catch {
      // No levels.json (legacy / pre-conventions project). Routing falls
      // back to a name-based heuristic; badges just won't show.
      setWebLevelFiles(new Set());
    }
  }, []);

  // Boot
  useEffect(() => {
    fetchAgents()
      .then((r) => setAgent(r.agents[0] ?? null))
      .catch(() => setAgent(null))
      .finally(() => setAgentLoading(false));

    fetchProjects()
      .then(async (r) => {
        setProjects(r.projects);
        const lastPath = localStorage.getItem(LS_PROJECT);
        const last = r.projects.find((p) => p.path === lastPath) ?? r.projects[0] ?? null;
        if (last) await selectProject(last);
        else setShowOpenModal(true);
      })
      .catch(() => setShowOpenModal(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight;
  }, [turns]);

  const selectProject = useCallback(
    async (p: Project) => {
      setProject(p);
      setRecentlyChanged(new Set());
      setRefs([]);

      // Restore last tab + file for THIS project, if any.
      let restoredFile = false;
      try {
        const saved = localStorage.getItem(LS_LAST_FILE_PREFIX + p.path);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            // The 'code' tab was removed; older entries get migrated to 'assets'.
            tab?: Tab | 'code';
            relPath?: string;
            fileKind?: FileNode['fileKind'];
          };
          const migratedTab: Tab | undefined =
            parsed.tab === 'code' ? 'assets' : (parsed.tab as Tab | undefined);
          if (migratedTab) setTab(migratedTab);
          if (parsed.relPath) {
            setSelectedFile({ relPath: parsed.relPath, fileKind: parsed.fileKind });
            restoredFile = true;
          }
        }
      } catch {
        // ignore corrupted entry
      }
      if (!restoredFile) setSelectedFile(null);

      // reset nav history for new project
      navStackRef.current = [{ tab: 'assets', selectedFile: null }];
      navIndexRef.current = 0;
      localStorage.setItem(LS_PROJECT, p.path);

      void refreshTree(p);
      void refreshPending(p);
      fetchRefs(p.path)
        .then((r) => setRefs(r.refs))
        .catch(() => setRefs([]));
      void loadWebLevelRegistry(p);

      // Default-load the main scene if we don't have a saved selection yet.
      // We wait for analyze to come back so mainScene is known.
      fetchAnalyze(p.path)
        .then((a) => {
          setUsedAssets(new Set(a.usedAssets));
          setMainScene(a.mainScene ?? null);
          if (!restoredFile && a.mainScene) {
            setTab('scenes');
            setSelectedFile({ relPath: a.mainScene, fileKind: 'text' });
          }
        })
        .catch(() => {
          setUsedAssets(new Set());
          setMainScene(null);
        });

      const r = await fetchConversations(p.path);
      setConversations(r.conversations);

      const lastConv = localStorage.getItem(LS_CONVERSATION);
      const target = r.conversations.find((c) => c.id === lastConv) ?? r.conversations[0];
      if (target) await selectConversation(target.id);
      else {
        setConversationId(null);
        setTurns([]);
      }
    },
    [refreshTree],
  );

  const selectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    localStorage.setItem(LS_CONVERSATION, id);
    const r = await fetchMessages(id);
    setTurns(messagesToTurns(r.messages));
  }, []);

  const newConversation = useCallback(async () => {
    if (!project) return;
    const { conversation } = await createConversation(project.path);
    setConversations((prev) => [conversation, ...prev]);
    setConversationId(conversation.id);
    localStorage.setItem(LS_CONVERSATION, conversation.id);
    setTurns([]);
  }, [project]);

  const deleteConversationAt = useCallback(
    async (id: string) => {
      const ok = await askConfirm({
        title: 'Delete this conversation?',
        body: 'Messages and the Codex thread link will be removed from OGF. The Codex session file on disk is not touched.',
        danger: true,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      await removeConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setTurns([]);
      }
    },
    [conversationId, askConfirm],
  );

  const deleteProjectFromList = useCallback(
    async (p: Project) => {
      try {
        await removeProject(p.path);
        // Update the dropdown list immediately, then clean up local state if
        // the active project was the one removed.
        const remaining = projects.filter((x) => x.path !== p.path);
        setProjects(remaining);
        if (project?.path === p.path) {
          // Active project was removed. Switch to the next remaining project,
          // or fall back to the open-folder modal if the list is now empty.
          const next = remaining[0] ?? null;
          if (next) {
            await selectProject(next);
          } else {
            setProject(null);
            setSelectedFile(null);
            setTurns([]);
            setConversations([]);
            setConversationId(null);
            localStorage.removeItem(LS_PROJECT);
            setShowOpenModal(true);
          }
        }
      } catch (err) {
        notify({
          kind: 'error',
          title: 'Could not remove project',
          body: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [project, projects, selectProject, notify],
  );

  const handleOpenProject = useCallback(
    async (rawPath: string) => {
      const trimmed = rawPath.trim();
      if (!trimmed) return;
      try {
        const r = await openProject(trimmed);
        setProjects((prev) => {
          const without = prev.filter((p) => p.path !== r.project.path);
          return [r.project, ...without];
        });
        setShowOpenModal(false);
        await selectProject(r.project);
      } catch (err) {
        notify({
          kind: 'error',
          title: 'Could not open folder',
          body: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [selectProject, notify],
  );

  function appendEventToLastTurn(ev: AgentEvent) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = { ...next[next.length - 1] };
      last.events = [...last.events, ev];
      next[next.length - 1] = last;
      return next;
    });
  }

  function finalizeLastTurn(status: TurnStatus, error?: string) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = { ...next[next.length - 1], status, endedAt: Date.now(), error };
      next[next.length - 1] = last;
      return next;
    });
  }

  // Question-form submit: format answers as a prose block, lock the form,
  // and immediately send as the next turn. The form's Submit IS the user's
  // confirmation — making them click 'Send' next would be redundant.
  //
  // NOT useCallback'd: send() reads agent / running / project / etc. via
  // closure, which a memoized handler would freeze to first-render values.
  // Recreating this each render is cheap; the stale-closure bug is not.
  function onSubmitForm(answers: QuestionFormAnswers): void {
    const lines: string[] = [`## Form answers (id=${answers.formId})`, ''];
    for (const [key, value] of Object.entries(answers.answers)) {
      if (Array.isArray(value)) {
        lines.push(`- **${key}**: ${value.join(', ') || '(none)'}`);
      } else {
        lines.push(`- **${key}**: ${value}`);
      }
    }
    const text = lines.join('\n');
    setSubmittedForms((prev) => new Set([...prev, answers.formId]));
    void send(text);
  }

  async function send(overridePrompt?: string) {
    const text = overridePrompt ?? prompt;
    if (!agent?.available || !text.trim() || running || !project) return;

    const userText = text.trim();
    setPrompt('');

    const newTurn: UiTurn = {
      id: cryptoRandomId(),
      userText,
      events: [],
      status: 'streaming',
      startedAt: Date.now(),
    };
    setTurns((s) => [...s, newTurn]);
    setRunning(true);
    setLastRunAt(Date.now());

    try {
      const r = await createRun({
        agentId: 'codex',
        prompt: userText,
        projectPath: project.path,
        conversationId: conversationId ?? undefined,
        model: model === 'default' ? undefined : model,
        reasoning,
        refImagePaths: refs.length > 0 ? refs.map((x) => x.relPath) : undefined,
      });
      setRunId(r.runId);

      if (!conversationId || conversationId !== r.conversationId) {
        setConversationId(r.conversationId);
        localStorage.setItem(LS_CONVERSATION, r.conversationId);
        if (project) {
          fetchConversations(project.path).then((cr) => setConversations(cr.conversations));
        }
      }

      const turnChanged = new Set<string>();

      subscribeRun(r.runId, (e) => {
        if (e.type === 'agent') {
          if (e.data.type === 'tool_use' && e.data.name === 'Edit') {
            const changes = (e.data.input as { changes?: { path?: string }[] })?.changes ?? [];
            for (const ch of changes) {
              if (ch.path) {
                const rel = toRelative(ch.path, project?.path ?? '');
                if (rel) turnChanged.add(rel);
              }
            }
          }
          appendEventToLastTurn(e.data);
        } else if (e.type === 'error') {
          finalizeLastTurn('failed', e.data.message);
          setRunning(false);
          setRunId(null);
        } else if (e.type === 'end') {
          const status: TurnStatus =
            e.data.status === 'succeeded' ? 'done' : e.data.status === 'canceled' ? 'canceled' : 'failed';
          finalizeLastTurn(status);
          setRunning(false);
          setRunId(null);
          setLastRunAt(Date.now());
          if (project) {
            void refreshTree(project);
            void refreshPending(project);
            setRecentlyChanged(turnChanged);
            // Trigger SceneEditor refetch — agent likely edited a .tscn / sidecar.
            setSceneReloadKey((n) => n + 1);
            window.setTimeout(() => setRecentlyChanged(new Set()), 8000);
            fetchConversations(project.path).then((cr) => setConversations(cr.conversations));
          }
        }
      });
    } catch (err) {
      finalizeLastTurn('failed', err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  async function stop() {
    if (runId) await cancelRun(runId);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Split drag
  function onSplitDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startSplit = split;
    const w = window.innerWidth;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.max(28, Math.min(80, startSplit + (dx / w) * 100));
      setSplit(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const filesChangedCount = recentlyChanged.size;
  const lastRunLabel = !lastRunAt
    ? '—'
    : running
    ? 'in progress'
    : timeAgo(lastRunAt);

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}
    >
      <Sidebar
        agent={agent}
        agentLoading={agentLoading}
        project={project}
        projects={projects}
        onSelectProject={(p) => void selectProject(p)}
        onOpenProject={() => setShowOpenModal(true)}
        onDeleteProject={(p) => void deleteProjectFromList(p)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        density={density}
        onCycleDensity={() =>
          setDensity((d) => (d === 'compact' ? 'regular' : d === 'regular' ? 'comfy' : 'compact'))
        }
        tree={fileTree}
        selectedFile={selectedFile}
        onSelectFile={(rel, fk) => {
          // Same routing logic the EditorPane used to own — moved here since
          // the file tree now lives in the Sidebar. Keeps tab routing consistent
          // with whatever the user clicks.
          const relPosix = rel.replace(/\\/g, '/');
          const ext = relPosix.split('.').pop()?.toLowerCase() ?? '';
          const isScene = ext === 'tscn';
          let isWebLevel = false;
          if (project?.engine === 'web' && ext === 'json' && relPosix.startsWith('data/')) {
            if (webLevelFiles.size > 0) {
              isWebLevel = webLevelFiles.has(relPosix);
            } else {
              isWebLevel =
                /(?:^|\/)(?:[^/]*-)?(?:collision-map|level)(?:-[^/]+)?\.json$/i.test(relPosix);
            }
          }
          setTab(isScene || isWebLevel ? 'scenes' : 'assets');
          setSelectedFile({ relPath: rel, fileKind: fk });
        }}
        onNewFile={() => setShowNewFile(true)}
        onRefreshTree={() => void refreshTree(project)}
        recentlyChanged={recentlyChanged}
        usedAssets={usedAssets}
        mainScene={mainScene}
        sceneFiles={webLevelFiles}
      />

      <div
        className="sidebar-resize"
        onMouseDown={onSidebarDragStart}
        title="Drag to resize sidebar"
      />

      <div
        className="main"
        style={{ gridTemplateColumns: `${split}fr 1px ${100 - split}fr` }}
      >
        {project ? (
          <EditorPane
            tab={tab}
            setTab={setTab}
            project={project}
            tree={fileTree}
            selectedFile={selectedFile}
            onSelectFile={(rel, fk) => {
              // .tscn → scenes (canvas view); web levels listed in
              // data/levels.json → also scenes; everything else (including
              // data/enemies.json and other catalogs) → assets.
              const relPosix = rel.replace(/\\/g, '/');
              const ext = relPosix.split('.').pop()?.toLowerCase() ?? '';
              const isScene = ext === 'tscn';
              let isWebLevel = false;
              if (project?.engine === 'web' && ext === 'json' && relPosix.startsWith('data/')) {
                if (webLevelFiles.size > 0) {
                  isWebLevel = webLevelFiles.has(relPosix);
                } else {
                  // No levels.json registry → permissive name-based heuristic.
                  isWebLevel =
                    /(?:^|\/)(?:[^/]*-)?(?:collision-map|level)(?:-[^/]+)?\.json$/i.test(
                      relPosix,
                    );
                }
              }
              setTab(isScene || isWebLevel ? 'scenes' : 'assets');
              setSelectedFile({ relPath: rel, fileKind: fk });
            }}
            onCloseFile={() => setSelectedFile(null)}
            onNewFile={() => setShowNewFile(true)}
            onRefresh={() => void refreshTree(project)}
            recentlyChanged={recentlyChanged}
            usedAssets={usedAssets}
            mainScene={mainScene}
            sceneFiles={webLevelFiles}
            sceneReloadKey={sceneReloadKey}
            onJumpTo={(rel) => {
              const ext = rel.split('.').pop()?.toLowerCase() ?? '';
              const isScene = ext === 'tscn';
              setTab(isScene ? 'scenes' : 'assets');
              setSelectedFile({ relPath: rel, fileKind: isImageExt(ext) ? 'image' : 'text' });
            }}
            onAskCodex={(text) => {
              setPrompt(text);
              window.setTimeout(() => {
                const el = document.querySelector('.composer-box textarea') as HTMLTextAreaElement | null;
                el?.focus();
                el?.setSelectionRange(text.length, text.length);
              }, 50);
            }}
            onSlicingSaved={() => {
              bumpMetadataRev();
              void refreshPending(project);
            }}
            metadataRev={metadataRev}
            canBack={navIndexRef.current > 0}
            canForward={navIndexRef.current < navStackRef.current.length - 1}
            onBack={navBack}
            onForward={navForward}
          />
        ) : (
          <EmptyEditor onOpen={() => setShowOpenModal(true)} />
        )}

        <div className="split-bar" onMouseDown={onSplitDragStart} title="Drag to resize" />

        <AgentPane
          conversations={conversations}
          conversationId={conversationId}
          onSelectConversation={(id) => void selectConversation(id)}
          onNewConversation={() => void newConversation()}
          onDeleteConversation={(id) => void deleteConversationAt(id)}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
          turns={turns}
          model={model}
          setModel={setModel}
          reasoning={reasoning}
          setReasoning={setReasoning}
          prompt={prompt}
          setPrompt={setPrompt}
          running={running}
          onSend={() => void send()}
          onStop={() => void stop()}
          onKey={onKey}
          agent={agent}
          project={project}
          convoRef={convoRef}
          refs={refs}
          onRefsChange={setRefs}
          pendingCount={pending.length}
          onOpenPending={() => setShowPending(true)}
          onImportSession={() => setShowImportSession(true)}
          submittedForms={submittedForms}
          onSubmitForm={onSubmitForm}
        />
      </div>

      {/* v2: status bar removed (no chrome at the bottom of the app — agent
       *  state lives in the sidebar foot, save state shows on save badges). */}

      {showOpenModal && (
        <FolderPickerModal
          initialPath={project?.path}
          onCancel={() => setShowOpenModal(false)}
          onSelect={(p) => void handleOpenProject(p)}
          onCreateProject={async ({ parentPath, name, engine }) => {
            // Create the folder under parentPath / name and scaffold it.
            const slug = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
            const sep = parentPath.includes('\\') ? '\\' : '/';
            const fullPath = `${parentPath}${parentPath.endsWith(sep) ? '' : sep}${slug}`;
            try {
              const r = await createProject({ path: fullPath, engine, name });
              setProjects((prev) => {
                const without = prev.filter((p) => p.path !== r.project.path);
                return [r.project, ...without];
              });
              setShowOpenModal(false);
              await selectProject(r.project);
            } catch (err) {
              notify({
                kind: 'error',
                title: 'Could not create project',
                body: err instanceof Error ? err.message : String(err),
              });
            }
          }}
        />
      )}

      {showNewFile && project && (
        <NewFileModal
          onCancel={() => setShowNewFile(false)}
          onSubmit={async (relPath) => {
            try {
              await writeFileContent({ projectPath: project.path, relPath, content: '' });
              setShowNewFile(false);
              await refreshTree(project);
              setSelectedFile({ relPath, fileKind: 'text' });
            } catch (err) {
              notify({ kind: 'error', title: 'Could not create file', body: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
      )}

      {showImportSession && project && (
        <ImportCodexSessionModal
          projectPath={project.path}
          onClose={() => setShowImportSession(false)}
          onImported={async (convId) => {
            setShowImportSession(false);
            const r = await fetchConversations(project.path);
            setConversations(r.conversations);
            await selectConversation(convId);
          }}
        />
      )}

      {showPending && project && (
        <PendingChangesModal
          pending={pending}
          engine={project?.engine}
          onClose={() => setShowPending(false)}
          onApplyAll={(promptText) => {
            setPrompt(promptText);
            setShowPending(false);
            window.setTimeout(() => {
              const el = document.querySelector('.composer-box textarea') as HTMLTextAreaElement | null;
              el?.focus();
              el?.setSelectionRange(promptText.length, promptText.length);
              el?.scrollTo(0, 0);
            }, 50);
          }}
          onClearAll={async () => {
            const ok = await askConfirm({
              title: `Revert all ${pending.length} pending slicing change${pending.length === 1 ? '' : 's'}?`,
              body: 'This deletes the .ogf-slice.json sidecars. Your Godot project files are not touched.',
              danger: true,
              confirmLabel: 'Revert all',
            });
            if (!ok) return;
            try {
              const r = await clearPendingSlices(project.path);
              bumpMetadataRev();
              await refreshPending(project);
              setShowPending(false);
              notify({ kind: 'success', body: `Reverted ${r.removed} pending change${r.removed === 1 ? '' : 's'}` });
            } catch (err) {
              notify({ kind: 'error', title: 'Could not revert', body: err instanceof Error ? err.message : String(err) });
            }
          }}
          onDiscardOne={async (sidecarPath) => {
            try {
              await deleteFile(project.path, sidecarPath);
              bumpMetadataRev();
              await refreshPending(project);
              notify({ kind: 'success', body: 'Discarded pending change' });
            } catch (err) {
              notify({ kind: 'error', title: 'Could not discard', body: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
      )}
    </div>
  );
}

// ===================== Editor Pane =====================

function EditorPane(props: {
  tab: Tab;
  setTab: (t: Tab) => void;
  project: Project;
  tree: FileNode | null;
  selectedFile: { relPath: string; fileKind?: FileNode['fileKind'] } | null;
  onSelectFile: (rel: string, fk: FileNode['fileKind']) => void;
  onCloseFile: () => void;
  onNewFile: () => void;
  onRefresh: () => void;
  recentlyChanged: Set<string>;
  usedAssets: Set<string>;
  mainScene: string | null;
  sceneFiles: Set<string>;
  sceneReloadKey: number;
  onJumpTo: (relPath: string, line: number) => void;
  onAskCodex: (text: string) => void;
  onSlicingSaved?: () => void;
  metadataRev?: number;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <div className="editor-pane">
      {/* v2.1: tabs back in the topbar (sidebar is just the file tree now).
          Back/forward nav + Assets/Scenes/Play tab toggles live here. */}
      <div className="topbar">
        <button
          className="btn btn-sm btn-ghost btn-icon"
          onClick={props.onBack}
          disabled={!props.canBack}
          title="Back"
        >
          ‹
        </button>
        <button
          className="btn btn-sm btn-ghost btn-icon"
          onClick={props.onForward}
          disabled={!props.canForward}
          title="Forward"
        >
          ›
        </button>
        <div className="topbar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={props.tab === 'assets'}
            className={`topbar-tab-btn ${props.tab === 'assets' ? 'active' : ''}`}
            onClick={() => props.setTab('assets')}
          >
            Assets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.tab === 'scenes'}
            className={`topbar-tab-btn ${props.tab === 'scenes' ? 'active' : ''}`}
            onClick={() => props.setTab('scenes')}
          >
            Scenes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.tab === 'play'}
            className={`topbar-tab-btn ${props.tab === 'play' ? 'active' : ''}`}
            onClick={() => props.setTab('play')}
          >
            Play
          </button>
        </div>
        <span className="grow" />
      </div>

      <div className="editor-body">
        {props.tab === 'assets' && (
          props.selectedFile ? (
            <FileEditor
              key={props.selectedFile.relPath}
              projectPath={props.project.path}
              relPath={props.selectedFile.relPath}
              engine={props.project.engine}
              fileKind={
                props.selectedFile.fileKind === 'binary'
                  ? 'binary'
                  : props.selectedFile.fileKind === 'image'
                  ? 'image'
                  : 'text'
              }
              recentlyChanged={props.recentlyChanged.has(props.selectedFile.relPath)}
              onClose={props.onCloseFile}
              onJumpTo={props.onJumpTo}
              onAskCodex={props.onAskCodex}
              onSlicingSaved={props.onSlicingSaved}
              metadataRev={props.metadataRev}
            />
          ) : (
            <ProjectWelcome project={props.project} />
          )
        )}
        {props.tab === 'scenes' && (() => {
          const file = props.selectedFile;
          const ext = file?.relPath.split('.').pop()?.toLowerCase();
          const isSceneFile =
            ext === 'tscn' ||
            (ext === 'json' &&
              props.project.engine === 'web' &&
              !!file?.relPath.startsWith('data/'));
          return isSceneFile && file ? (
            <SceneEditor
              key={file.relPath}
              projectPath={props.project.path}
              relPath={file.relPath}
              reloadKey={props.sceneReloadKey}
              onAskCodex={props.onAskCodex}
              onClose={props.onCloseFile}
            />
          ) : (
            <ScenePicker
              tree={props.tree}
              onPick={(rel) => props.onSelectFile(rel, 'text')}
              project={props.project}
              usedAssets={props.usedAssets}
              mainScene={props.mainScene}
            />
          );
        })()}
        {props.tab === 'play' && (
          <PlayPane
            projectPath={props.project.path}
            engine={props.project.engine}
            mainScene={props.mainScene}
            onJumpTo={(rel, line) => {
              const ext = rel.split('.').pop()?.toLowerCase() ?? '';
              const isCode = ['gd', 'cs', 'js', 'jsx', 'ts', 'tsx', 'py'].includes(ext);
              props.onJumpTo(rel, line);
              if (isCode) {
                // ensure code tab is active (onJumpTo handler does that)
              }
              void line;
            }}
          />
        )}
      </div>
    </div>
  );
}

function ProjectWelcome({ project }: { project: Project }) {
  return (
    <div className="inspector">
      <div className="crumbs">
        <span className="last">{project.name}</span>
        <span className="badge-dim">{project.engine}</span>
      </div>
      <div className="canvas-area">
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 14, color: 'var(--ink-1)', marginBottom: 8 }}>
            {project.name}
          </div>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {project.path}
          </div>
          <p style={{ marginTop: 16, color: 'var(--ink-2)', fontSize: 12 }}>
            Pick a file on the left, or ask Codex to make one.
          </p>
        </div>
      </div>
    </div>
  );
}

function ScenePicker({
  tree,
  onPick,
  project,
  usedAssets,
  mainScene,
}: {
  tree: FileNode | null;
  onPick: (relPath: string) => void;
  project: Project;
  usedAssets: Set<string>;
  mainScene: string | null;
}) {
  const [usedOnly, setUsedOnly] = useState<boolean>(() => {
    return localStorage.getItem('ogf:scenes:usedOnly') === '1';
  });
  useEffect(() => {
    localStorage.setItem('ogf:scenes:usedOnly', usedOnly ? '1' : '0');
  }, [usedOnly]);

  const all: FileNode[] = [];
  if (tree) collectScenes(tree, all, project.engine);

  const items = all.map((s) => {
    const isMain = mainScene === s.relPath;
    const isUsed = isMain || usedAssets.has(s.relPath);
    return { node: s, isMain, isUsed };
  });

  const visible = usedOnly ? items.filter((x) => x.isUsed) : items;
  const unusedCount = items.filter((x) => !x.isUsed).length;

  return (
    <div className="inspector">
      <div className="crumbs">
        <span className="last">{project.name}</span>
        <span className="badge-dim">scenes</span>
        <span className="actions">
          {unusedCount > 0 && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setUsedOnly((v) => !v)}
              title={usedOnly ? 'Show all scenes' : 'Hide unused scenes'}
            >
              {usedOnly ? '👁' : '◐'} {usedOnly ? 'showing used' : `${unusedCount} unused`}
            </button>
          )}
        </span>
      </div>
      <div style={{ overflow: 'auto', padding: 24 }}>
        {items.length === 0 ? (
          <div className="muted mono" style={{ fontSize: 12 }}>
            No .tscn files found in this project.
          </div>
        ) : visible.length === 0 ? (
          <div className="muted mono" style={{ fontSize: 12 }}>
            No used scenes — toggle the filter to see all {items.length}.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxWidth: 600 }}>
            <div className="muted mono" style={{ fontSize: 11, marginBottom: 4 }}>
              {usedOnly
                ? `Showing ${visible.length} used scene${visible.length === 1 ? '' : 's'} (${unusedCount} hidden)`
                : `${items.length} scene${items.length === 1 ? '' : 's'} — ${unusedCount} unused`}
            </div>
            {visible.map(({ node: s, isMain, isUsed }) => (
              <button
                key={s.relPath}
                className={`scene-pick-row ${isUsed ? '' : 'unused'}`}
                onClick={() => onPick(s.relPath)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 12 }}>{s.name}</span>
                  {isMain && <span className="badge-dim" style={{ color: 'var(--accent)' }}>main</span>}
                  {!isUsed && <span className="badge-dim" style={{ color: 'var(--ink-3)' }}>unused</span>}
                </div>
                <span className="muted mono" style={{ fontSize: 11 }}>{s.relPath}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function isWebLevelCandidate(rel: string): boolean {
  // Web projects: data/<level>.json files are level candidates. We don't
  // probe the contents here (that would require reading every JSON); the
  // Sengoku-style naming convention is enough for picker purposes.
  if (!rel.toLowerCase().endsWith('.json')) return false;
  if (!rel.startsWith('data/')) return false;
  // Skip catalogs / index files we know aren't levels.
  const base = rel.split('/').pop() ?? '';
  if (/^(enemies|heroes|towers|items|waves|levels)\.json$/i.test(base)) return false;
  return true;
}

function collectScenes(node: FileNode, out: FileNode[], engine?: string) {
  if (node.kind === 'file') {
    if (node.name.toLowerCase().endsWith('.tscn')) out.push(node);
    else if (engine === 'web' && isWebLevelCandidate(node.relPath)) out.push(node);
    return;
  }
  for (const c of node.children ?? []) collectScenes(c, out, engine);
}

function PlaceholderView({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="inspector">
      <div className="crumbs">
        <span className="last">{title}</span>
        <span className="badge-dim">placeholder</span>
      </div>
      <div className="canvas-area">
        <div className="muted mono" style={{ fontSize: 12 }}>{hint}</div>
      </div>
    </div>
  );
}

function EmptyEditor({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <img
          className="empty-logo"
          src="/ogf-logo-256.png"
          srcSet="/ogf-logo-128.png 1x, /ogf-logo-256.png 2x, /ogf-logo-512.png 4x"
          alt=""
          width={128}
          height={128}
        />
        <span className="brand-title brand-title-large" aria-label="Agent Game Forge">
          <span className="brand-agent">Agent</span>
          <span className="brand-game">Game</span>
          <span className="brand-forge">Forge</span>
        </span>
        <h2>Open a project to begin</h2>
        <p>Pick a Godot, Unity, or web game folder. Codex will run with that folder as its workspace.</p>
        <button className="btn btn-primary" onClick={onOpen}>
          {I.folder} Open project folder
        </button>
      </div>
    </div>
  );
}

// ===================== Agent Pane =====================

function AgentPane(props: {
  conversations: Conversation[];
  conversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  turns: UiTurn[];
  model: string;
  setModel: (m: string) => void;
  reasoning: ReasoningEffort;
  setReasoning: (r: ReasoningEffort) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  running: boolean;
  onSend: () => void;
  onStop: () => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  agent: AgentInfo | null;
  project: Project | null;
  convoRef: React.RefObject<HTMLDivElement>;
  refs: RefImage[];
  onRefsChange: (refs: RefImage[]) => void;
  pendingCount: number;
  onOpenPending: () => void;
  onImportSession: () => void;
  /** Form ids the user has already submitted in this conversation. */
  submittedForms: Set<string>;
  /** Called when user submits a question-form rendered inline in chat. */
  onSubmitForm: (answers: QuestionFormAnswers) => void;
}) {
  const currentTitle =
    props.conversations.find((c) => c.id === props.conversationId)?.title || 'New conversation';
  const isResuming = !!props.conversations.find((c) => c.id === props.conversationId)?.codexThreadId;
  const dropzoneRef = useRef<DropzoneHandle>(null);
  const [dragOver, setDragOver] = useState(false);
  // Track depth of nested dragenter/leave events so we don't flicker the overlay.
  const dragDepthRef = useRef(0);

  function isFileDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function onDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e) || !props.project) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (!isFileDrag(e) || !props.project) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    if (!isFileDrag(e) || !props.project) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void dropzoneRef.current?.uploadFiles(e.dataTransfer.files);
    }
  }

  return (
    <aside
      className={`agent-pane ${dragOver ? 'dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="agent-drag-overlay">
          <div className="agent-drag-card">
            <div className="agent-drag-icon">📎</div>
            <div>Drop to attach</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Any file — images, audio, configs, code, etc.
            </div>
          </div>
        </div>
      )}
      <div className="agent-head">
        <span className="title">Codex</span>
        <span style={{ flex: 1 }} />
        {props.pendingCount > 0 && (
          <button
            className="btn btn-sm"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-line)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
            onClick={props.onOpenPending}
            title="View pending slicing changes"
          >
            {I.scissors} {props.pendingCount} pending
          </button>
        )}
        <HistoryDropdown
          open={props.showHistory}
          setOpen={props.setShowHistory}
          conversations={props.conversations}
          currentId={props.conversationId}
          currentTitle={currentTitle}
          onSelect={props.onSelectConversation}
          onNew={props.onNewConversation}
          onDelete={props.onDeleteConversation}
          onImport={props.onImportSession}
          disabled={!props.project}
        />
        <span className="runctl">
          {props.running ? (
            <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={props.onStop}>
              {I.stop} Stop
            </button>
          ) : (
            <>
              <button className="btn btn-sm btn-ghost" onClick={props.onNewConversation} disabled={!props.project} title="New conversation">{I.plus}</button>
            </>
          )}
        </span>
      </div>

      <div className="convo" ref={props.convoRef}>
        {props.turns.length === 0 && (
          <div className="msg-sys">{I.spark} {props.project ? 'Ready. Ask Codex something.' : 'Open a project to start.'}</div>
        )}
        {props.turns.map((t) => (
          <Turn
            key={t.id}
            userText={t.userText}
            events={t.events}
            status={t.status}
            startedAt={t.startedAt}
            endedAt={t.endedAt}
            error={t.error}
            submittedForms={props.submittedForms}
            onSubmitForm={props.onSubmitForm}
            projectPath={props.project?.path}
          />
        ))}
        <SpecProgressCard
          projectPath={props.project?.path ?? null}
          conversationId={props.conversationId}
          streaming={props.running}
        />
      </div>

      <Dropzone
        ref={dropzoneRef}
        projectPath={props.project?.path ?? null}
        refs={props.refs}
        onChange={props.onRefsChange}
        disabled={!props.project}
      />

      <div className="composer">
        <div className="composer-box">
          <ComposerTextarea
            value={props.prompt}
            onChange={props.setPrompt}
            onKeyDown={props.onKey}
            disabled={!props.agent?.available || props.running || !props.project}
            placeholder={
              !props.project
                ? 'Open a project first'
                : props.agent?.available
                ? 'Ask Codex to generate, edit, or fix something… (⌘L to focus)'
                : 'Codex not detected'
            }
          />
          <div className="composer-actions">
            <label className="menu-btn" title="Model">
              <span className="lbl">model</span>
              <select
                value={props.model}
                onChange={(e) => props.setModel(e.target.value)}
              >
                {(props.agent?.models ?? [{ id: 'default', label: 'Default' }]).map((m) => (
                  <option key={m.id} value={m.id} style={{ background: 'var(--bg-1)' }}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="caret">{I.caret}</span>
            </label>
            <label className="menu-btn" title="Reasoning effort">
              <span className="lbl">reasoning</span>
              <select
                value={props.reasoning}
                onChange={(e) => props.setReasoning(e.target.value as ReasoningEffort)}
              >
                <option value="minimal" style={{ background: 'var(--bg-1)' }}>minimal</option>
                <option value="low" style={{ background: 'var(--bg-1)' }}>low</option>
                <option value="medium" style={{ background: 'var(--bg-1)' }}>medium</option>
                <option value="high" style={{ background: 'var(--bg-1)' }}>high</option>
                <option value="xhigh" style={{ background: 'var(--bg-1)' }}>xhigh</option>
              </select>
              <span className="caret">{I.caret}</span>
            </label>
            <button
              className="icon-btn composer-attach"
              onClick={() => dropzoneRef.current?.openFilePicker()}
              disabled={!props.project}
              title="Attach files (drag-and-drop also works)"
            >
              📎
            </button>
            <span className="grow" />
            <button
              className="send-btn"
              data-stop={props.running}
              onClick={props.running ? props.onStop : props.onSend}
              disabled={!props.running && (!props.agent?.available || !props.prompt.trim() || !props.project)}
              title={props.running ? 'Stop' : 'Send'}
            >
              {props.running ? I.stop : I.send}
            </button>
          </div>
        </div>
        <div className="composer-foot">
          <span><span className="kbd">⏎</span> send</span>
          <span><span className="kbd">⇧⏎</span> newline</span>
          <span style={{ flex: 1 }} />
          <span>{isResuming ? 'resume' : 'new thread'}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{props.refs.length} ref{props.refs.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </aside>
  );
}

function ComposerTextarea(props: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const userResizedRef = useRef(false);

  // Auto-grow on content change, unless user has manually resized
  useEffect(() => {
    const el = ref.current;
    if (!el || userResizedRef.current) return;
    el.style.height = 'auto';
    const max = window.innerHeight * 0.5;
    const next = Math.min(max, Math.max(40, el.scrollHeight));
    el.style.height = next + 'px';
  }, [props.value]);

  // Detect user manual resize: if rendered height differs from content height after layout
  function onMouseUp(e: React.MouseEvent) {
    void e;
    const el = ref.current;
    if (!el) return;
    // If the user dragged the resize handle, the inline `height` style stays.
    // After this, we stop auto-growing for this composer instance.
    if (el.style.height && Math.abs(el.clientHeight - el.scrollHeight) > 4) {
      userResizedRef.current = true;
    }
  }

  // Reset auto-grow if user clears the textarea
  useEffect(() => {
    if (props.value === '') userResizedRef.current = false;
  }, [props.value]);

  return (
    <textarea
      ref={ref}
      rows={2}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={props.onKeyDown}
      onMouseUp={onMouseUp}
      disabled={props.disabled}
    />
  );
}

function HistoryDropdown(props: {
  open: boolean;
  setOpen: (v: boolean) => void;
  conversations: Conversation[];
  currentId: string | null;
  currentTitle: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [props.open, props]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-sm btn-ghost"
        onClick={() => props.setOpen(!props.open)}
        disabled={props.disabled}
        title="History"
      >
        {I.branch} history
      </button>
      {props.open && (
        <div className="proj-dropdown" style={{ right: 0, left: 'auto' }}>
          {props.conversations.length === 0 && (
            <div className="proj-dropdown-empty">No conversations</div>
          )}
          {props.conversations.map((c) => (
            <div
              key={c.id}
              className={`proj-dropdown-item ${c.id === props.currentId ? 'active' : ''}`}
              onClick={() => {
                props.onSelect(c.id);
                props.setOpen(false);
              }}
            >
              <div className="proj-dropdown-name">
                {c.title || 'Untitled'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(c.id);
                  }}
                  style={{
                    float: 'right',
                    color: 'var(--ink-3)',
                    background: 'transparent',
                    border: 0,
                    fontSize: 14,
                    padding: '0 4px',
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
              <div className="proj-dropdown-sub">
                {c.codexThreadId ? 'thread saved' : 'no thread yet'} · {timeAgo(c.updatedAt)}
              </div>
            </div>
          ))}
          <div className="proj-dropdown-divider" />
          <div
            className="proj-dropdown-item action"
            onClick={() => {
              props.onNew();
              props.setOpen(false);
            }}
          >
            + New conversation
          </div>
          <div
            className="proj-dropdown-item action"
            style={{ color: 'var(--blue)' }}
            onClick={() => {
              props.onImport();
              props.setOpen(false);
            }}
          >
            {I.branch} Import Codex session…
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== Modals =====================

function NewFileModal(props: { onCancel: () => void; onSubmit: (relPath: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="modal-scrim" onClick={props.onCancel}>
      <div className="modal" style={{ height: 'auto', width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="title">New file</span>
          <button className="close" onClick={props.onCancel}>{I.close}</button>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 12 }}>Relative path. Subdirectories created as needed.</p>
          <input
            autoFocus
            placeholder="scenes/level_2.tscn"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) props.onSubmit(text.trim());
            }}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--line)',
              background: 'var(--bg-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          />
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button className="btn btn-sm" onClick={props.onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => props.onSubmit(text.trim())} disabled={!text.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ===================== Helpers =====================

function messagesToTurns(messages: Message[]): UiTurn[] {
  const turns: UiTurn[] = [];
  let pendingUser: { text: string; createdAt: number } | null = null;

  for (const m of messages) {
    if (m.role === 'user') {
      if (pendingUser) {
        turns.push({
          id: `t-${m.id}`,
          userText: pendingUser.text,
          events: [],
          status: 'failed',
          startedAt: pendingUser.createdAt,
          endedAt: pendingUser.createdAt,
          error: 'No agent response recorded.',
        });
      }
      pendingUser = { text: m.content, createdAt: m.createdAt };
    } else {
      const events = (m.events ?? []) as AgentEvent[];
      turns.push({
        id: `t-${m.id}`,
        userText: pendingUser?.text ?? '',
        events,
        status: 'done',
        startedAt: pendingUser?.createdAt ?? m.createdAt,
        endedAt: m.createdAt,
      });
      pendingUser = null;
    }
  }
  if (pendingUser) {
    turns.push({
      id: `t-pending`,
      userText: pendingUser.text,
      events: [],
      status: 'failed',
      startedAt: pendingUser.createdAt,
      endedAt: Date.now(),
      error: 'No agent response recorded.',
    });
  }
  return turns;
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function toRelative(absPath: string, projectAbs: string): string | null {
  if (!absPath || !projectAbs) return null;
  const norm = absPath.replace(/\\/g, '/');
  const root = projectAbs.replace(/\\/g, '/').replace(/\/$/, '');
  if (norm.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return norm.slice(root.length + 1);
  }
  return null;
}

function isImageExt(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
}

function timeAgo(ts: number): string {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

