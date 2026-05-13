import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  fetchActiveRun,
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
import { SettingsModal, LS_PREFERRED_AGENT } from './components/SettingsModal.js';
import { ImportCodexSessionModal } from './components/ImportCodexSessionModal.js';
import { PackReviewModal } from './components/PackReviewModal.js';
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
const LS_AGENT_COLLAPSED = 'ogf:agentCollapsed';
const LS_TREE_COLLAPSED = 'ogf:treeCollapsed';
const LS_SIDEBAR_W = 'ogf:sidebarWidth';
const LS_LAST_FILE_PREFIX = 'ogf:lastFile:'; // per-project: { tab, relPath }
// Per-agent UI state. Switching CLIs in Settings auto-loads the values the
// user last picked for that CLI — avoids 'model gpt-5.5 not found' errors
// when switching to Claude Code while the dropdown still points at a Codex id.
const LS_MODEL_BY_AGENT = 'ogf:modelByAgent'; // { codex: 'gpt-5.5', 'claude-code': 'default' }
const LS_REASONING_BY_AGENT = 'ogf:reasoningByAgent'; // { codex: 'xhigh', ... }

function readJsonMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeJsonMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — silently no-op */
  }
}

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

  // Live-switch when user picks a different CLI in Settings.
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      void fetchAgents().then((r) => {
        const next = r.agents.find((a) => a.id === id) ?? null;
        if (next) setAgent(next);
      });
    };
    window.addEventListener('ogf:preferred-agent-changed', onSwitch as EventListener);
    return () =>
      window.removeEventListener('ogf:preferred-agent-changed', onSwitch as EventListener);
  }, []);

  // Per-agent model + reasoning sync effects are declared AFTER the model
  // + reasoning useState (see below) — JS hoists var declarations but not
  // useState values, so the effects need to come later in the function body.
  const prevAgentIdRef = useRef<string | null>(null);

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
  // Defaults chosen for OGF use case: gpt-5.5 + xhigh reasoning under Codex.
  // Real values are loaded per-agent from localStorage in an effect below —
  // these are just the bootstrap values until the agent detection completes.
  // The user is doing real game refactoring where rule-following and
  // multi-file coherence matter more than latency or token cost.
  const [model, setModel] = useState<string>('gpt-5.5');
  const [reasoning, setReasoning] = useState<ReasoningEffort>('xhigh');

  // Per-agent model + reasoning sync.
  // When the user switches CLI in Settings, the model dropdown's options
  // change (Codex has gpt-5.x, Claude has claude-*). Leaving the OLD model
  // id selected when switching to a CLI that doesn't recognize it makes
  // the next run fail with "model X not found" — observed end-to-end in
  // the claude-code-debug.jsonl log. We persist each agent's last-picked
  // model + reasoning separately and swap them on agent.id change.
  useEffect(() => {
    if (!agent?.id) return;
    const newId = agent.id;
    const prevId = prevAgentIdRef.current;

    // Save the values we're about to leave under the previous agent's key.
    if (prevId && prevId !== newId) {
      const mMap = readJsonMap(LS_MODEL_BY_AGENT);
      mMap[prevId] = model;
      writeJsonMap(LS_MODEL_BY_AGENT, mMap);
      const rMap = readJsonMap(LS_REASONING_BY_AGENT);
      rMap[prevId] = reasoning;
      writeJsonMap(LS_REASONING_BY_AGENT, rMap);
    }

    // Load (or initialize) the values for the new agent. If a stored value
    // isn't in the new agent's model list, fall back to the first model.
    if (prevId !== newId) {
      const mMap = readJsonMap(LS_MODEL_BY_AGENT);
      const validModelIds = (agent.models ?? []).map((m) => m.id);
      const storedModel = mMap[newId];
      const nextModel =
        storedModel && validModelIds.includes(storedModel)
          ? storedModel
          : validModelIds[0] ?? 'default';
      setModel(nextModel);

      const rMap = readJsonMap(LS_REASONING_BY_AGENT);
      const storedReasoning = rMap[newId];
      const validReasonings = ['minimal', 'low', 'medium', 'high', 'xhigh'];
      const nextReasoning = validReasonings.includes(storedReasoning)
        ? (storedReasoning as ReasoningEffort)
        : 'xhigh';
      setReasoning(nextReasoning);
    }

    prevAgentIdRef.current = newId;
    // Intentionally not depending on `model` / `reasoning` — those are
    // INPUTS to the save-on-switch branch, not triggers. We only fire when
    // the agent itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, agent?.models]);

  // Persist model + reasoning into the per-agent map whenever they change
  // (covers the case where the user edits them via the dropdowns directly,
  // not just on CLI switch). Without this, the values would only get
  // persisted when the user changes CLI — meaning a Codex user who picked
  // gpt-5.4 mid-session would lose it on next app launch.
  useEffect(() => {
    if (!agent?.id) return;
    const map = readJsonMap(LS_MODEL_BY_AGENT);
    if (map[agent.id] !== model) {
      map[agent.id] = model;
      writeJsonMap(LS_MODEL_BY_AGENT, map);
    }
  }, [agent?.id, model]);
  useEffect(() => {
    if (!agent?.id) return;
    const map = readJsonMap(LS_REASONING_BY_AGENT);
    if (map[agent.id] !== reasoning) {
      map[agent.id] = reasoning;
      writeJsonMap(LS_REASONING_BY_AGENT, map);
    }
  }, [agent?.id, reasoning]);
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  // Form ids the user has submitted in this conversation. Derived from
  // turns rather than separately stored — onSubmitForm already pushes a
  // user message that begins with '## Form answers (id=<formId>)', and
  // messagesToTurns reconstructs that text on refresh from the persisted
  // message history. Scanning that text reproduces the same set without
  // a parallel state to keep in sync (which previously got lost on
  // refresh, leaving every old form in unlocked / countdown mode).
  const submittedForms = useMemo(() => {
    const set = new Set<string>();
    for (const t of turns) {
      const m = /^## Form answers \(id=([^)]+)\)/m.exec(t.userText);
      if (m) set.add(m[1].trim());
    }
    return set;
  }, [turns]);

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

  // Pack staging — generate2dsprite writes a whole anim folder into
  // .ogf/regen/<dir>/. We poll on project select + after each run end.
  const [pendingPacks, setPendingPacks] = useState<import('@ogf/contracts').PendingPack[]>([]);
  const [showPackReview, setShowPackReview] = useState(false);

  // Holds the unsubscribe closer for the most recent subscribeRun call.
  // EventSource leaks if we discard this — every reconnect, conversation
  // switch, or new send() would stack another live SSE connection
  // holding closures over App state. Kill the previous one before
  // starting a new one + on App unmount.
  const runUnsubRef = useRef<(() => void) | null>(null);
  function closeRunSub() {
    if (runUnsubRef.current) {
      runUnsubRef.current();
      runUnsubRef.current = null;
    }
  }
  useEffect(() => () => closeRunSub(), []);

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
  const [showSettings, setShowSettings] = useState(false);
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

  // Agent panel collapse — when true, the right column hides entirely and
  // the editor expands full-width. A small floating handle lets the user
  // bring the panel back. Persists across reloads.
  const [agentCollapsed, setAgentCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(LS_AGENT_COLLAPSED) === '1';
  });
  useEffect(() => {
    localStorage.setItem(LS_AGENT_COLLAPSED, agentCollapsed ? '1' : '0');
  }, [agentCollapsed]);
  // Do NOT auto-expand while running. Previous behavior force-expanded the
  // panel on every render where `running` was true, so collapsing during a
  // run bounced right back open. Stop is reachable from the header runctl
  // anyway; if the user has explicitly collapsed the panel mid-run, respect
  // it. A "running" badge could be added to the collapsed-pane affordance
  // later if discoverability matters more than respecting user intent.

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

  // While a turn is running, refresh the file tree periodically as a
  // safety net. The subscribeRun loop schedules debounced refreshes on
  // Edit / image_gen events, but a long shell command can write files
  // (mv / cp / generate2dsprite Python output) without surfacing as an
  // Edit event. 5s is slow enough not to thrash the daemon and fast
  // enough that the user sees new files appearing as the agent works.
  // The companion levels.json refresh lives below — declared after
  // loadWebLevelRegistry so the closure resolves cleanly.
  useEffect(() => {
    if (!running || !project) return;
    const id = window.setInterval(() => {
      void refreshTree(project);
    }, 5000);
    return () => window.clearInterval(id);
  }, [running, project, refreshTree]);

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

  // While a turn is running, also re-load the levels.json registry on
  // the same 5s safety-net cadence as the file tree above. Without this,
  // agent-written levels mid-run stay invisible in the picker (strict
  // mode) until the user manually refreshes the browser. The fetch is a
  // single small JSON read so cost is negligible. (2DGAMERPG2, 2026:
  // agent created spirit_village_route.json + updated levels.json, but
  // webLevelFiles still held the bootstrap stub level1.json so strict
  // mode hid the new level until a hard refresh.)
  useEffect(() => {
    if (!running || !project || project.engine !== 'web') return;
    const id = window.setInterval(() => {
      void loadWebLevelRegistry(project);
    }, 5000);
    return () => window.clearInterval(id);
  }, [running, project, loadWebLevelRegistry]);

  /** Refresh the pending-pack list from the daemon. Called on project
   *  select and after each run end. */
  const refreshPendingPacks = useCallback(async (p: Project | null) => {
    if (!p) {
      setPendingPacks([]);
      return;
    }
    try {
      const r = await import('./lib/api.js').then((m) => m.fetchPendingPacks(p.path));
      setPendingPacks(r.packs);
    } catch {
      setPendingPacks([]);
    }
  }, []);

  // Boot
  useEffect(() => {
    fetchAgents()
      .then((r) => {
        // Prefer the user-picked CLI from Settings (localStorage). Fall back
        // to the first available agent, then the first listed agent.
        const preferred = localStorage.getItem(LS_PREFERRED_AGENT);
        const match =
          (preferred && r.agents.find((a) => a.id === preferred && a.available)) ||
          r.agents.find((a) => a.available) ||
          r.agents[0] ||
          null;
        setAgent(match);
      })
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
      void refreshPendingPacks(p);

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

  // NOT useCallback — needs to read latest project / refreshTree etc via
  // closure (same reason send() is a regular function).
  async function selectConversation(id: string) {
    // Switching conversations: drop any active SSE stream from the old
    // conversation. subscribeToRun below will re-open if there's an
    // in-flight run on the new conversation.
    closeRunSub();
    setConversationId(id);
    localStorage.setItem(LS_CONVERSATION, id);
    // Snap the active CLI to whichever one owns this conversation. The
    // conversation's agent_id is locked at create time; switching CLIs
    // mid-thread would break resume (codex thread id ≠ claude session id).
    const conv = conversations.find((c) => c.id === id);
    if (conv?.agentId && agent?.id !== conv.agentId) {
      void fetchAgents().then((r) => {
        const next = r.agents.find((a) => a.id === conv.agentId) ?? null;
        if (next) setAgent(next);
      });
    }
    const [r, active] = await Promise.all([
      fetchMessages(id),
      fetchActiveRun(id).catch(() => ({ active: false }) as { active: false }),
    ]);
    setTurns(messagesToTurns(r.messages, active.active === true));
    if (active.active) {
      // Resume the in-flight run after refresh / conversation switch.
      // The user's last message has no agent reply yet because the
      // codex hasn't closed; we already marked that turn as 'streaming'
      // via messagesToTurns(active=true) above.
      setRunId(active.runId);
      setRunning(true);
      subscribeToRun(active.runId);
    }
  }

  /** Wires up the SSE handler for a running codex. Used by both send()
   *  (after createRun spawns a fresh codex) and selectConversation
   *  (after reconnect-on-refresh discovers an active run). The frontend
   *  appends events to the last turn, finalizes on end/error, and
   *  triggers tree / spec refresh on completion.
   *
   *  Capture-phase note: the last turn that events flow into is the
   *  most recent turn in `turns` state. messagesToTurns + send() both
   *  ensure that's the right placeholder. */
  function subscribeToRun(runId: string) {
    closeRunSub();
    runUnsubRef.current = subscribeRun(runId, (e) => {
      if (e.type === 'agent') {
        appendEventToLastTurn(e.data);
        // Schedule a debounced tree refresh on Edit / image_gen events
        // so newly-generated files appear in the sidebar live.
        if (
          e.data.type === 'tool_use' &&
          (e.data.name === 'Edit' || e.data.name === 'image_gen') &&
          project
        ) {
          // Coarse: just refresh after a short delay. The send() path
          // has a fancier debounce; reconnect can stay simple.
          window.setTimeout(() => void refreshTree(project), 800);
        }
      } else if (e.type === 'error') {
        const msg =
          (e.data as { reason?: string }).reason === 'stalled'
            ? 'Run stalled — agent stopped emitting events for 5+ minutes.'
            : e.data.message;
        finalizeLastTurn('failed', msg);
        setRunning(false);
        setRunId(null);
      } else if (e.type === 'end') {
        const status: TurnStatus =
          e.data.status === 'succeeded'
            ? 'done'
            : e.data.status === 'canceled'
              ? 'canceled'
              : 'failed';
        finalizeLastTurn(status);
        setRunning(false);
        setRunId(null);
        setLastRunAt(Date.now());
        if (project) {
          void refreshTree(project);
          void refreshPending(project);
          // The agent commonly writes data/levels.json (the level
          // registry) mid-run. Without this re-load, OGF's
          // webLevelFiles stays empty and the user clicks a freshly
          // generated level file but it opens in Assets tab instead
          // of Scenes — because the routing fallback regex doesn't
          // match agent's semantic file names ('moonlit_ridge.json'
          // doesn't contain 'level' or 'collision-map').
          void loadWebLevelRegistry(project);
          bumpMetadataRev();
          setSceneReloadKey((n) => n + 1);
        }
      }
    });
  }

  const newConversation = useCallback(async () => {
    if (!project) return;
    // New conversation is locked to the currently-selected CLI. Switching
    // CLIs later will require the user to start ANOTHER new conversation
    // (we don't let one conversation span Codex + Claude — the session
    // ids aren't compatible).
    const { conversation } = await createConversation(
      project.path,
      (agent?.id as 'codex' | 'claude-code' | undefined) ?? 'codex',
    );
    setConversations((prev) => [conversation, ...prev]);
    setConversationId(conversation.id);
    localStorage.setItem(LS_CONVERSATION, conversation.id);
    setTurns([]);
  }, [project, agent?.id]);

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
    // submittedForms is derived from turns via useMemo — once send() pushes
    // the new turn with the markdown body, the form's lock kicks in
    // automatically. No parallel state to update.
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
        agentId: agent?.id ?? 'codex',
        prompt: userText,
        projectPath: project.path,
        conversationId: conversationId ?? undefined,
        model: model === 'default' ? undefined : model,
        reasoning,
        refImagePaths: refs.length > 0 ? refs.map((x) => x.relPath) : undefined,
      });

      // Daemon detected a duplicate — same conversation already has an
      // active run. Reuse it instead of creating a fork. This shouldn't
      // normally happen since the UI disables Send while running, but
      // if a refresh / reconnect race leaves the frontend without runId,
      // the daemon catches it and we recover.
      if ('duplicate' in r) {
        setRunId(r.existingRunId);
        subscribeToRun(r.existingRunId);
        return;
      }
      setRunId(r.runId);

      if (!conversationId || conversationId !== r.conversationId) {
        setConversationId(r.conversationId);
        localStorage.setItem(LS_CONVERSATION, r.conversationId);
        if (project) {
          fetchConversations(project.path).then((cr) => setConversations(cr.conversations));
        }
      }

      const turnChanged = new Set<string>();

      // Debounce file-tree refresh during a run. Edit / image_gen events
      // can fire dozens of times per turn (every saved sprite, every JSON
      // tweak); we don't want a tree fetch per event. 600ms gives enough
      // grace for a burst of writes to settle, and feels live to the user.
      let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleTreeRefresh = () => {
        if (!project) return;
        if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
        treeRefreshTimer = setTimeout(() => {
          treeRefreshTimer = null;
          void refreshTree(project);
        }, 600);
      };

      closeRunSub();
      runUnsubRef.current = subscribeRun(r.runId, (e) => {
        if (e.type === 'agent') {
          if (e.data.type === 'tool_use' && e.data.name === 'Edit') {
            const changes = (e.data.input as { changes?: { path?: string }[] })?.changes ?? [];
            let touchedLevelsRegistry = false;
            for (const ch of changes) {
              if (ch.path) {
                const rel = toRelative(ch.path, project?.path ?? '');
                if (rel) turnChanged.add(rel);
                if (
                  ch.path.replace(/\\/g, '/').toLowerCase().endsWith('/data/levels.json')
                ) {
                  touchedLevelsRegistry = true;
                }
              }
            }
            scheduleTreeRefresh();
            // Mid-run: when agent rewrites levels.json (adds new level
            // entries, removes the bootstrap stub), re-load the registry
            // immediately so the picker's strict mode reflects what the
            // agent just wrote — no need to wait for run-end.
            if (touchedLevelsRegistry && project?.engine === 'web') {
              void loadWebLevelRegistry(project);
            }
          }
          // Synthetic image_gen events from the daemon's filesystem watcher
          // also signal new files on disk — refresh the tree so the
          // generated PNGs appear under assets/ without waiting for end.
          if (e.data.type === 'tool_use' && e.data.name === 'image_gen') {
            scheduleTreeRefresh();
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
            // Re-read data/levels.json — the agent often writes /
            // updates the level registry during the turn. Without this,
            // newly-generated level JSONs route to Assets instead of
            // Scenes when clicked.
            void loadWebLevelRegistry(project);
            // Pick up any animation packs the agent staged into
            // .ogf/regen/ during this turn.
            void refreshPendingPacks(project);
            // Bump metadataRev so FileEditor re-fetches sidecar metadata
            // (slicing JSON, .ogf/regen/<relPath> staging probe, etc).
            // Without this, a regenerate completed during the turn won't
            // surface its diff banner until the user switches files or
            // refreshes the page.
            bumpMetadataRev();
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
      setRunId(null);
    }
  }

  async function stop() {
    // Capture runId by value so a Stop click during an in-flight createRun
    // (when running===true but runId is still null for the brief moment
    // before the daemon responds with a runId) doesn't silently no-op
    // forever — we still optimistically reset UI state so the button is
    // never stuck.
    const id = runId;
    if (id) {
      try {
        await cancelRun(id);
      } catch {
        /* daemon already gone or run already ended — fall through */
      }
    }
    // Force-clear UI state regardless. The SSE 'end' will fire too once
    // codex closes, but that may take a moment if the process tree is
    // killing helpers (Python, image_gen workers); we don't want the
    // Stop button to look unresponsive while we wait for that.
    setRunning(false);
    setRunId(null);
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
          // Single source of truth: same isWebLevelCandidate the picker
          // list uses. Without this, sidebar click routing diverged from
          // picker visibility — a level the picker showed could click
          // through to the JSON viewer instead of the canvas editor
          // (haunted_battlefield.json, 2DGAMERPG, 2026).
          const relPosix = rel.replace(/\\/g, '/');
          const ext = relPosix.split('.').pop()?.toLowerCase() ?? '';
          const isScene = ext === 'tscn';
          const isWebLevel =
            project?.engine === 'web' && isWebLevelCandidate(relPosix, webLevelFiles);
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
        data-agent-collapsed={agentCollapsed ? 'true' : 'false'}
        style={{
          gridTemplateColumns: agentCollapsed
            ? '1fr 0 0'
            : `${split}fr 1px ${100 - split}fr`,
        }}
      >
        {project ? (
          <EditorPane
            tab={tab}
            setTab={setTab}
            onOpenSettings={() => setShowSettings(true)}
            project={project}
            tree={fileTree}
            selectedFile={selectedFile}
            onSelectFile={(rel, fk) => {
              // .tscn → scenes; web JSON levels per isWebLevelCandidate
              // (single source of truth shared with the picker list).
              const relPosix = rel.replace(/\\/g, '/');
              const ext = relPosix.split('.').pop()?.toLowerCase() ?? '';
              const isScene = ext === 'tscn';
              const isWebLevel =
                project?.engine === 'web' && isWebLevelCandidate(relPosix, webLevelFiles);
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
            onSwitchToProject={(p) => void selectProject(p)}
            metadataRev={metadataRev}
            onOpenPackReview={() => setShowPackReview(true)}
            onPackResolved={() => {
              void refreshPendingPacks(project);
              void refreshTree(project);
              bumpMetadataRev();
            }}
            canBack={navIndexRef.current > 0}
            canForward={navIndexRef.current < navStackRef.current.length - 1}
            onBack={navBack}
            onForward={navForward}
          />
        ) : (
          <EmptyEditor onOpen={() => setShowOpenModal(true)} />
        )}

        {!agentCollapsed && (
          <div className="split-bar" onMouseDown={onSplitDragStart} title="Drag to resize" />
        )}

        {!agentCollapsed && (
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
            onCollapse={() => setAgentCollapsed(true)}
          />
        )}

        {/* Restore button — only rendered when the panel is collapsed.
         *  Pinned to the editor's right edge as a thin vertical strip
         *  with a chevron, mirroring the sidebar resize affordance. */}
        {agentCollapsed && (
          <button
            type="button"
            className="agent-restore"
            onClick={() => setAgentCollapsed(false)}
            title="Show Codex chat (⌘⇧A)"
            aria-label="Show Codex chat"
          >
            <span className="agent-restore-chev">{I.caret}</span>
            <span className="agent-restore-lbl">Codex</span>
          </button>
        )}
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

      {/* Pending packs floating chip — bottom-right of viewport. Only
          shows when there's at least one pack staged in .ogf/regen/.
          Click → opens PackReviewModal. */}
      {pendingPacks.length > 0 && !showPackReview && (
        <button
          className="pending-packs-chip"
          onClick={() => setShowPackReview(true)}
          title="Review and apply staged animation packs"
        >
          {I.refresh}
          <span>
            {pendingPacks.length === 1
              ? `1 pack ready (${pendingPacks[0]!.fileCount} files)`
              : `${pendingPacks.length} packs ready`}
          </span>
          <span className="muted">→ Review</span>
        </button>
      )}

      {showPackReview && project && pendingPacks.length > 0 && (
        <PackReviewModal
          projectPath={project.path}
          packs={pendingPacks}
          onClose={() => setShowPackReview(false)}
          onPackResolved={() => void refreshPendingPacks(project)}
          onRequestCodeUpdate={(promptText) => {
            // Drop the auto-fired code-update prompt into the composer
            // so the user can review + send (rather than auto-firing —
            // they may want to tweak before submission).
            setPrompt(promptText);
            window.setTimeout(() => {
              const el = document.querySelector('.composer-box textarea') as HTMLTextAreaElement | null;
              el?.focus();
              el?.setSelectionRange(promptText.length, promptText.length);
              el?.scrollTo(0, 0);
            }, 0);
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
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
  onOpenPackReview?: () => void;
  onPackResolved?: () => void;
  onSwitchToProject?: (p: Project) => void;
  onOpenSettings: () => void;
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
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-icon"
          onClick={props.onOpenSettings}
          title="Settings"
        >
          {I.gear}
        </button>
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
              onOpenPackReview={props.onOpenPackReview}
              onPackResolved={props.onPackResolved}
            />
          ) : (
            <ProjectWelcome
              project={props.project}
              onAskCodex={props.onAskCodex}
              onSwitchToProject={props.onSwitchToProject}
            />
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
              engine={props.project.engine}
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
              webLevelFiles={props.sceneFiles}
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

function ProjectWelcome({
  project,
  onAskCodex,
  onSwitchToProject,
}: {
  project: Project;
  onAskCodex?: (text: string) => void;
  onSwitchToProject?: (p: Project) => void;
}) {
  const { confirm: askConfirm, notify } = useDialog();
  const [refactoring, setRefactoring] = useState(false);
  const suggestedDest = project.path + '-ogf';

  async function startRefactor() {
    if (!onAskCodex || !onSwitchToProject) return;
    const ok = await askConfirm({
      title: 'Refactor to OGF structure?',
      body:
        `OGF will COPY this project to:\n\n  ${suggestedDest}\n\n` +
        `Then switch to the copy + drop a refactor prompt in the chat.\n` +
        `The agent will write data/*.json catalogs + .ogf/spec.md ` +
        `describing what's there. Sidecar mode — source code stays.\n\n` +
        `Original at "${project.path}" stays untouched.`,
      confirmLabel: 'Copy + Refactor',
    });
    if (!ok) return;
    setRefactoring(true);
    try {
      const r = await import('./lib/api.js').then((m) => m.refactorCopy({ sourcePath: project.path }));
      onSwitchToProject(r.project);
      // Drop the prompt after a short delay so the project switch settles.
      window.setTimeout(() => onAskCodex(refactorPromptTemplate()), 400);
    } catch (err) {
      notify({
        kind: 'error',
        title: 'Refactor copy failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRefactoring(false);
    }
  }

  return (
    <div className="inspector">
      <div className="crumbs">
        <span className="last">{project.name}</span>
        <span className="badge-dim">{project.engine}</span>
      </div>
      <div className="canvas-area">
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: 14, color: 'var(--ink-1)', marginBottom: 8 }}>
            {project.name}
          </div>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {project.path}
          </div>
          <p style={{ marginTop: 16, color: 'var(--ink-2)', fontSize: 12 }}>
            Pick a file on the left, or ask Codex to make one.
          </p>

          {onAskCodex && onSwitchToProject && (
            <div className="welcome-import-card">
              <div className="welcome-import-title">
                {I.refresh} Have an existing JS game?
              </div>
              <p className="welcome-import-body">
                One-click conversion to OGF structure. OGF first copies this
                project to <code>{suggestedDest.split(/[\\/]/).pop()}</code> next to
                the original (your repo stays untouched), switches to the copy,
                then drops a refactor prompt in the chat. The agent generates{' '}
                <code>data/*.json</code> catalogs + <code>.ogf/spec.md</code>{' '}
                describing what's already there. <strong>Sidecar mode</strong> —
                source code in the copy is also left alone.
              </p>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void startRefactor()}
                disabled={refactoring}
              >
                {refactoring ? 'Copying…' : 'Refactor to OGF structure'}
              </button>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
                Confirm dialog explains the copy step before anything happens.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pre-baked Codex prompt for the 'Refactor existing JS game' button.
 *  Sidecar-mode only: the agent generates OGF metadata files (data/*.json,
 *  .ogf/spec.md) WITHOUT modifying any existing source code or assets. */
function refactorPromptTemplate(): string {
  return `Refactor this project into OGF structure (**sidecar mode** — DON'T modify existing source code, asset files, or anything in the project except creating new \`data/*.json\` and \`.ogf/*\` files).

Goal: produce JSON catalogs + project metadata that describe what's already here, so OGF's asset-centric tools (regenerate pack, scene editor, asset view) can browse this project. The existing game keeps running on its existing code.

## Step 1 — Survey

Identify the engine + entry point:
- Look at: \`package.json\` scripts, \`index.html\`, \`main.js\` / \`game.js\` / \`src/\` structure.
- Detect engine (vanilla canvas / Phaser / P5 / etc.) and report.

Inventory assets:
- Walk \`assets/\` (or wherever sprites / maps / audio live in this project).
- For each PNG sheet that looks like a sprite, note: path, dimensions, suspected animation (idle / walk / attack / etc. from filename or sibling files).
- For each map/background image, note path + dimensions.
- For each audio file, note path + kind.

Inventory entities + scenes:
- Read source code. Identify enemy / hero / item / level definitions wherever they live (constants, classes, JSON data).
- Note any level / scene definitions (literal map data, JSON levels, hardcoded coordinates).

## Step 2 — Generate sidecars

Write OGF-shaped JSON catalogs reflecting what you found. **Don't modify existing source code.**

- \`data/enemies.json\` / \`data/heroes.json\` / \`data/towers.json\` etc. as appropriate. Each entry: \`{ id, displayW, displayH, anchor?, animations?, stats? }\` referencing existing sprite paths.
- \`data/levels.json\` (registry) + \`data/<level_id>.json\` (per-level) IF you found level definitions. Mirror the existing data — don't redesign the level layout.
- \`data/audio.json\` if audio files exist.

The point of sidecar mode: the existing game still runs on its existing code. The new JSON files are ADDITIONAL — OGF reads them for the asset-centric view. Don't refactor the engine, don't move files, don't rename anything.

## Step 3 — Project metadata

\`.ogf/spec.md\` with:
- Project goal (1-2 sentences inferred from code)
- Engine + entry point
- Style directive (palette, line weight, art style — inferred from looking at the art)
- Key entities + their roles

## Step 4 — Report

Summarize:
- Engine detected
- N catalogs written (list paths)
- M entities cataloged, K scenes cataloged
- What you DIDN'T touch (the existing source code paths)
- Anything ambiguous you guessed at and the user should review

Stay focused on writing sidecars. **Do NOT modify existing source code. Do NOT delete or rename existing assets.** If unsure whether something is a sprite vs an icon, flag it in the report instead of guessing wrong.`;
}

function ScenePicker({
  tree,
  onPick,
  project,
  usedAssets,
  mainScene,
  webLevelFiles,
}: {
  tree: FileNode | null;
  onPick: (relPath: string) => void;
  project: Project;
  usedAssets: Set<string>;
  mainScene: string | null;
  webLevelFiles: Set<string>;
}) {
  const [usedOnly, setUsedOnly] = useState<boolean>(() => {
    return localStorage.getItem('ogf:scenes:usedOnly') === '1';
  });
  useEffect(() => {
    localStorage.setItem('ogf:scenes:usedOnly', usedOnly ? '1' : '0');
  }, [usedOnly]);

  const all: FileNode[] = [];
  if (tree) collectScenes(tree, all, project.engine, webLevelFiles);

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

/** Names in data/ that are catalogs / registries / configs — NOT scenes.
 *  Used by the heuristic fallback when data/levels.json hasn't loaded yet
 *  (or doesn't exist). The previous fallback was a positive-pattern regex
 *  that only matched "level*.json" / "*-collision-map.json", which dropped
 *  semantic level names like "haunted_battlefield.json" into the Assets
 *  tab — the user clicked their actual scene and got a JSON viewer
 *  instead of the canvas editor (2DGAMERPG, 2026). The new fallback
 *  inverts the logic: anything in data/*.json that ISN'T on this
 *  blacklist is a candidate scene. Catalog files are well-known names so
 *  the false-positive risk is low. */
const DATA_CATALOG_NAMES = new Set([
  'levels.json',
  'assets.json',
  'enemies.json',
  'items.json',
  'starters.json',
  'pickups.json',
  'quests.json',
  'dialogues.json',
  'npcs.json',
  'heroes.json',
  'towers.json',
  'waves.json',
  'recipes.json',
  'runtime.json',
  'ui.json',
  'music-themes.json',
]);

function isCatalogName(base: string): boolean {
  if (DATA_CATALOG_NAMES.has(base.toLowerCase())) return true;
  // *-config.json / *-strings.json are conventional non-scene patterns
  // (battle-config.json, audio-config.json, battle-strings.json, ...)
  if (/-config\.json$/i.test(base)) return true;
  if (/-strings\.json$/i.test(base)) return true;
  return false;
}

function isWebLevelCandidate(rel: string, knownLevels?: Set<string>): boolean {
  // Web projects: data/<level>.json files are level candidates. The
  // canonical signal is data/levels.json's `file` entries (passed in as
  // `knownLevels`). When that registry is available we use it strictly;
  // otherwise fall back to a catalog-blacklist heuristic so projects with
  // semantic level names ("village_route.json", "haunted_battlefield.json")
  // don't get dropped during the brief async window before the registry
  // loads.
  if (!rel.toLowerCase().endsWith('.json')) return false;
  if (!rel.startsWith('data/')) return false;
  // *-collision-map.json files are SIDECARS, never scenes themselves.
  // They carry mapSize too which fools the loader's level check, so
  // exclude them here even when knownLevels accidentally lists one.
  // Past failure: test-2drpg agent wrote both boss_hall.json (level) and
  // boss_hall-collision-map.json (sidecar); user clicked sidecar; editor
  // showed empty canvas because sidecar has no bg/layers/props.
  const base = rel.split('/').pop() ?? '';
  if (/-collision-map\.json$/i.test(base)) return false;
  if (knownLevels && knownLevels.size > 0) {
    return knownLevels.has(rel.replace(/\\/g, '/'));
  }
  // Heuristic fallback — exclude catalog/config/registry filenames,
  // accept everything else in data/*.json. Permissive on purpose: better
  // to show a non-level JSON in Scenes (loader will reject with a clear
  // "missing mapSize" error) than to hide a real level in Assets.
  return !isCatalogName(base);
}

function collectScenes(node: FileNode, out: FileNode[], engine?: string, knownLevels?: Set<string>) {
  if (node.kind === 'file') {
    if (node.name.toLowerCase().endsWith('.tscn')) out.push(node);
    else if (engine === 'web' && isWebLevelCandidate(node.relPath, knownLevels)) out.push(node);
    return;
  }
  for (const c of node.children ?? []) collectScenes(c, out, engine, knownLevels);
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
  /** Hide the panel (collapses the right column entirely). */
  onCollapse: () => void;
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
        <span className="title">
          {props.agent?.id === 'claude-code' ? 'Claude Code' : 'Codex'}
        </span>
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
          <button
            className="icon-btn agent-collapse-btn"
            onClick={props.onCollapse}
            title="Hide chat panel"
            aria-label="Hide Codex chat panel"
          >
            ›
          </button>
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
                  ? `Ask ${props.agent.id === 'claude-code' ? 'Claude' : 'Codex'} to generate, edit, or fix something… (⌘L to focus)`
                  : `${props.agent?.id === 'claude-code' ? 'Claude Code' : 'Codex'} not detected`
            }
          />
          <div className="composer-actions">
            <MenuPicker
              label="model"
              value={props.model}
              onChange={props.setModel}
              options={(props.agent?.models ?? [{ id: 'default', label: 'Default' }]).map(
                (m) => ({
                  // The agent feeds labels like 'gpt-5.5 · frontier coding'.
                  // The trigger only shows the model id (everything before
                  // ' · '); the popover row keeps both as primary + hint.
                  id: m.id,
                  triggerLabel: m.id,
                  primary: m.id,
                  hint: stripModelHint(m.label, m.id),
                }),
              )}
            />
            {/* reasoning is Codex-specific (model_reasoning_effort flag);
               Claude Code doesn't expose an equivalent knob, so hide it. */}
            {props.agent?.id !== 'claude-code' && (
              <MenuPicker
                label="reasoning"
                value={props.reasoning}
                onChange={(v) => props.setReasoning(v as ReasoningEffort)}
                options={[
                  { id: 'minimal', triggerLabel: 'minimal', primary: 'minimal', hint: 'fastest, no plan' },
                  { id: 'low',     triggerLabel: 'low',     primary: 'low',     hint: 'short reasoning' },
                  { id: 'medium',  triggerLabel: 'medium',  primary: 'medium',  hint: 'balanced' },
                  { id: 'high',    triggerLabel: 'high',    primary: 'high',    hint: 'deep reasoning' },
                  { id: 'xhigh',   triggerLabel: 'xhigh',   primary: 'xhigh',   hint: 'maximum' },
                ]}
              />
            )}
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Position the dropdown via portal so the parent `.agent-pane`'s
  // `overflow: hidden` can't clip it. Without the portal the dropdown
  // visually drops INTO the agent pane's chat area but gets cut off,
  // making it look like the click went into the canvas behind.
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!props.open || !triggerRef.current) return;
    const recompute = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      setPanelPos({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
      });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) props.setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [props.open, props]);

  return (
    <>
      <button
        ref={triggerRef}
        className="btn btn-sm btn-ghost"
        onClick={() => props.setOpen(!props.open)}
        disabled={props.disabled}
        title="History"
      >
        {I.branch} history
      </button>
      {props.open && panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="proj-dropdown"
            style={{
              position: 'fixed',
              top: panelPos.top,
              right: panelPos.right,
              left: 'auto',
              minWidth: 280,
            }}
          >
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
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    padding: '1px 5px',
                    marginRight: 6,
                    borderRadius: 3,
                    fontFamily: 'var(--font-mono)',
                    background:
                      c.agentId === 'claude-code'
                        ? 'rgba(168, 85, 247, 0.18)'
                        : 'rgba(110, 231, 142, 0.18)',
                    color: c.agentId === 'claude-code' ? '#c084fc' : '#6ee78e',
                    textTransform: 'uppercase',
                  }}
                  title={`Created with ${c.agentId === 'claude-code' ? 'Claude Code' : 'Codex'}`}
                >
                  {c.agentId === 'claude-code' ? 'claude' : 'codex'}
                </span>
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
        </div>,
        document.body,
      )}
    </>
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

function messagesToTurns(messages: Message[], hasActiveRun = false): UiTurn[] {
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
    // Trailing user message with no agent reply yet. If the daemon
    // tells us a run is still active for this conversation, show the
    // turn as STREAMING (events will pour in via reconnect SSE) instead
    // of FAILED. The 'No agent response recorded' fallback was wrong
    // for the common 'user refreshed mid-run' case.
    turns.push({
      id: `t-pending`,
      userText: pendingUser.text,
      events: [],
      status: hasActiveRun ? 'streaming' : 'failed',
      startedAt: pendingUser.createdAt,
      endedAt: hasActiveRun ? undefined : Date.now(),
      error: hasActiveRun ? undefined : 'No agent response recorded.',
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

/** Pull the descriptive tail off labels like 'gpt-5.5 · frontier coding'.
 *  If the label is just the id with no separator, returns ''. */
function stripModelHint(label: string, id: string): string {
  if (!label) return '';
  const cleaned = label.trim();
  if (cleaned === id) return '';
  // labels are 'id · description' or 'description'.
  const sep = cleaned.indexOf(' · ');
  if (sep >= 0) return cleaned.slice(sep + 3).trim();
  // label has no separator and isn't the id — treat the whole thing as hint.
  return cleaned;
}

interface MenuOption {
  id: string;
  triggerLabel: string;
  primary: string;
  hint?: string;
}

/** Custom dropdown to replace native <select> in the composer.
 *  The native dropdown popup is unstyleable across browsers, so we
 *  render our own button + popover that opens UPWARD (composer sits
 *  at the bottom of the agent pane — a downward popover would clip). */
function MenuPicker(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: MenuOption[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = props.options.find((o) => o.id === props.value);
  const triggerText = current?.triggerLabel ?? props.value;

  return (
    <div ref={wrapRef} className="menu-picker">
      <button
        type="button"
        className="menu-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${props.label}: ${current?.primary ?? props.value}${current?.hint ? ' · ' + current.hint : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lbl">{props.label}</span>
        <span className="val">{triggerText}</span>
        <span className="caret">{I.caret}</span>
      </button>
      {open && (
        <div className="menu-pop" role="listbox" aria-label={props.label}>
          {props.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={opt.id === props.value}
              className={`menu-pop-row${opt.id === props.value ? ' active' : ''}`}
              onClick={() => {
                props.onChange(opt.id);
                setOpen(false);
              }}
            >
              <span className="primary">{opt.primary}</span>
              {opt.hint && <span className="hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

