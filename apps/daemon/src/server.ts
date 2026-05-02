import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { detectAgents, getAgentDef, resolveOnPath } from './agents.js';
import { spawnCodex, createJsonlParser } from './codex.js';
import { RunManager } from './runs.js';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  setConversationThreadId,
  setConversationTitle,
} from './conversations.js';
import {
  deleteProject,
  detectEngine,
  getProject,
  listProjects,
  renameProject,
  upsertProject,
  type ProjectRow,
} from './projects.js';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readdirSync, statSync } from 'node:fs';
import {
  deleteProjectFile,
  listRefImages,
  listSliceMetadataFiles,
  readProjectFile,
  saveRefImage,
  walkProject,
  writeProjectFile,
} from './files.js';
import { readFileSync } from 'node:fs';
import { analyzeProject } from './analyze.js';
import { findUsages } from './usages.js';
import { findSessionsForCwd, replaySession } from './codex-sessions.js';
import type {
  AgentEvent,
  AgentsResponse,
  Conversation,
  ConversationsResponse,
  CreateConversationRequest,
  CreateRunRequest,
  CreateRunResponse,
  Message,
  MessagesResponse,
  OpenProjectRequest,
  Project,
  ProjectsResponse,
} from '@ogf/contracts';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  const runs = new RunManager();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // -------------------- Agents --------------------

  app.get('/api/agents', async (_req, res) => {
    const agents = await detectAgents();
    res.json({ agents } satisfies AgentsResponse);
  });

  // -------------------- Projects --------------------

  app.get('/api/projects', (_req, res) => {
    const projects = listProjects().map(rowToProject);
    res.json({ projects } satisfies ProjectsResponse);
  });

  app.post('/api/projects/open', (req, res) => {
    const body = req.body as OpenProjectRequest & { create?: boolean };
    console.log('[open]', JSON.stringify(body));
    if (!body?.path) return res.status(400).json({ error: 'path is required' });

    const abs = path.resolve(body.path);
    if (!existsSync(abs)) {
      if (!body.create) {
        return res.status(404).json({
          error: `Folder not found: ${abs}. Check the spelling, or pass create:true to make a new empty project here.`,
        });
      }
      try {
        mkdirSync(abs, { recursive: true });
      } catch (err) {
        return res.status(400).json({
          error: `cannot create folder: ${err instanceof Error ? err.message : err}`,
        });
      }
    }

    const row = upsertProject(abs);
    res.json({ project: rowToProject(row) });
  });

  app.delete('/api/projects', (req, res) => {
    const p = req.query.path;
    if (typeof p !== 'string') return res.status(400).json({ error: 'path query is required' });
    deleteProject(p);
    res.json({ ok: true });
  });

  app.post('/api/projects/rename', (req, res) => {
    const { path: pp, name } = req.body as { path?: string; name?: string };
    if (!pp || !name) return res.status(400).json({ error: 'path and name required' });
    renameProject(pp, name);
    const row = getProject(pp);
    res.json({ project: row ? rowToProject(row) : null });
  });

  app.get('/api/projects/detect', (req, res) => {
    const p = req.query.path;
    if (typeof p !== 'string') return res.status(400).json({ error: 'path query required' });
    const abs = path.resolve(p);
    res.json({ engine: detectEngine(abs), exists: existsSync(abs) });
  });

  app.get('/api/projects/analyze', (req, res) => {
    const p = req.query.projectPath;
    if (typeof p !== 'string') return res.status(400).json({ error: 'projectPath required' });
    const abs = path.resolve(p);
    if (!existsSync(abs)) return res.status(404).json({ error: 'project folder missing' });
    try {
      res.json(analyzeProject(abs, detectEngine(abs)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/projects/pending-slices', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath required' });
    }
    const root = path.resolve(projectPath);
    if (!existsSync(root)) return res.status(404).json({ error: 'project folder missing' });

    try {
      const files = listSliceMetadataFiles(root);
      const pending = [];
      for (const f of files) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(readFileSync(path.join(root, f.relPath), 'utf8'));
        } catch {
          continue;
        }
        const sourcePath = String(parsed.source ?? f.relPath.replace(/\.ogf-slice\.json$/, '.png'));
        const usages = findUsages(root, sourcePath);
        pending.push({
          sourcePath,
          sidecarPath: f.relPath,
          cols: Number(parsed.cols ?? 0),
          rows: Number(parsed.rows ?? 0),
          fps: Number(parsed.fps ?? 0),
          anchor: String(parsed.anchor ?? 'center'),
          padding: Number(parsed.padding ?? 0),
          offsetX: Number(parsed.offsetX ?? 0),
          offsetY: Number(parsed.offsetY ?? 0),
          frameW: typeof parsed.frameW === 'number' ? parsed.frameW : undefined,
          frameH: typeof parsed.frameH === 'number' ? parsed.frameH : undefined,
          mtimeMs: f.mtimeMs,
          usages,
        });
      }
      res.json({ pending });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/projects/pending-slices', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath required' });
    }
    const root = path.resolve(projectPath);
    try {
      const files = listSliceMetadataFiles(root);
      let removed = 0;
      for (const f of files) {
        try {
          deleteProjectFile(root, f.relPath);
          removed++;
        } catch {
          /* ignore */
        }
      }
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/projects/usages', (req, res) => {
    const projectPath = req.query.projectPath;
    const relPath = req.query.relPath;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    const abs = path.resolve(projectPath);
    if (!existsSync(abs)) return res.status(404).json({ error: 'project folder missing' });
    try {
      const hits = findUsages(abs, relPath);
      res.json({ hits });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------- Filesystem browser --------------------

  app.get('/api/fs/list', (req, res) => {
    const raw = (req.query.path as string | undefined) ?? '';
    try {
      const result = listDirectory(raw);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -------------------- Files --------------------

  app.get('/api/files/tree', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath query required' });
    }
    const abs = path.resolve(projectPath);
    if (!existsSync(abs)) return res.status(404).json({ error: 'project folder missing' });
    try {
      res.json({ tree: walkProject(abs) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/files/content', (req, res) => {
    const { projectPath, relPath } = req.query;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    try {
      res.json(readProjectFile(path.resolve(projectPath), relPath));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/content', (req, res) => {
    const body = req.body as { projectPath?: string; relPath?: string; content?: string };
    if (!body?.projectPath || !body?.relPath || typeof body.content !== 'string') {
      return res.status(400).json({ error: 'projectPath, relPath, content required' });
    }
    try {
      const result = writeProjectFile(
        path.resolve(body.projectPath),
        body.relPath,
        body.content,
      );
      res.json({ ok: true, size: result.size });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/files', (req, res) => {
    const { projectPath, relPath } = req.query;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    try {
      deleteProjectFile(path.resolve(projectPath), relPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------- Reference images --------

  app.get('/api/files/refs', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath query required' });
    }
    res.json({ refs: listRefImages(path.resolve(projectPath)) });
  });

  app.post('/api/files/refs', (req, res) => {
    const body = req.body as { projectPath?: string; filename?: string; base64?: string };
    if (!body?.projectPath || !body?.filename || !body?.base64) {
      return res.status(400).json({ error: 'projectPath, filename, base64 required' });
    }
    try {
      const r = saveRefImage(path.resolve(body.projectPath), body.filename, body.base64);
      res.json({ relPath: r.relPath, size: r.size });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/files/refs', (req, res) => {
    const { projectPath, relPath } = req.query;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    if (!relPath.startsWith('.ogf/refs/')) {
      return res.status(400).json({ error: 'not a ref image path' });
    }
    try {
      deleteProjectFile(path.resolve(projectPath), relPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------- Conversations --------------------

  app.get('/api/conversations', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath query required' });
    }
    const conversations = listConversations(projectPath).map(rowToConversation);
    res.json({ conversations } satisfies ConversationsResponse);
  });

  app.post('/api/conversations', (req, res) => {
    const body = req.body as CreateConversationRequest;
    if (!body?.projectPath) return res.status(400).json({ error: 'projectPath required' });
    const project = getProject(body.projectPath);
    if (!project) return res.status(404).json({ error: 'project not found; open it first' });
    const row = createConversation(body.projectPath, body.title);
    res.json({ conversation: rowToConversation(row) });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    deleteConversation(req.params.id);
    res.json({ ok: true });
  });

  // -------------------- Codex sessions (discovery + import) --------------------

  app.get('/api/codex/sessions', (req, res) => {
    const cwd = req.query.cwd;
    if (typeof cwd !== 'string') return res.status(400).json({ error: 'cwd query required' });
    try {
      const sessions = findSessionsForCwd(cwd);
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/conversations/import-codex', (req, res) => {
    const body = req.body as {
      projectPath?: string;
      sessionId?: string;
      replay?: boolean;
      title?: string;
    };
    if (!body?.projectPath || !body?.sessionId) {
      return res.status(400).json({ error: 'projectPath and sessionId required' });
    }
    const project = getProject(body.projectPath) ?? upsertProject(body.projectPath);
    const replayed = replaySession(body.sessionId);
    if (!replayed) return res.status(404).json({ error: 'session not found on disk' });

    const title =
      body.title ??
      (replayed.messages.find((m) => m.role === 'user')?.content?.slice(0, 60) || 'Imported Codex session');

    const conv = createConversation(project.path, title);
    setConversationThreadId(conv.id, body.sessionId);

    let importedCount = 0;
    if (body.replay !== false) {
      for (const m of replayed.messages) {
        appendMessage(
          conv.id,
          m.role,
          m.content,
          m.role === 'agent' ? [{ type: 'text_delta', delta: m.content }] : undefined,
        );
        importedCount++;
      }
    }

    res.json({
      conversation: rowToConversation({ ...conv, codex_thread_id: body.sessionId }),
      importedCount,
    });
  });

  app.post('/api/conversations/:id/title', (req, res) => {
    const { title } = req.body as { title?: string };
    if (!title) return res.status(400).json({ error: 'title required' });
    setConversationTitle(req.params.id, title);
    res.json({ ok: true });
  });

  app.get('/api/conversations/:id/messages', (req, res) => {
    const messages = listMessages(req.params.id).map(rowToMessage);
    res.json({ messages } satisfies MessagesResponse);
  });

  // -------------------- Runs --------------------

  app.post('/api/runs', (req, res) => {
    const body = req.body as CreateRunRequest;
    if (!body || !body.agentId || !body.prompt) {
      return res.status(400).json({ error: 'agentId and prompt are required' });
    }

    const def = getAgentDef(body.agentId);
    if (!def) return res.status(400).json({ error: `unknown agent: ${body.agentId}` });
    const bin = resolveOnPath(def.bin);
    if (!bin) return res.status(400).json({ error: `${def.name} not found on PATH` });

    // Resolve conversation: use provided id, else create one under projectPath.
    let conversationId = body.conversationId;
    let conv = conversationId ? getConversation(conversationId) : undefined;
    if (!conv) {
      if (!body.projectPath) {
        return res.status(400).json({
          error: 'conversationId or projectPath is required',
        });
      }
      const project = getProject(body.projectPath) ?? upsertProject(body.projectPath);
      conv = createConversation(project.path);
      conversationId = conv.id;
    }

    const cwd = path.resolve(conv.project_path);
    try {
      mkdirSync(cwd, { recursive: true });
    } catch (err) {
      return res.status(400).json({
        error: `cannot create projectDir: ${err instanceof Error ? err.message : err}`,
      });
    }

    // Persist user message before run.
    appendMessage(conv.id, 'user', body.prompt);
    if (!conv.title) {
      const guess = body.prompt.trim().slice(0, 60);
      if (guess) setConversationTitle(conv.id, guess);
    }

    const run = runs.create({
      agentId: body.agentId,
      bin,
      cwd,
      model: body.model,
      reasoning: body.reasoning,
    });

    runs.emit(run, 'start', {
      runId: run.id,
      conversationId: conv.id,
      agentId: body.agentId,
      bin,
      cwd,
      model: body.model,
      reasoning: body.reasoning,
      resumed: !!conv.codex_thread_id,
    });

    const composed = composePrompt(body.prompt, body.refImagePaths, !!conv.codex_thread_id);

    let child;
    try {
      child = spawnCodex({
        bin,
        cwd,
        prompt: composed,
        model: body.model,
        reasoning: body.reasoning,
        resumeThreadId: conv.codex_thread_id ?? undefined,
        env: { OGF_PROJECT_DIR: cwd, OGF_CONVERSATION_ID: conv.id, OGF_RUN_ID: run.id },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runs.emit(run, 'error', { message: msg });
      runs.finish(run, 'failed', null, null);
      return res.status(500).json({ error: msg });
    }

    run.child = child;
    run.status = 'running';

    const agentEvents: AgentEvent[] = [];
    let agentTextBuffer = '';

    const parser = createJsonlParser({
      onEvent: (ev) => {
        agentEvents.push(ev);
        if (ev.type === 'text_delta') agentTextBuffer += ev.delta;
        runs.emitAgent(run, ev);
      },
      onThreadId: (id) => {
        if (!conv!.codex_thread_id) {
          setConversationThreadId(conv!.id, id);
          conv!.codex_thread_id = id;
        }
      },
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      runs.emit(run, 'stdout', { chunk: chunk.toString('utf8') });
      parser.feed(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      runs.emit(run, 'stderr', { chunk: chunk.toString('utf8') });
    });
    child.on('error', (err) => {
      runs.emit(run, 'error', { message: err.message });
    });
    child.on('close', (code, signal) => {
      parser.flush();
      const status = code === 0 ? 'succeeded' : 'failed';

      // Persist agent message (text + raw events) so refresh restores it.
      if (agentTextBuffer.trim() || agentEvents.length > 0) {
        appendMessage(conv!.id, 'agent', agentTextBuffer, agentEvents);
      }
      runs.finish(run, status, code, signal);
    });

    res.json({ runId: run.id, conversationId: conv.id } satisfies CreateRunResponse);
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });

    const lastIdHeader = req.header('Last-Event-ID');
    const afterQuery = req.query.after;
    let after: number | undefined;
    if (lastIdHeader) after = Number(lastIdHeader);
    else if (typeof afterQuery === 'string') after = Number(afterQuery);
    if (after !== undefined && Number.isNaN(after)) after = undefined;

    runs.attach(run, res, after);
  });

  app.post('/api/runs/:id/cancel', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    if (run.child && !run.child.killed) {
      run.child.kill();
    }
    res.json({ ok: true });
  });

  return app;
}

function composePrompt(
  userPrompt: string,
  refImagePaths: string[] | undefined,
  isResumed: boolean,
): string {
  const refs = refImagePaths?.length
    ? `\n\n# Reference images\n${refImagePaths
        .map((p) => `- ${p}`)
        .join('\n')}\n\nview_image these references first, then preserve their identity / style when generating new assets.\n`
    : '';

  if (isResumed) {
    // No need to repeat instructions when resuming — they're in the prior turn.
    return `${refs}# User request\n\n${userPrompt}\n`;
  }

  return `# Open Game Forge — agent run

You are working inside an Open Game Forge project. The user is editing a 2D game in this directory. Edit files on disk in the cwd. When generating visible assets, use image_gen and place files under assets/. Report changed files at the end.
${refs}
# User request

${userPrompt}
`;
}

interface FsEntry {
  name: string;
  path: string;
  engine?: string; // detected if it looks like a project
}

interface FsListResult {
  cwd: string;            // resolved current path ('' for drive root listing on Windows)
  parent: string | null;  // null when at top
  parts: { name: string; path: string }[]; // breadcrumb segments
  drives?: string[];      // Windows drive list when at root
  entries: FsEntry[];
  isProject?: boolean;    // current cwd itself looks like a project
  engine?: string;
}

const HIDDEN_PREFIX = ['.', '$', '~'];

function listDirectory(rawPath: string): FsListResult {
  const isWin = process.platform === 'win32';

  // Windows root view: list drives + a few useful starting points
  if (isWin && (rawPath === '' || rawPath === '/')) {
    const drives = listWindowsDrives();
    return {
      cwd: '',
      parent: null,
      parts: [],
      drives,
      entries: drives.map((d) => ({ name: d, path: d })),
    };
  }

  const cwdRaw = rawPath || homedir();
  const cwd = path.resolve(cwdRaw);

  // Test access
  let st;
  try {
    st = statSync(cwd);
  } catch (err) {
    throw new Error(`cannot access: ${err instanceof Error ? err.message : err}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`not a directory: ${cwd}`);
  }

  // Build breadcrumb
  const parts: { name: string; path: string }[] = [];
  let cursor = cwd;
  while (true) {
    const parsed = path.parse(cursor);
    const name = path.basename(cursor) || parsed.root;
    parts.unshift({ name, path: cursor });
    if (cursor === parsed.root) break;
    cursor = parsed.dir;
  }

  const parsed = path.parse(cwd);
  const parent = cwd === parsed.root ? (isWin ? '' : null) : path.dirname(cwd);

  // List subdirs (no files)
  let names: string[] = [];
  try {
    names = readdirSync(cwd);
  } catch {
    names = [];
  }
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (HIDDEN_PREFIX.some((p) => name.startsWith(p))) continue;
    const childAbs = path.join(cwd, name);
    let childSt;
    try {
      childSt = statSync(childAbs);
    } catch {
      continue;
    }
    if (!childSt.isDirectory()) continue;
    const engine = detectEngine(childAbs);
    entries.push({
      name,
      path: childAbs,
      engine: engine === 'unknown' ? undefined : engine,
    });
  }
  entries.sort((a, b) => {
    // projects first
    if (!!a.engine !== !!b.engine) return a.engine ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const selfEngine = detectEngine(cwd);
  return {
    cwd,
    parent,
    parts,
    entries,
    isProject: selfEngine !== 'unknown',
    engine: selfEngine === 'unknown' ? undefined : selfEngine,
  };
}

function listWindowsDrives(): string[] {
  // Try wmic for accurate listing. Fallback to A-Z probe.
  try {
    const out = execSync('wmic logicaldisk get caption /value', {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    const drives: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/Caption=([A-Z]:)/i);
      if (m) drives.push(m[1].toUpperCase() + path.sep);
    }
    if (drives.length > 0) return drives;
  } catch {
    // ignore
  }
  // Fallback: probe drive letters
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const drives: string[] = [];
  for (const l of letters) {
    const root = l + ':' + path.sep;
    try {
      statSync(root);
      drives.push(root);
    } catch {
      /* not present */
    }
  }
  return drives;
}

function rowToProject(r: ProjectRow): Project {
  return {
    path: r.path,
    name: r.name,
    engine: r.engine,
    lastOpenedAt: r.last_opened_at,
    createdAt: r.created_at,
  };
}

function rowToConversation(r: {
  id: string;
  project_path: string;
  title: string | null;
  codex_thread_id: string | null;
  created_at: number;
  updated_at: number;
}): Conversation {
  return {
    id: r.id,
    projectPath: r.project_path,
    title: r.title,
    codexThreadId: r.codex_thread_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToMessage(r: {
  id: number;
  conversation_id: string;
  role: 'user' | 'agent';
  content: string;
  events_json: string | null;
  position: number;
  created_at: number;
}): Message {
  let events: unknown[] | undefined;
  if (r.events_json) {
    try {
      const parsed = JSON.parse(r.events_json);
      if (Array.isArray(parsed)) events = parsed;
    } catch {
      // ignore
    }
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    events,
    position: r.position,
    createdAt: r.created_at,
  };
}
