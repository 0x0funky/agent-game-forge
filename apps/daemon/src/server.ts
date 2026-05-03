import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
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
import { applyOps as applySceneOps, loadScene } from './scenes.js';
import { detectGodot, GodotRunManager } from './godot.js';
import { formatSceneContextSnippet, readSceneContext } from './scene-context.js';
import { bootstrapProject } from './templates/bootstrap.js';
import {
  godotConventions,
  summarizeConventions,
  webConventions,
} from './templates/conventions.js';
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from 'node:fs';
import {
  appendMessage as appendCommentMessage,
  createThread as createCommentThread,
  deleteThread as deleteCommentThread,
  listThreads as listCommentThreads,
  updateThread as updateCommentThread,
} from './comments.js';
import type {
  AgentEvent,
  AgentsResponse,
  AppendCommentMessageRequest,
  AppendCommentMessageResponse,
  ApplySceneOpsRequest,
  ApplySceneOpsResponse,
  Conversation,
  ConversationsResponse,
  CreateCommentThreadRequest,
  CreateCommentThreadResponse,
  CreateConversationRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateRunRequest,
  CreateRunResponse,
  GodotActiveRunResponse,
  GodotDetectResponse,
  GodotStartRequest,
  GodotStartResponse,
  ListCommentsResponse,
  LoadSceneResponse,
  Message,
  MessagesResponse,
  OpenProjectRequest,
  Project,
  ProjectsResponse,
  UpdateCommentThreadRequest,
  UpdateCommentThreadResponse,
} from '@ogf/contracts';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  const runs = new RunManager();
  const godotRuns = new GodotRunManager();

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

  app.post('/api/projects/create', (req, res) => {
    const body = req.body as CreateProjectRequest;
    if (!body?.path || !body?.engine || !body?.name) {
      return res.status(400).json({ error: 'path, engine, name required' });
    }
    if (body.engine !== 'godot' && body.engine !== 'web') {
      return res.status(400).json({ error: `unsupported engine: ${body.engine}` });
    }
    const abs = path.resolve(body.path);
    try {
      const { files } = bootstrapProject({
        rootAbs: abs,
        engine: body.engine,
        name: body.name,
      });
      const row = upsertProject(abs);
      const reply: CreateProjectResponse = {
        project: rowToProject(row),
        files,
      };
      res.json(reply);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  // -------------------- Web project Play (static serve) --------------------
  // Mount any registered project's root under /api/web-play/<slug>/. The slug
  // is base64url(projectPath) so the iframe URL looks like a real directory
  // and relative refs (src="src/game.js" / fetch("data/x.json")) just work.
  app.use('/api/web-play/:slug', (req, res, next) => {
    let projectPath: string;
    try {
      projectPath = Buffer.from(req.params.slug, 'base64url').toString('utf8');
    } catch {
      res.status(400).end('bad slug');
      return;
    }
    const row = getProject(projectPath);
    if (!row) {
      res.status(404).end('project not registered');
      return;
    }
    if (row.engine !== 'web') {
      res.status(400).end('not a web project');
      return;
    }
    return express.static(path.resolve(projectPath), {
      index: 'index.html',
      fallthrough: false,
      etag: false,
      cacheControl: false,
      // Force the browser to revalidate every request. Without this, no
      // Cache-Control header is sent and the browser falls back to heuristic
      // caching (LM-based) — so a freshly-saved JSON might not be re-fetched
      // on the next iframe reload, and the user sees the OLD scene state.
      // 'no-store' is the bluntest option but it's correct for a live editor.
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      },
    })(req, res, next);
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

  // -------------------- Godot runner --------------------

  app.get('/api/godot/detect', async (_req, res) => {
    const info = await detectGodot();
    res.json(info satisfies GodotDetectResponse);
  });

  app.post('/api/godot/run', async (req, res) => {
    const body = req.body as GodotStartRequest;
    if (!body?.projectPath) return res.status(400).json({ error: 'projectPath required' });

    let bin = body.godotPath;
    if (!bin) {
      const info = await detectGodot();
      if (!info.available || !info.path) {
        return res.status(400).json({
          error: 'Godot binary not found. Set OGF_GODOT env var or pass godotPath.',
        });
      }
      bin = info.path;
    }

    if (!existsSync(bin)) {
      return res.status(400).json({ error: `Godot binary missing: ${bin}` });
    }

    const projectAbs = path.resolve(body.projectPath);
    if (!existsSync(path.join(projectAbs, 'project.godot'))) {
      return res.status(400).json({ error: 'Not a Godot project (project.godot missing)' });
    }

    const run = godotRuns.start({
      bin,
      projectPath: projectAbs,
      mainScene: body.mainScene,
    });
    res.json({ runId: run.id } satisfies GodotStartResponse);
  });

  app.get('/api/godot/runs/:id/events', (req, res) => {
    const lastIdHeader = req.header('Last-Event-ID');
    const afterQuery = req.query.after;
    let after: number | undefined;
    if (lastIdHeader) after = Number(lastIdHeader);
    else if (typeof afterQuery === 'string') after = Number(afterQuery);
    if (after !== undefined && Number.isNaN(after)) after = undefined;
    godotRuns.attach(req.params.id, res, after);
  });

  app.post('/api/godot/runs/:id/stop', (req, res) => {
    const ok = godotRuns.cancel(req.params.id);
    res.json({ ok });
  });

  app.get('/api/godot/active', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath required' });
    }
    const runId = godotRuns.activeRunForProject(path.resolve(projectPath));
    res.json({ runId } satisfies GodotActiveRunResponse);
  });

  // -------------------- Scenes (.tscn) --------------------

  app.get('/api/scenes/load', (req, res) => {
    const projectPath = req.query.projectPath;
    const relPath = req.query.relPath;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    try {
      const out = loadScene({ rootAbs: path.resolve(projectPath), relPath });
      res.json(out satisfies LoadSceneResponse);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/scenes/save', (req, res) => {
    const body = req.body as ApplySceneOpsRequest;
    if (!body?.projectPath || !body?.relPath || !Array.isArray(body.ops)) {
      return res.status(400).json({ error: 'projectPath, relPath, ops required' });
    }
    try {
      const r = applySceneOps({
        rootAbs: path.resolve(body.projectPath),
        relPath: body.relPath,
        ops: body.ops,
      });
      const reply: ApplySceneOpsResponse = { ok: true, size: r.size };
      res.json(reply);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Live scene context dump — frontend pushes a snapshot here whenever the
  // user drags / selects / changes scene. Stored in <project>/.ogf/scene-context.json
  // for the agent to read on demand. Also consumed by composePrompt to build
  // the per-turn mini-snapshot.
  app.post('/api/scenes/context', (req, res) => {
    const body = req.body as { projectPath?: string; content?: unknown };
    if (!body?.projectPath || body.content === undefined) {
      return res.status(400).json({ error: 'projectPath and content required' });
    }
    const projectAbs = path.resolve(body.projectPath);
    if (!existsSync(projectAbs)) {
      return res.status(404).json({ error: 'project folder missing' });
    }
    const ogfDir = path.join(projectAbs, '.ogf');
    try {
      mkdirSync(ogfDir, { recursive: true });
      const text = JSON.stringify(body.content, null, 2);
      // Use a temp+rename so concurrent reads never see a partially-written file.
      const tmp = path.join(ogfDir, '.scene-context.tmp');
      const final = path.join(ogfDir, 'scene-context.json');
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, final);
      res.json({ ok: true, size: Buffer.byteLength(text, 'utf8') });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------- Comments --------------------

  app.get('/api/comments', (req, res) => {
    const projectPath = req.query.projectPath;
    const scene = req.query.scene;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath required' });
    }
    try {
      const threads = listCommentThreads(
        path.resolve(projectPath),
        typeof scene === 'string' ? scene : undefined,
      );
      res.json({ threads } satisfies ListCommentsResponse);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/comments', (req, res) => {
    const body = req.body as CreateCommentThreadRequest;
    if (!body?.projectPath || !body?.scene || !body?.anchor || !body?.text) {
      return res.status(400).json({ error: 'projectPath, scene, anchor, text required' });
    }
    try {
      const thread = createCommentThread({
        projectAbs: path.resolve(body.projectPath),
        scene: body.scene,
        anchor: body.anchor,
        text: body.text,
        author: body.author,
      });
      res.json({ thread } satisfies CreateCommentThreadResponse);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/comments/:id/messages', (req, res) => {
    const body = req.body as AppendCommentMessageRequest;
    if (!body?.projectPath || !body?.text) {
      return res.status(400).json({ error: 'projectPath and text required' });
    }
    try {
      const thread = appendCommentMessage({
        projectAbs: path.resolve(body.projectPath),
        threadId: req.params.id,
        text: body.text,
        author: body.author,
      });
      res.json({ thread } satisfies AppendCommentMessageResponse);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/comments/:id', (req, res) => {
    const body = req.body as UpdateCommentThreadRequest;
    if (!body?.projectPath) return res.status(400).json({ error: 'projectPath required' });
    try {
      const thread = updateCommentThread({
        projectAbs: path.resolve(body.projectPath),
        threadId: req.params.id,
        status: body.status,
        anchor: body.anchor,
      });
      res.json({ thread } satisfies UpdateCommentThreadResponse);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/comments/:id', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath query required' });
    }
    try {
      deleteCommentThread({
        projectAbs: path.resolve(projectPath),
        threadId: req.params.id,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

    const composed = composePrompt(
      body.prompt,
      body.refImagePaths,
      !!conv.codex_thread_id,
      cwd,
    );

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
  cwd: string,
): string {
  const refs = refImagePaths?.length
    ? `\n\n# Reference images\n${refImagePaths
        .map((p) => `- ${p}`)
        .join('\n')}\n\nview_image these references first, then preserve their identity / style when generating new assets.\n`
    : '';

  // Per-turn scene snippet — kept small (~80–230 tokens). Always written so
  // the agent doesn't need to fetch when the user's prompt already implies
  // the relevant target ("this prop", "the selected zone", etc).
  const ctx = readSceneContext(cwd);
  const sceneSnippet = formatSceneContextSnippet(ctx);
  const sceneBlock = sceneSnippet ? `\n${sceneSnippet}\n` : '';

  // Per-project conventions. Lookup order:
  //   1. <project>/.ogf/conventions.md  (user-customized version, if present)
  //   2. OGF's built-in template for the detected engine (full doc)
  //   3. Engine-agnostic 8-line summary (last-ditch fallback)
  //
  // Step 2 matters for IMPORTED projects that were never bootstrapped —
  // a typical user opens an existing folder and there's no .ogf/conventions.md
  // on disk. Without this, Codex would see only the tiny generic summary and
  // miss every engine-specific rule (modular split for web, scene patterns
  // for godot, anchor conventions, generate2dsprite skill, ...).
  const conventionsPath = path.join(cwd, '.ogf', 'conventions.md');
  let conventionsBlock = '';
  if (fsExistsSync(conventionsPath)) {
    try {
      const text = fsReadFileSync(conventionsPath, 'utf8');
      conventionsBlock = `\n# Project conventions (.ogf/conventions.md)\n\n${text}\n`;
    } catch {
      // unreadable — fall through to template
    }
  }
  if (!conventionsBlock) {
    const engine = getProject(cwd)?.engine;
    if (engine === 'web') {
      conventionsBlock = `\n# OGF conventions (engine: web — built-in default; no .ogf/conventions.md found)\n\n${webConventions()}\n`;
    } else if (engine === 'godot') {
      conventionsBlock = `\n# OGF conventions (engine: godot — built-in default; no .ogf/conventions.md found)\n\n${godotConventions()}\n`;
    } else {
      conventionsBlock = `\n${summarizeConventions()}\n`;
    }
  }

  if (isResumed) {
    // Resumed turns skip the long system instructions — they're in the prior
    // turn. Still include scene snippet + a short conventions reminder.
    const reminder = `\n${summarizeConventions()}\n`;
    return `${reminder}${sceneBlock}${refs}# User request\n\n${userPrompt}\n`;
  }

  return `# Open Game Forge — agent run

You are working inside an Open Game Forge project. The user is editing a 2D game in this directory. Edit files on disk in the cwd. When generating visible assets, use \`image_gen\` and place files under \`assets/\`. Report changed files at the end.

# Asset / map generation skills

Use the project-installed Codex skills when generating visual content:

- **\`generate2dsprite\`** — for character / enemy / item / FX sprites and
  animation sheets. Decide asset_type / action / view / sheet layout from
  the user's request; the skill handles image_gen + chroma key + frame
  alignment + transparent export.
- **\`generate2dmap\`** — for level backgrounds, prop packs, tilesets,
  parallax layers. The skill picks the right pipeline (baked / layered /
  tilemap / parallax) and emits engine-native files (.tscn for Godot,
  JSON-based for Web).

Reach for these BEFORE writing custom \`image_gen\` prompts. They produce
output that OGF can parse and edit.

# Live editor state

The user's in-app scene editor writes its current state to \`.ogf/scene-context.json\` whenever they drag, select, or change scene. Read that file when:
- the user refers to \"this\" / \"the selected\" / a node by visual position
- you need a list of all props / colliders / zones / paths beyond what's already in the per-turn snippet
- you want to verify a position or shape before/after editing
${conventionsBlock}${sceneBlock}${refs}
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
