import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  detectAgents,
  getAgentAdapter,
  getAgentDef,
  isAgentId,
  resolveOnPath,
} from './agents.js';
import { isSecretKey, listSecretStatuses, setSecret } from './secrets.js';
import { generateImage, GenImageError, type GenImageRequest } from './gen-image.js';
import { logGenImageCall, summarizeGenImageCalls } from './gen-image-log.js';
import { isImageGenProviderPref, readPreferences, writePreferences, type Preferences } from './prefs.js';
import { splitFormsFromText } from './question-form.js';
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
import { execSync, spawn as spawnProcess } from 'node:child_process';
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
import {
  existsSync as fsExistsSync,
  readFileSync as fsReadFileSync,
  copyFileSync as fsCopyFileSync,
  unlinkSync as fsUnlinkSync,
  readdirSync as fsReaddirSync,
  statSync as fsStatSync,
  rmdirSync as fsRmdirSync,
  mkdirSync as fsMkdirSync,
} from 'node:fs';
import {
  appendMessage as appendCommentMessage,
  createThread as createCommentThread,
  deleteThread as deleteCommentThread,
  listThreads as listCommentThreads,
  updateThread as updateCommentThread,
} from './comments.js';
import type { PackLayout } from '@ogf/contracts';
import type {
  AgentEvent,
  AgentId,
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

  // -------------------- Secrets --------------------
  // User-scope API keys for image-gen providers, agent CLIs, etc. Stored
  // in ~/.ogf/secrets.json (mode 600). Env vars (OPENAI_API_KEY etc.)
  // shadow the file at runtime — surfaced via the `fromEnv` flag so the
  // user knows where their value is coming from.
  //
  // GET returns MASKED values + flags. The actual key never leaves the
  // daemon — the web client doesn't need it, only the daemon does, when
  // it calls out to OpenAI/Gemini/etc. on the user's behalf.

  app.get('/api/secrets', (_req, res) => {
    res.json({ secrets: listSecretStatuses() });
  });

  app.post('/api/secrets', (req, res) => {
    const body = req.body as { key?: unknown; value?: unknown };
    if (!isSecretKey(body?.key)) {
      return res.status(400).json({ error: 'invalid secret key' });
    }
    if (body.value !== null && typeof body.value !== 'string') {
      return res.status(400).json({ error: 'value must be string or null' });
    }
    setSecret(body.key, (body.value as string | null) ?? null);
    res.json({ secrets: listSecretStatuses() });
  });

  // -------------------- Image generation --------------------
  // External-provider image gen for agents without built-in image_gen.
  // Codex CLI users keep using Codex's image_gen; this is for Claude Code,
  // future Gemini CLI, bash wrappers, etc.
  //
  // Body shape: see GenImageRequest in gen-image.ts. Required: prompt, outputPath.
  // The daemon writes the PNG to outputPath and returns { path, provider, sizeBytes }.

  app.post('/api/gen-image', async (req, res) => {
    const body = req.body as Partial<GenImageRequest> | undefined;
    if (!body || typeof body.prompt !== 'string' || typeof body.outputPath !== 'string') {
      return res
        .status(400)
        .json({ error: 'prompt (string) and outputPath (absolute string) are required' });
    }
    const t0 = Date.now();
    try {
      const result = await generateImage(body as GenImageRequest);
      logGenImageCall({
        provider: result.provider,
        model: result.model,
        sizeBytes: result.sizeBytes,
        ok: true,
        durationMs: Date.now() - t0,
      });
      console.log(
        `[gen-image] ok provider=${result.provider} model=${result.model} bytes=${result.sizeBytes}`,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof GenImageError) {
        // Only log when we know which provider was being called (router-stage
        // errors like "no key configured" aren't billable).
        if (err.provider !== 'router') {
          logGenImageCall({
            provider: err.provider,
            model: '-',
            sizeBytes: 0,
            ok: false,
            durationMs: Date.now() - t0,
            error: err.message,
          });
        }
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
        console.error(
          `[gen-image] FAIL provider=${err.provider} status=${err.status ?? '-'} msg=${err.message}`,
        );
        return res.status(status).json({
          error: err.message,
          provider: err.provider,
          providerStatus: err.status,
        });
      }
      console.error('[gen-image] unexpected error', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'gen-image failed',
      });
    }
  });

  // User preferences (non-sensitive defaults) — image-gen provider/model
  // pick when the caller doesn't pass explicit values. Sits in
  // ~/.ogf/preferences.json next to secrets.json.
  app.get('/api/preferences', (_req, res) => {
    res.json(readPreferences());
  });

  app.post('/api/preferences', (req, res) => {
    const body = req.body as Partial<Preferences> | undefined;
    const current = readPreferences();
    const ig: Partial<Preferences['image_gen']> = body?.image_gen ?? {};
    const next: Preferences = {
      image_gen: {
        provider: isImageGenProviderPref(ig.provider) ? ig.provider : current.image_gen.provider,
        geminiModel:
          typeof ig.geminiModel === 'string' && ig.geminiModel.length > 0
            ? ig.geminiModel
            : current.image_gen.geminiModel,
        openaiModel:
          typeof ig.openaiModel === 'string' && ig.openaiModel.length > 0
            ? ig.openaiModel
            : current.image_gen.openaiModel,
      },
    };
    writePreferences(next);
    res.json(next);
  });

  // Cost / call-count summary for the Settings panel. Default window =
  // last 24 hours; client can pass ?windowMs=... to widen.
  app.get('/api/gen-image/summary', (req, res) => {
    const windowMsRaw = Number(req.query.windowMs);
    const windowMs =
      Number.isFinite(windowMsRaw) && windowMsRaw > 0
        ? windowMsRaw
        : 24 * 60 * 60 * 1000;
    res.json(summarizeGenImageCalls(windowMs));
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

  /** Refactor existing JS game flow:
   *   1. User opens a folder that's NOT yet an OGF project.
   *   2. Click 'Refactor to OGF structure' → calls this endpoint.
   *   3. We copy <sourcePath> → <destPath> (default: <sourcePath>-ogf
   *      next to source).
   *   4. Register the COPY as a project so the user works on the copy.
   *   5. Original is untouched — user's existing repo / git state safe.
   *
   *   The actual `data/*.json` + `.ogf/spec.md` writes happen in a
   *   subsequent agent turn driven by the refactor prompt template.
   *   This endpoint only does the copy + register. */
  app.post('/api/projects/refactor-copy', (req, res) => {
    const { sourcePath, destPath } = req.body as { sourcePath?: string; destPath?: string };
    if (!sourcePath) return res.status(400).json({ error: 'sourcePath required' });
    const srcAbs = path.resolve(sourcePath);
    if (!existsSync(srcAbs)) return res.status(404).json({ error: `source not found: ${srcAbs}` });

    // Default destination: <source>-ogf next to source.
    const computedDest = destPath
      ? path.resolve(destPath)
      : path.resolve(path.dirname(srcAbs), path.basename(srcAbs) + '-ogf');

    if (existsSync(computedDest)) {
      return res.status(409).json({
        error: `destination already exists: ${computedDest}. Pick a different destination or delete it first.`,
      });
    }

    try {
      // Recursive copy. Skip .git (huge + carries source's history),
      // node_modules (gigantic), and any existing .ogf in the source
      // (clean slate for the new project's spec).
      const skipDirs = new Set(['.git', 'node_modules', '.ogf', 'dist', 'build']);
      const copyRec = (src: string, dst: string) => {
        const stat = statSync(src);
        if (stat.isDirectory()) {
          mkdirSync(dst, { recursive: true });
          for (const entry of readdirSync(src)) {
            if (skipDirs.has(entry)) continue;
            copyRec(path.join(src, entry), path.join(dst, entry));
          }
        } else {
          copyFileSync(src, dst);
        }
      };
      copyRec(srcAbs, computedDest);
    } catch (err) {
      return res.status(500).json({ error: `copy failed: ${err instanceof Error ? err.message : err}` });
    }

    // Register the COPY as the active project. The original stays where
    // it is; OGF doesn't even know about it (no row in the projects table).
    const row = upsertProject(computedDest);
    res.json({ project: rowToProject(row), sourcePath: srcAbs, destPath: computedDest });
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

  // -------- Sprite regenerate staging --------
  // The 'Regenerate' button in FileEditor instructs Codex to write the
  // new sprite to .ogf/regen/<relPath> instead of overwriting. These
  // endpoints let the UI swap-or-discard the staged file once the user
  // has reviewed the side-by-side comparison.

  app.get('/api/files/regen/exists', (req, res) => {
    const { projectPath, relPath } = req.query;
    if (typeof projectPath !== 'string' || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    const root = path.resolve(projectPath);
    const regenAbs = path.join(root, '.ogf', 'regen', relPath);
    if (!regenAbs.startsWith(root)) {
      return res.status(400).json({ error: 'invalid relPath' });
    }
    const exists = fsExistsSync(regenAbs);
    if (!exists) return res.json({ exists: false });
    try {
      const buf = fsReadFileSync(regenAbs);
      res.json({
        exists: true,
        size: buf.length,
        base64: buf.toString('base64'),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/regen/apply', (req, res) => {
    const body = req.body as { projectPath?: string; relPath?: string };
    if (!body?.projectPath || !body?.relPath) {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    const root = path.resolve(body.projectPath);
    const target = path.join(root, body.relPath);
    const regen = path.join(root, '.ogf', 'regen', body.relPath);
    if (!target.startsWith(root) || !regen.startsWith(root)) {
      return res.status(400).json({ error: 'invalid relPath' });
    }
    if (!fsExistsSync(regen)) {
      return res.status(404).json({ error: 'no pending regen at that path' });
    }
    try {
      // Swap: write regen bytes to target, remove staging file.
      // copyFile preserves a working state if anything goes wrong (target
      // is replaced atomically on most platforms; staging deletion is
      // separate so a partial failure leaves the user with the new bytes
      // applied + the staging copy still around — recoverable).
      fsCopyFileSync(regen, target);
      fsUnlinkSync(regen);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/regen/discard', (req, res) => {
    const body = req.body as { projectPath?: string; relPath?: string };
    if (!body?.projectPath || !body?.relPath) {
      return res.status(400).json({ error: 'projectPath and relPath required' });
    }
    const root = path.resolve(body.projectPath);
    const regen = path.join(root, '.ogf', 'regen', body.relPath);
    if (!regen.startsWith(root)) {
      return res.status(400).json({ error: 'invalid relPath' });
    }
    if (fsExistsSync(regen)) fsUnlinkSync(regen);
    res.json({ ok: true });
  });

  // -------- Animation-pack staging --------
  //
  // generate2dsprite writes ~10 files per animation into one directory:
  // sheet.png, individual frames, pipeline-meta.json, intermediates,
  // animation.gif. They are internally consistent; regenerate must
  // operate on the whole directory or the sibling files go stale.
  //
  // A directory IS a pack when it contains BOTH sheet.png AND
  // pipeline-meta.json. Cheap detection — no schema needed.

  /** Walk staging tree under .ogf/regen and yield every pack dir. */
  function listPendingPacks(projectRoot: string): Array<{
    /** project-relative dir (e.g. assets/sprites/scout/idle) */
    packDir: string;
    fileCount: number;
    /** Layout from staging's pipeline-meta.json — null if missing/malformed. */
    stagingLayout: PackLayout | null;
    /** Layout from the live folder's pipeline-meta.json (the pre-apply layout). */
    liveLayout: PackLayout | null;
  }> {
    const stagingRoot = path.join(projectRoot, '.ogf', 'regen');
    if (!fsExistsSync(stagingRoot)) return [];
    const out: ReturnType<typeof listPendingPacks> = [];
    const walk = (absDir: string) => {
      const entries = fsReaddirSync(absDir, { withFileTypes: true });
      const isPack =
        entries.some((e) => e.isFile() && e.name === 'sheet.png') &&
        entries.some((e) => e.isFile() && e.name === 'pipeline-meta.json');
      if (isPack) {
        const packDir = path.relative(stagingRoot, absDir).split(path.sep).join('/');
        const files = entries.filter((e) => e.isFile()).length;
        out.push({
          packDir,
          fileCount: files,
          stagingLayout: readPackLayout(path.join(absDir, 'pipeline-meta.json')),
          liveLayout: readPackLayout(path.join(projectRoot, packDir, 'pipeline-meta.json')),
        });
        return; // don't recurse INTO a pack — packs are leaves
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(absDir, e.name));
      }
    };
    walk(stagingRoot);
    return out;
  }

  function readPackLayout(metaPath: string): PackLayout | null {
    if (!fsExistsSync(metaPath)) return null;
    try {
      const json = JSON.parse(fsReadFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
      const cols = Number(json.cols ?? 0);
      const rows = Number(json.rows ?? 0);
      if (cols < 1 || rows < 1) return null;
      const cellSize = Number(json.cell_size ?? 0);
      const labels = Array.isArray(json.frame_labels)
        ? (json.frame_labels as unknown[]).filter((s) => typeof s === 'string').length
        : 0;
      return {
        cols,
        rows,
        frames: labels || cols * rows,
        cellSize: cellSize > 0 ? cellSize : null,
        // Skill writes `duration` (ms per frame); fps = 1000 / duration when present.
        fps: typeof json.duration === 'number' && json.duration > 0
          ? Math.round(1000 / json.duration)
          : null,
        anchor: typeof json.align === 'string' ? (json.align as string) : null,
      };
    } catch {
      return null;
    }
  }

  /** Apply a single pack atomically — copy every file in staging to live,
   *  then unlink staging files + remove empty dirs. */
  function applyPack(projectRoot: string, packDir: string): {
    applied: string[];
    failed: Array<{ relPath: string; err: string }>;
  } {
    const stagingDir = path.join(projectRoot, '.ogf', 'regen', packDir);
    const liveDir = path.join(projectRoot, packDir);
    const applied: string[] = [];
    const failed: Array<{ relPath: string; err: string }> = [];

    if (!fsExistsSync(stagingDir)) return { applied, failed };

    // Ensure live dir exists (regenerate of a brand-new entity is rare
    // but possible).
    if (!fsExistsSync(liveDir)) fsMkdirSync(liveDir, { recursive: true });

    const stagedFiles = fsReaddirSync(stagingDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);

    for (const name of stagedFiles) {
      const stagedPath = path.join(stagingDir, name);
      const livePath = path.join(liveDir, name);
      const relPath = `${packDir}/${name}`;
      try {
        fsCopyFileSync(stagedPath, livePath);
        fsUnlinkSync(stagedPath);
        applied.push(relPath);
      } catch (err) {
        failed.push({
          relPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Try to remove the empty staging dir (and any newly empty parents
    // up to .ogf/regen). Non-fatal if dir isn't empty.
    let dir = stagingDir;
    const stagingRoot = path.join(projectRoot, '.ogf', 'regen');
    while (dir !== stagingRoot && dir.startsWith(stagingRoot)) {
      try {
        fsRmdirSync(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }

    return { applied, failed };
  }

  function discardPack(projectRoot: string, packDir: string): { discarded: string[] } {
    const stagingDir = path.join(projectRoot, '.ogf', 'regen', packDir);
    if (!fsExistsSync(stagingDir)) return { discarded: [] };
    const discarded: string[] = [];
    const stagedFiles = fsReaddirSync(stagingDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    for (const name of stagedFiles) {
      try {
        fsUnlinkSync(path.join(stagingDir, name));
        discarded.push(`${packDir}/${name}`);
      } catch {
        // best-effort — skip
      }
    }
    let dir = stagingDir;
    const stagingRoot = path.join(projectRoot, '.ogf', 'regen');
    while (dir !== stagingRoot && dir.startsWith(stagingRoot)) {
      try {
        fsRmdirSync(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
    return { discarded };
  }

  app.get('/api/files/regen/packs', (req, res) => {
    const projectPath = req.query.projectPath;
    if (typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath query required' });
    }
    const root = path.resolve(projectPath);
    try {
      res.json({ packs: listPendingPacks(root) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/regen/apply-pack', (req, res) => {
    const body = req.body as { projectPath?: string; packDir?: string };
    if (!body?.projectPath || !body?.packDir) {
      return res.status(400).json({ error: 'projectPath and packDir required' });
    }
    const root = path.resolve(body.projectPath);
    const packDirAbs = path.join(root, '.ogf', 'regen', body.packDir);
    if (!packDirAbs.startsWith(path.join(root, '.ogf', 'regen'))) {
      return res.status(400).json({ error: 'invalid packDir' });
    }
    if (!fsExistsSync(packDirAbs)) {
      return res.status(404).json({ error: 'no pending pack at that dir' });
    }
    try {
      res.json(applyPack(root, body.packDir));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/regen/discard-pack', (req, res) => {
    const body = req.body as { projectPath?: string; packDir?: string };
    if (!body?.projectPath || !body?.packDir) {
      return res.status(400).json({ error: 'projectPath and packDir required' });
    }
    const root = path.resolve(body.projectPath);
    const packDirAbs = path.join(root, '.ogf', 'regen', body.packDir);
    if (!packDirAbs.startsWith(path.join(root, '.ogf', 'regen'))) {
      return res.status(400).json({ error: 'invalid packDir' });
    }
    try {
      res.json(discardPack(root, body.packDir));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
    const agentId = isAgentId(body.agentId ?? '') ? (body.agentId as AgentId) : 'codex';
    const row = createConversation(body.projectPath, agentId, body.title);
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

    // Imported Codex session → conversation owned by 'codex' (only Codex
    // produces these JSONL sessions on disk).
    const conv = createConversation(project.path, 'codex', title);
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

  // Refresh-resume: when the page reloads we lose React state including
  // runId. This endpoint lets the frontend ask the daemon "is there a
  // codex still running for this conversation?" so it can resubscribe
  // to the SSE stream + show a 'still working' state instead of the
  // misleading 'No agent response recorded' fallback.
  app.get('/api/conversations/:id/active-run', (req, res) => {
    const active = runs.activeRunForConversation(req.params.id);
    if (!active) return res.json({ active: false });
    res.json({
      active: true,
      runId: active.id,
      status: active.status,
      startedAt: active.createdAt,
      lastActivity: active.lastActivity,
    });
  });

  // -------------------- Runs --------------------

  app.post('/api/runs', (req, res) => {
    const body = req.body as CreateRunRequest;
    if (!body || !body.agentId || !body.prompt) {
      return res.status(400).json({ error: 'agentId and prompt are required' });
    }

    if (!isAgentId(body.agentId)) {
      return res.status(400).json({ error: `unknown agent: ${body.agentId}` });
    }
    const def = getAgentDef(body.agentId);
    if (!def) return res.status(400).json({ error: `unknown agent: ${body.agentId}` });
    const bin = resolveOnPath(def.bin);
    if (!bin) return res.status(400).json({ error: `${def.name} not found on PATH` });
    const adapter = getAgentAdapter(body.agentId);

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
      // Auto-created conversation inherits the CLI from the run request —
      // this is "user typed a new prompt without picking a conversation",
      // so use whatever CLI they have active.
      conv = createConversation(project.path, body.agentId);
      conversationId = conv.id;
    } else if (conv.agent_id !== body.agentId) {
      // Conversation is locked to its original CLI. Trying to run a
      // different CLI in this conversation would either fail (incompatible
      // session id format) or silently lose context. Reject with a clear
      // error so the UI can surface the conflict.
      return res.status(409).json({
        error: `Conversation belongs to ${conv.agent_id}, not ${body.agentId}. Start a new conversation to switch CLIs.`,
        conversationAgentId: conv.agent_id,
      });
    }

    // Dedupe: don't spawn a second codex when one is already running for
    // this conversation. test-platfromer3 hit a 'two codex same thread'
    // race when the user clicked continue after the first run silently
    // stalled. Returning 409 here lets the frontend reuse the existing
    // runId via SSE reconnect instead of forking the work.
    const existing = runs.activeRunForConversation(conv.id);
    if (existing) {
      return res.status(409).json({
        error: 'Conversation already has an active run',
        existingRunId: existing.id,
        startedAt: existing.createdAt,
      });
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

    const run = runs.create(
      {
        agentId: body.agentId,
        bin,
        cwd,
        model: body.model,
        reasoning: body.reasoning,
      },
      conv.id,
    );

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
      child = adapter.spawn({
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

    // Codex CLI v0.128 does NOT stream image_generation_call / _end events
    // to stdout — image_gen runs silently and just writes the file. We
    // detect generated images by watching the project workspace: any
    // .png / .jpg / .jpeg / .webp / .gif appearing during the run gets
    // surfaced as a synthetic 'image_gen' tool group in the chat. Without
    // this, the user generates 5 sprites and sees nothing in the chat
    // panel.
    const imageWatcher = startImageWatch(cwd, (relPath) => {
      const id = `synth_image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      runs.emitAgent(run, {
        type: 'tool_use',
        id,
        name: 'image_gen',
        input: { detected: relPath },
      });
      runs.emitAgent(run, {
        type: 'tool_result',
        toolUseId: id,
        content: JSON.stringify({ paths: [relPath] }),
        isError: false,
      });
    });

    const agentEvents: AgentEvent[] = [];
    let agentTextBuffer = '';

    const parser = adapter.makeParser({
      // Heartbeat: every line read from the agent's stdout resets this
      // run's stall timer. The watchdog in runs.ts kills runs that go
      // silent for 5+ minutes (image_gen hung, network blip, etc).
      onActivity: () => runs.touch(run),
      onEvent: (rawEv) => {
        // Split agent text into prose + structured form events. Codex emits
        // <question-form id="..."> blocks in its plain text — we extract
        // them here so the UI can render real form controls and the chat
        // log doesn't show raw XML.
        const expanded =
          rawEv.type === 'text_delta'
            ? splitFormsFromText(rawEv.delta).events
            : [rawEv];
        for (const ev of expanded) {
          agentEvents.push(ev);
          if (ev.type === 'text_delta') agentTextBuffer += ev.delta;
          runs.emitAgent(run, ev);
        }
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
      imageWatcher.stop();
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
    killProcessTree(run.child);
    res.json({ ok: true });
  });

  return app;
}

/** Kill a child process AND every grandchild it spawned.
 *
 *  Why this exists: on Windows the codex CLI is `codex.cmd`, so spawn() runs
 *  cmd.exe → cmd.exe → codex.exe (and codex.exe may spawn its own helpers
 *  for image_gen / Python tools). child.kill() sends SIGTERM only to the
 *  immediate child (cmd.exe), leaving codex.exe alive as an orphan that
 *  keeps burning API tokens and writing files even after the user clicks
 *  Stop. taskkill /T walks the process tree.
 *
 *  POSIX has process groups (negative PID) for the same purpose; we'd need
 *  to spawn with `detached: true` for that to work, which we don't currently
 *  do. Linux/macOS users get the basic kill() behavior — fine because they
 *  don't have the .cmd shim layer that creates the orphan in the first
 *  place. */
/** Watch a project workspace for new image files appearing during a run.
 *
 *  Why: Codex CLI v0.128's `exec --json` stdout does NOT emit any
 *  image_generation events — image_gen is a silent built-in tool that
 *  writes the output file directly into the workspace. So the stream
 *  never tells us 'an image was generated'. The only signal we have is
 *  that a new PNG/JPG/WEBP/GIF appeared on disk somewhere under the
 *  project directory.
 *
 *  Implementation: snapshot every existing image path at run start, then
 *  poll once per second for additions. Each new path triggers the
 *  callback. We also re-poll the path's mtime + size to make sure the
 *  file has stopped growing before reporting it (image_gen writes can
 *  take 1-2 seconds for large sheets) — otherwise the frontend renders
 *  a partial PNG.
 *
 *  Skips: anything under common non-asset folders (.git, node_modules,
 *  .ogf, build output) — those churn for unrelated reasons during a
 *  run and would emit false positives. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const SKIP_DIR = new Set(['.git', 'node_modules', '.ogf', 'dist', 'build', '.godot', 'Library', 'Temp']);

function listImagesUnder(root: string): Map<string, { size: number; mtime: number }> {
  const out = new Map<string, { size: number; mtime: number }>();
  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && SKIP_DIR.has(e.name)) continue;
      if (SKIP_DIR.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && IMAGE_EXT.test(e.name)) {
        try {
          const st = statSync(full);
          out.set(full, { size: st.size, mtime: st.mtimeMs });
        } catch {
          /* file vanished mid-walk — skip */
        }
      }
    }
  }
  walk(root);
  return out;
}

function startImageWatch(
  projectPath: string,
  onNewImage: (relPath: string) => void,
): { stop: () => void } {
  const baseline = listImagesUnder(projectPath);
  const seen = new Set(baseline.keys());
  // Files we noticed but haven't yet emitted because they're still being
  // written — we wait until size stops growing for two consecutive polls.
  const pending = new Map<string, { size: number; pollsStable: number }>();

  const interval = setInterval(() => {
    const current = listImagesUnder(projectPath);
    for (const [full, meta] of current) {
      if (seen.has(full)) continue;
      const prev = pending.get(full);
      if (prev && prev.size === meta.size) {
        prev.pollsStable += 1;
        if (prev.pollsStable >= 1) {
          // Two polls (≥1.5s) at the same size — file write done.
          seen.add(full);
          pending.delete(full);
          const rel = path.relative(projectPath, full).replace(/\\/g, '/');
          try {
            onNewImage(rel);
          } catch {
            /* never let a bad emit kill the watcher */
          }
        }
      } else {
        pending.set(full, { size: meta.size, pollsStable: 0 });
      }
    }
  }, 1000);

  return {
    stop: () => {
      clearInterval(interval);
    },
  };
}

function killProcessTree(
  child: import('node:child_process').ChildProcess | undefined,
): void {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === 'win32') {
    spawnProcess('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    child.kill();
  }
}

/** The post-form-answers workflow, extracted so we can inject it on the
 *  resumed turn that delivers the answers (where the long system preamble
 *  is otherwise skipped). The fresh-turn preamble below also includes this
 *  text inline, so Codex sees it during the discovery turn for context. */
const RESUMED_FORM_WORKFLOW = `# You just received form answers — execute the spec workflow now

Treat the user's '## Form answers' block above as the discovery answers for this project.

If the form id is \`game-discovery\`: write the spec, then ask for approval.
If the form id is \`spec-approval\` and the user said yes: execute every phase.
If the form id is \`spec-approval\` and the user requested changes: revise the spec, then ask again.

## Step 1 (only after id=game-discovery) — write \`.ogf/spec.md\`

Use this exact 8-section structure:

\`\`\`markdown
# Game Spec — <project name>

## 1. Identity
- Genre / Art style / World setting / Color mood / Premise / Target session length / Completeness tier / Difficulty / Win condition
- Engine: read from the conventions block above (web or godot — DON'T re-ask the user, the project's engine was fixed at creation)
- References: list any reference games the user named — they're the strongest single signal for what to build, treat them as soft constraints throughout
- **View / camera** (REQUIRED — derived from genre + camera): \`top-down\` / \`3/4 isometric\` / \`pure side view\` / \`forced 2.5D\` / \`locked screen\` / \`parallax\`. EVERY gen prompt must include this verbatim alongside the Style directive — without it the model picks the wrong perspective for your game (a side-view platformer hero rendered for a tower-defense top-down camera looks broken in-engine).
- **World scale** (REQUIRED — viewport + actor height + key-asset footprint): e.g. \`1280×720 battlefield, ~48px actor height, ~64px tower footprint\`. Tells the model the density expectation so it doesn't render the actor too detailed for the screen real estate.
- **Style directive** (REQUIRED — write a 1-2 sentence concrete art-direction line combining art_style + color_mood + world_setting + references). This sentence is the SOURCE OF TRUTH for every visual asset and you MUST paste it VERBATIM into every \`generate2dsprite\` and \`generate2dmap\` call's prompt — alongside the Genre / View / Scale fields above so the model has both art style AND game context. Don't paraphrase. Don't drop fields. Examples:
  - art_style=pixel + color_mood=warm + world=historical-Japan + ref=Mega Man:
    "Style: 16-bit chunky pixel art, ~48px sprite height, sharp pixel edges, no anti-aliasing, warm sunset palette (deep reds / burnt orange / gold), feudal-Japan motifs (hakama, katana, lanterns), readable Mega Man-style silhouettes."
  - art_style=painterly + color_mood=dark + world=horror + ref=Hollow Knight:
    "Style: hand-painted 2D, atmospheric loose brushwork, muted dark palette (deep teals / black / single bone-white accent), gothic horror motifs (broken stone / fungal growth), Hollow Knight-style readable silhouettes against textured backgrounds."
  - art_style=neon + color_mood=cool + world=scifi + ref=Hyper Light Drifter:
    "Style: high-contrast neon pixel art, cool palette (electric cyan / magenta / deep navy), retro-futurist sci-fi motifs (chrome / glow lines / glitch artifacts), Hyper Light Drifter-style minimal but punchy silhouettes."
  Without this directive in your gen calls, the model defaults to generic illustration — the user picked 'pixel' and got 'painterly'. Don't ship that.
- **Visual anchor**: \`.ogf/style-anchor.png\` (project-wide visual canon — created by the first generate2dsprite call's output, then referenced by every subsequent call via view_image). Note in the spec that Phase 1 must establish this anchor BEFORE generating any characters. Once it exists, every later \`generate2dsprite\` / \`generate2dmap\` call MUST view_image the closest existing reference (same-character sheet > same-family sibling > anchor) and pass \`reference: 'generated_image'\` to the skill. This is enforced by the conventions; spec just declares the asset's existence here.

## 2. Player config
- Sprite layout (NxM at K fps + sprite size)
- Animations (list — see RULES below for minimums per genre)
- HP / lives / damage model
- Moveset (verbs the player can perform)

## 3. World
- Levels (count + ids)
- Camera behavior
- **Per-level visual structure** — which the level JSON's visible-art field shape MUST be:
  - Locked / single-screen camera (TD, arena, VN, puzzle):
    \`background: { image: "assets/maps/<id>/background.png" }\` is acceptable.
  - Scrolling / parallax camera (side-scroller, top-down RPG, roguelike with rooms):
    Use \`layers: [{ image, parallax, zIndex }, ...]\`. NOT \`background: <single>\`.
    Parallax-capable genres need multi-layer to look right; if you write
    'background' singular for a side-scroller, you've locked yourself
    into a flat scene before generate2dmap even runs.
- **Per-level gameplay structure** — which arrays each level JSON holds (e.g. \`platforms[]\`, \`hazards[]\`, \`pickups[]\`, \`enemies[]\`, \`zones\`, \`exits\`).

## 4. Catalogs
(arrays of objects ONLY: enemies, items, hazards, pickups. Player config does NOT belong here — it's in §2.)
- enemies.json: <count> enemies — for EACH enemy list:
  - id + 1-line role description
  - kind: melee | ranged | flying | stationary | boss
  - **animations** the enemy actually uses (NOT a uniform list — pick by role):
    - stationary (turret / archer holding ground): \`idle + attack\` (2)
    - patrol melee: \`idle + walk + attack\` (3)
    - flying / hovering: \`fly + attack\` (2)
    - boss: \`idle + walk + attack + hurt\` (4)
    - default: at least \`idle + attack\` (2)
  - DON'T add jump / cast / dash / death unless gameplay actually uses them. A ground melee enemy doesn't need jump. A minor mob doesn't need death — just remove the sprite when HP=0.
- items.json / pickups.json / etc. as needed

## 5. Progression
- Score / lives / checkpoints / save: yes/no per item, mechanism if yes

## 6. OGF Layout
- File paths Codex will create

## 7. Phase plan
- [ ] Phase 1: <real deliverable> — VERIFY: <user-visible action in OGF>
- [ ] Phase 2: ...
(8–15 phases for core tier, 12–20 for polished, 6–8 for minimal — see RULE 8 + RULE 8a below for sizing rules)

**Phase sizing budget**: each phase MUST fit in ONE codex turn. As a
rule of thumb, each phase should produce at most ~6-8 \`image_gen\`
results, ~15-20 file edits, and one logical user-visible deliverable.
If a phase says "generate ALL enemies (5 enemies)" — that's 5 separate
image_gen calls + skill processing + wiring = blows past the budget.
Split into 5 phases, one per enemy. Total project asset count is NOT
capped; only the per-phase fanout is. A polished-tier project with
5 enemies + 3 towers + 1 hero → roughly 9 separate sprite phases.

Concrete pattern for a side-scrolling platformer (core tier ~12 phases):
- [ ] Phase 1: Visual anchor — generate \`.ogf/style-anchor.png\` only.
- [ ] Phase 2: Map background and layers — generate parallax layers via \`generate2dmap\` side_scroll_mode for level 1, wire into \`data/levels/level_1.json\` \`layers[]\`.
- [ ] Phase 3: Level scene structure — author platforms, hazards, pickups, exit zones in level JSON.
- [ ] Phase 4: Player sprite — generate ronin via \`generate2dsprite\` (idle + walk + jump + attack as anim rows).
- [ ] Phase 5: Player controller — wire movement, double-jump, attack hitbox, camera follow.
- [ ] Phase 6: Enemy 1 (\`ashigaru_spearman\`) — sprite + AI + place in level.
- [ ] Phase 7: Enemy 2 (\`yumi_archer\`) — sprite + AI + projectile + place.
- [ ] Phase 8: Enemy 3 (\`rebel_commander\`) — sprite + boss-room scene + boss AI.
- [ ] Phase 9: Pickups + hazards — generate war_order, spike, fire_pit sprites + place + collection logic.
- [ ] Phase 10: HP / lives / score UI — \`data/hud.json\` + render.
- [ ] Phase 11: Win / loss screens — gate trigger + game-over state.
- [ ] Phase 12: Audio + polish — sfx hooks, particles, screen shake.

Each of those phases is one codex turn. Some may be quick (Phase 1,
3, 11) — that's fine, short turns are good. Some may run close to
budget (Phase 2 with 4-5 layer PNGs + processing) — still inside one
turn.

## 8. Out of scope (V1)
- <explicit list of features deliberately deferred>
- For each feature the user PICKED in the form but won't actually be in V1, add a row: "<feature> — DEFERRED to V2 because <reason>"
\`\`\`

## RULES for spec quality (failures Codex made before)

These rules came from real specs that produced broken games:

1. **Phase 1 must be a real deliverable, not 'write the spec'.** Spec writing is the prelude, not Phase 1. Phase 1 is the first thing the user can run/see.
2. **Each phase's verification MUST be user-visible in OGF.** Examples: 'open Play tab, see the player walk', 'open Scenes tab, see 5 platforms laid out', 'press jump key, player rises'. NOT 'verify file parses' or 'verify Godot resource files exist' — those are syntactic checks the user gets nothing from.
3. **Even \`minimal\` tier MUST be a playable game, not a static demo.** That means real animations for visible verbs (idle + walk minimum for any character that moves; idle + attack for any character that attacks; idle + walk + jump for platformers). A platformer with idle-only animation is broken — character freezes during movement and the user can't tell anything works.
4. **Catalogs section (§4) is for arrays only.** Player / hero is singular config — put it in §2 (Player config), not §4. Same for any other named singular entity.
5. **Features the user picked but won't be in V1** must be listed in §8 with explicit '(DEFERRED to V2)' tags + reason. Don't pretend with phrases like 'audio hooks' — either it works or it's deferred.
6. **For Godot projects**: phase verification must mention 'open Play tab' / 'press F5' / 'Scenes tab shows X', not 'verify .gd parses'. The user's measurement is 'can I see / play it', not 'does the file load'.
7. **For Godot projects**: \`.tscn\` is the spatial source of truth. Per-level JSON (if any) holds metadata only — music, story text, win-condition flags. NOT positions / platform layouts / spawn coords; those go in the .tscn.
8. **Per-tier minimums** (revise the spec if the picked tier can't fit):
   - **minimal**: 1 character × 3 anims (idle/walk/jump or idle/walk/attack), 1 enemy × 2 anims (idle/walk or idle/attack), 1 short level with at least 3 platforms + 1 enemy encounter, win/loss state.
   - **core**: 1 character × 4 anims, 3 enemy types × 2 anims each, 1 level + 1 boss room, basic UI (HP bar).
   - **polished**: 2 characters × 5 anims each, 5 enemies, 3 levels, pickup system, scoring, menu screens.
   - **full**: 3+ characters × 6+ anims, 8+ enemies, 5+ levels, save system, polish loops.

8a. **Phase sizing — each phase MUST fit ONE codex turn (≤~6-8 image_gen, ≤~15-20 file edits, one user-visible deliverable).** This is NOT a cap on the project's total asset count — split big work across more phases. Two anti-patterns:
    - ❌ "Phase X: Generate all 5 enemies" — that's 5 image_gen calls in one turn, plus reference chaining adds ~50K tokens per call → 1M+ tokens just for assets, then skill processing piles on. Agent will self-abort mid-phase ('I can't complete this in one response') and you'll have a half-finished phase with no progress marker flipped.
    - ❌ "Phase X: Player + 3 enemies + boss + UI + audio + polish" — too many concerns; failure of any one drops the whole phase.
    Correct: one phase per logical asset family + wiring. A core-tier game with 1 hero + 3 enemies + 1 boss + 5 props is ~10-12 phases. A polished-tier game with 2 heroes + 5 enemies + 1 boss + 8 props is ~14-18 phases. Phase counts are NOT a cost — short phases finish faster and let you ship interrupted projects.

8b. **Mid-phase checkbox flips are MANDATORY**. The moment you finish a phase's deliverable (the user-visible state described in VERIFY), the SAME turn you must edit \`.ogf/spec.md\` to flip that phase's \`- [ ]\` to \`- [x]\`. Don't batch flips at the end of a multi-phase turn — if the run is interrupted (network, token limit, user stop), only flipped phases are recoverable. The spec.md state IS the resume point: 'continue from where you left off' means 'find the next \`- [ ]\` and start there'. An unflipped finished phase looks like unfinished work and the agent will redo it.

  9. **Generate sprites with \`generate2dsprite\`, NEVER raw \`image_gen\`.** Each cell of an animation row MUST be a distinct pose progression — submitting a 4×4 sheet where every cell is the same pose ships a frozen-corpse character. Frame COUNT per anim is your judgement (genre / completeness / target style decide), but the count must mean what it claims: a 4-frame walk row shows 4 distinct walk poses, not 1 pose × 4. Spec §2 should list animation NAMES; per-anim frame counts can be authored at sheet-generation time.

  9a. **Every gen prompt MUST include game-context (genre + view + scale)** in addition to the Style directive. Without it the model picks the wrong perspective for your game (e.g. a side-view platformer hero for a tower defense top-down camera) and the asset looks broken in-engine. Concrete example: 'Genre: tower defense (Kingdom Rush-like). View: 3/4 top-down. World: 1280×720 battlefield, ~48px actor height, ~64px tower footprint. Style: <directive verbatim>. Generate <asset>...'. See conventions for required fields per skill call.

  9c. **Level visual schema MUST match camera mode.** If §3 Camera is \`scroll\` / \`follow\` / \`parallax\` (i.e. anything that scrolls), the per-level visual structure MUST be \`layers: [...]\` not \`background: <single>\`. Writing single-bg schema for a scrolling-camera genre (side-scroller, top-down RPG with scrolling, roguelike rooms) is a self-inflicted lock-in: even when you call generate2dmap with \`map_mode: side_scroll_mode\` and the skill produces 4 parallax PNGs, your spec already declared \`background: <one image>\` so you'll throw away the layers. Decide schema BEFORE calling the skill; the schema must match what the skill will output for that genre.

  9d. **Multi-animation entities split into per-animation sheets.** Player already does this (separate generate2dsprite call per idle / walk / jump / attack). Apply the SAME pattern to enemies, bosses, and any NPC with more than one animation: one skill call per named animation, each producing its own 2x2 / 2x3 / 3x3 sheet. Catalog references each sheet via \`animations: { idle: {sprite, fps}, attack: {sprite, fps} }\` open object — NOT a single \`sprite\` field with combined frames. Why: collapsing 8-frame 'combat' (idle+attack merged) forces the slicer into 2x4, which produces 50%+ edge-touch frames in practice (verified on TD-game / test-platformer). The per-animation split also lets runtime call \`enemy.animations.attack\` instead of hardcoding 'frames 4-7 are attack'. Per-role animation set: stationary=\`idle+attack\`, melee patrol=\`idle+walk+attack\`, flying=\`fly+attack\`, boss=\`idle+walk+attack+hurt\`. NEVER add jump/cast/dash/death unless gameplay actually uses them.

  9b. **Visual consistency: every gen after the first MUST reference an existing asset.** Image generation is stochastic — same character generated twice independently looks like two different people. Phase 1 MUST establish \`.ogf/style-anchor.png\` (or designate the first character's idle sheet as the de-facto anchor). Every subsequent \`generate2dsprite\` / \`generate2dmap\` call must \`view_image\` the closest reference (same-character sheet > same-family sibling > anchor) BEFORE calling the skill, and pass \`reference: 'generated_image'\` so the skill knows to chain. Pasting a path string into the prompt without view_image does NOT count — bytes have to be in context. Skipping this is the #1 cause of "the same character looks different in idle vs walk" bugs we've shipped. See conventions for the exact prompt phrasing per reference role.

  10. **Godot only — author the wrapper-position pattern for unified props.** Platforms / walls / static decorations should be \`StaticBody2D\` wrappers with \`Sprite2D\` and \`CollisionShape2D\` children at local \`(0, 0)\`. The wrapper owns the position; both children inherit. In OGF Scenes tab the prop and collider will appear linked — moving one moves both. That's correct. See conventions for when to break the pattern (e.g. trunk-only collider on a wide tree sprite). Spec §6 should list each prop kind's structure: 'PlatformX (StaticBody2D / wrapper) → Sprite2D + CollisionShape2D' so the user knows what's linked vs independent.

## Step 2 (after writing spec) — emit a spec-approval form

After writing spec.md, immediately emit this form (don't start work):

\`\`\`
<question-form id="spec-approval">
{
  "id": "spec-approval",
  "title": "Plan looks good?",
  "intro": "I drafted .ogf/spec.md with the phase plan above. Confirm before I start, or ask for changes.",
  "fields": [
    {
      "key": "decision",
      "label": "Ready to execute?",
      "type": "radio",
      "required": true,
      "options": [
        { "value": "yes",       "label": "Yes — execute all phases now" },
        { "value": "split",     "label": "Looks too coarse — split phases finer" },
        { "value": "fewer",     "label": "Too many phases — merge / drop some" },
        { "value": "rescope",   "label": "Wrong scope — change tier / catalog / animations" }
      ]
    },
    {
      "key": "notes",
      "label": "If not 'yes' — what to change?",
      "type": "textarea",
      "placeholder": "e.g. split Phase 3 into movement / collision / damage; or drop save feature; or add walk animation to enemy"
    }
  ]
}
</question-form>
\`\`\`

Then STOP. Don't add prose after \`</question-form>\`.

## Step 3 (after id=spec-approval with decision=yes) — execute autonomously

Now execute every phase from spec.md in order. After each phase, edit \`.ogf/spec.md\` to flip the row's \`- [ ]\` → \`- [x]\`. The OGF UI watches the file and shows live progress to the user.

End the turn with a one-paragraph summary: what was built, what to verify in OGF (Play tab, Scenes tab, etc), and any TODOs.

Don't emit more forms. The approval IS the green light.

If you discover mid-execution that the picked completeness tier is wrong (e.g. \`polished\` would actually take 200K tokens not 80K), STOP, edit the spec to flag the issue, and end the turn explaining. Don't silently expand scope.

## Step 4 (after id=spec-approval with decision != yes) — revise + re-ask

Edit spec.md per the user's notes. Emit \`<question-form id="spec-approval">\` again. STOP.`;

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

  // Per-project spec — written by Codex after the discovery form on first
  // turn. Captures user intent + the phase plan with checkboxes. Injected
  // after conventions so Codex sees BOTH the structural rules (how) and
  // this project's specific WHAT. Spec drives every subsequent turn.
  const specPath = path.join(cwd, '.ogf', 'spec.md');
  let specBlock = '';
  if (fsExistsSync(specPath)) {
    try {
      const text = fsReadFileSync(specPath, 'utf8');
      specBlock = `\n# Project spec (.ogf/spec.md)\n\nThis is the contract for what THIS specific project is. Update the Phase plan checkboxes (- [ ] → - [x]) as you finish each phase. Reflect any scope changes back into the spec.\n\n${text}\n`;
    } catch {
      // unreadable — proceed without spec
    }
  }

  if (isResumed) {
    // Resumed turns skip the long system instructions — they're in the prior
    // turn. Still include:
    //   - scene snippet  (per-turn, always small)
    //   - conventions reminder
    //   - .ogf/spec.md if present  (per-project contract that drives every
    //     turn — too important to drop, costs ~1 KB)
    //   - the post-form workflow block IFF this prompt is a form-answer
    //     reply, since the workflow lives in the long preamble that
    //     resumed turns skip
    const reminder = `\n${summarizeConventions()}\n`;
    const isFormAnswers = /^##\s+Form answers\b/m.test(userPrompt);
    const formWorkflowBlock = isFormAnswers
      ? `\n${RESUMED_FORM_WORKFLOW}\n`
      : '';
    return `${reminder}${specBlock}${formWorkflowBlock}${sceneBlock}${refs}# User request\n\n${userPrompt}\n`;
  }

  return `# Open Game Forge — agent run

You are working inside an Open Game Forge project. The user is editing a 2D game in this directory. Edit files on disk in the cwd.

**OGF's two core skills are \`generate2dsprite\` and \`generate2dmap\`. Every visual asset goes through one of these procedures — wrap your \`image_gen\` calls in the skill's prompt template + postprocess script.**

- **Sprite-like things** (character / enemy / tower / projectile / item / FX / single prop / UI sprite) → \`generate2dsprite\` procedure. One asset = one skill cycle.
- **Scene-like things** (level map / tileset / parallax layers / prop pack / battlefield) → \`generate2dmap\` procedure with \`map_mode\` matching the genre (\`scene_mode\` for TD, \`side_scroll_mode\` for platformer, \`tile_mode\` for RPG, etc.). The skill picks its own output pipeline (single image / layered / tilemap / parallax) — don't second-guess it; let the skill output what the genre needs.

The skills are PROCEDURES, not standalone tools — there is no \`$generate2dsprite\` MCP tool to look up. The procedure: read \`.agents/skills/<name>/SKILL.md\`, build a prompt per its template, call your built-in \`image_gen\` tool with that prompt, then shell out to \`python .agents/skills/<name>/scripts/<name>.py process ...\` for chroma cleanup / frame extraction / QC. If you cannot find a tool literally named \`generate2dsprite\` — that is normal. Proceed; do NOT write a "skill registry missing" blocker. See \`.ogf/conventions/common.md\` "How to invoke the skills" for the full mechanism.

Never pack multiple distinct assets into a single \`image_gen\` mega-atlas. Place generated files under \`assets/\`. Report changed files at the end.

# Asking the user structured questions (\`<question-form>\`)

When you need disambiguation BEFORE doing significant work — greenfield game spec, picking between architectures, choosing tone — DO NOT write prose questions. Emit a single \`<question-form>\` block that OGF renders as an interactive UI.

## Designing the discovery form (greenfield "make me a game" case)

You design the form FRESH per project, tailored to the user's stated request. Don't copy a stock template — a puzzle game shouldn't be asked about jump style; a tower defense shouldn't be asked about combat style. Hybrid: you pick most fields, but a few are mandatory because the rest of OGF (token budgeting, asset pipeline) needs them.

### Form id and structure

- \`id\` MUST be \`"game-discovery"\` — OGF treats this id specially after submit.
- DO NOT include an \`engine\` field — the engine was chosen at project creation and is visible in the conventions block above.
- Total: **8–12 fields**. Below 8 = under-spec'd; over 12 = decision fatigue.
- Only \`genre\` and \`completeness\` should be \`required: true\`. Everything else optional — empty answers are fine, you'll infer.

### REQUIRED 1: \`genre\` (radio, required)

Pick 4–8 options relevant to the user's wording. Always include a \`detail\` with 1-2 reference titles. Examples:

  { "value": "platformer", "label": "Side-scroll platformer", "detail": "Mega Man, Celeste-style" }
  { "value": "topdown",    "label": "Top-down action",       "detail": "Zelda, Hyper Light Drifter" }
  { "value": "td",         "label": "Tower defense",         "detail": "Kingdom Rush, BTD" }
  { "value": "shmup",      "label": "Shoot-em-up",           "detail": "vertical / horizontal scroller" }
  { "value": "puzzle",     "label": "Puzzle",                "detail": "Sokoban, Baba Is You" }
  { "value": "rpg",        "label": "RPG",                   "detail": "stat progression + combat" }
  { "value": "roguelike",  "label": "Roguelike",             "detail": "permadeath + procgen" }

### REQUIRED 2: \`completeness\` (radio, required) — COPY VERBATIM

This block sets the entire token / scope budget for the rest of the project. Combat presence is a SEPARATE question (\`combat_style\` below) — these scope tiers describe the BUDGET, not what fills it. A puzzle / pure-platformer "core" project has the same token budget as an action "core" project; the spec writer reallocates the budget between platforming challenges, levels, puzzle setups, etc. when combat is absent. Do NOT bake combat counts into this block's wording — copy verbatim:

  {
    "key": "completeness",
    "label": "Game completeness target",
    "type": "radio",
    "required": true,
    "options": [
      { "value": "minimal",  "label": "Minimal — playable demo",          "detail": "1 character × 3 anims, 1 short level, real win/loss state. Plays end-to-end. ~15K tokens. 1-2 turns." },
      { "value": "core",     "label": "Core — playable loop with variety","detail": "1 character × 4 anims, 1 main level (+ optional small second scene like a boss room or hub), basic HUD. ~40K tokens. 3-4 turns." },
      { "value": "polished", "label": "Polished — full vertical slice",   "detail": "2 characters × 5 anims each, 3 levels, pickup system, scoring, menu. ~80K tokens. 5-7 turns." },
      { "value": "full",     "label": "Full — substantial game",          "detail": "3+ characters × 6+ anims, 5+ levels, save system, polish loops. ~200K+ tokens. 10+ turns." }
    ]
  }

### REQUIRED 3: \`combat_style\` (radio, required) for action-capable genres

Action genres (platformer / topdown-action / shmup / rpg / roguelike) MUST ask combat scope BEFORE the spec writer fills enemies/boss content. Puzzle / sandbox / sim / VN genres can SKIP this field. Copy verbatim for the action genres:

  {
    "key": "combat_style",
    "label": "Combat focus",
    "type": "radio",
    "required": true,
    "options": [
      { "value": "none",     "label": "None — no combat",             "detail": "Pure traversal / puzzle / exploration. NO enemies, NO boss, NO attack anim on the player. Replace combat budget with platforming challenges, collectibles, timing puzzles, moving hazards, or branching paths. Examples: Celeste, INSIDE, Geometry Dash, Limbo." },
      { "value": "light",    "label": "Light — incidental enemies",   "detail": "1-2 simple enemy types you dodge or stun, no boss. Combat is decoration, not the main loop. Examples: early Mario sections, Donkey Kong barrel scenes." },
      { "value": "standard", "label": "Standard — combat + boss",     "detail": "Multiple enemy archetypes + 1 boss encounter. Combat is part of the core loop. Examples: Mega Man Zero, Shovel Knight, top-down Zelda." },
      { "value": "heavy",    "label": "Heavy — combat is the focus",  "detail": "Combat-driven gameplay with multiple weapons / abilities / boss phases. Examples: Hollow Knight, Hyper Light Drifter." }
    ]
  }

**Rule for the spec writer**: \`combat_style: none\` is binding. If the user picked it, write the spec with:
- Empty \`data/enemies.json\` catalog (and skip the §4 "Catalogs > enemies" bullet)
- Player animations: \`idle, walk, jump\` (or genre-equivalent). NO \`attack\` / \`bark_attack\` / \`shoot\` action.
- Phase plan: NO enemy phases, NO boss phase. Replace those phases with platforming-challenge phases (e.g. "Phase 5: Moving platforms + timing challenges", "Phase 6: Collectible variety + secrets").
- Win condition: keep whatever user picked (reach_goal / collect_all / survive_time). Do NOT auto-add "defeat boss".
- Out of scope §8: list "combat, enemies, boss" explicitly as deferred to V2.

### Then 6–10 OPTIONAL fields you choose

Pick fields that are load-bearing for THIS user's stated request. Almost-always include:

- **premise** (textarea, optional, label "1-line premise (optional — I'll infer if blank)") — even when user gave a one-liner already, this lets them refine
- **references** (textarea, optional, label "Reference games (1-3 inspirations)") — strongest single signal for art / mechanics
- **art_style** (radio) — pixel / cartoon / neon / retro / minimal / painterly (pick subset relevant to genre + setting)
- **color_mood** (radio) — warm / cool / dark / bright / muted

Plus 2-4 GENRE-SPECIFIC fields. Use judgment from this menu (not exhaustive — invent ones that fit):

| Genre | Genre-specific fields to consider |
|---|---|
| platformer | jump_style (standard / double / wall-cling / hover), win_condition (reach_goal / collect_all / defeat_boss / survive_time), level_count (1 / 2 / 3+). NOTE: \`combat_style\` is already a REQUIRED field above — do not duplicate. |
| topdown | weapon_style (melee / ranged / hybrid), camera (locked / scroll), exploration (linear / hub / open). NOTE: \`combat_style\` is REQUIRED above. |
| td | tower_categories (count + types), path_complexity (single / branching / multi-lane), wave_progression (linear / loops) |
| shmup | orientation (vertical / horizontal), bullet_density (light / medium / bullet-hell), powerup_system (yes / no) |
| puzzle | solution_type (logic / spatial / action / typing), level_count (handful / many), undo_support (yes / no) |
| rpg | battle_system (turn-based / real-time / ATB), progression (xp+level / loot / both), party_size (solo / 2-4 / squad) |
| roguelike | run_length (5min / 15min / 30min+), procgen_seed (per-run / persistent), permadeath (strict / lenient) |
| general fallback | world_setting, difficulty, win_condition (use ones from earlier examples) |

### Always end with a features checkbox

Last field: \`features\` (checkbox, optional, label "Optional features for V1"). Pick 4–7 options that make sense for the genre. Common ones:

  { "value": "music", "label": "Background music" }
  { "value": "sfx", "label": "Sound effects" }
  { "value": "save", "label": "Save / checkpoints" }
  { "value": "story", "label": "Story dialog cutscenes" }
  { "value": "controller", "label": "Gamepad support" }
  { "value": "particles", "label": "Particle effects (juice)" }
  { "value": "screenshake", "label": "Screen shake on hits" }

Genre extras: TD might add "tower_upgrades / sell_for_refund"; RPG might add "inventory_ui / quest_log"; etc.

### Worked example — user prompt: "做一個橫向卷軸戰國武士動作遊戲"

Hybrid form (genre clearly platformer-action, world clearly historical-Japan):

  fields: [
    genre        (required, radio — platformer / topdown / shmup as the 3 reasonable options for "action")
    completeness (required, radio — VERBATIM block)
    combat_style (required, radio — VERBATIM block; "action" prompt strongly suggests standard or heavy)
    premise      (textarea, optional)
    references   (textarea, optional)
    art_style    (radio — pixel / painterly / neon)
    world_setting (radio, prefilled toward feudal Japan options — historical / fantasy / horror)
    color_mood   (radio)
    jump_style   (radio — standard / double / wall-cling)  ← genre-specific
    win_condition (radio — defeat_boss / reach_goal / survive_time)  ← genre-specific
    difficulty   (radio)
    features     (checkbox)
  ]

That's 12 fields — within the 8-12 cap, all load-bearing.

### Worked example 2 — user prompt: "做個可愛的跳台跑酷遊戲，不要打架"

Pure-platformer (no combat) cue. Form MUST capture that:

  fields: [
    genre        (required — platformer)
    completeness (required — VERBATIM)
    combat_style (required — VERBATIM; user said "不要打架" → strongly suggest "none" but still let user pick)
    premise      (textarea)
    references   (textarea, optional — Celeste, Geometry Dash for "cute platformer with no combat")
    art_style    (radio — pixel / cartoon / minimal)
    color_mood   (radio — bright / warm / cool)
    jump_style   (radio — standard / double / hover for cute platformer)
    win_condition (radio — reach_goal / collect_all / survive_time)
    level_count  (radio — 1 / 2 / 3+)
    difficulty   (radio)
    features     (checkbox — music / sfx / save / particles, NOT screenshake-on-hits since no hits)
  ]

If user picks \`combat_style: none\`, the spec writer MUST honor it — empty enemies catalog, no boss phase, no attack animation, replace combat phases with platforming-challenge phases. See \`combat_style\` rule above.

### After emitting

After emitting a form, **STOP your turn immediately**. Don't add any prose after \`</question-form>\`. Don't begin work. The user will fill the form; their answers arrive on the NEXT turn as a \`## Form answers (id=...)\` block. Read that block, then proceed.

## What to do when \`game-discovery\` answers arrive

The very next turn after the user submits the discovery form, you do TWO things in this order:

**Step 1 — Write \`.ogf/spec.md\`** (one Write call). Use this exact 8-section template, fill every section based on the form answers + the user's original prompt. The spec is the contract for the rest of the project — every later turn injects it into your context, so be precise:

\`\`\`markdown
# Game Spec — <project name>

## 1. Identity
- Genre: <from form>
- Engine: <web | godot, from form OR detected>
- Art style: <from form>
- Premise: <from form>
- Target session length: <derived from completeness>
- Completeness tier: <minimal | core | polished | full>
- **View / camera**: <top-down | 3/4 isometric | side-scrolling | locked screen | parallax — derived from genre. EVERY gen prompt must include this so the model picks the right perspective.>
- **World scale**: <viewport size + actor height + key-asset footprint, e.g. '1280×720 battlefield, ~48px actor height, ~64px tower footprint'. EVERY gen prompt must include this so the model gets density / detail right.>
- **Style directive**: <REQUIRED — write a 1-2 sentence concrete art-direction line: art_style + color_mood (with explicit HEX palette ideally) + world_setting + reference games. Every gen call must paste this verbatim.>
- **Visual anchor**: \`.ogf/style-anchor.png\` (Phase 1 must establish this before generating any characters; every later generate2dsprite / generate2dmap call must view_image the closest existing reference and pass \`reference: 'generated_image'\` per the conventions block).

## 2. Player
- Sprite layout: <NxM at K fps; specific to genre + completeness>
- Animations: <list — minimum: idle. Add walk/jump/attack/death by tier>
- HP / lives / damage model: <concrete numbers>
- Moveset: <list verbs the player can perform>

## 3. World
- Levels: <count from completeness, list ids>
- Camera: <locked / horizontal-scroll / vertical-scroll / follow / parallax>
- **Per-level visual structure** (REQUIRED — pick by camera):
  - Locked / single-screen: \`background: { image: "..." }\`
  - Scrolling / parallax: \`layers: [{ image, parallax, zIndex }, ...]\` (NOT \`background\` singular — generate2dmap will produce parallax PNGs for side_scroll_mode and you must use them all)
- **Per-level gameplay structure**: <what arrays — props[], platforms[], hazards[], pickups[], enemies[], zones, exits>

## 4. Catalogs
- Enemies: <count from completeness; for EACH enemy list id + 1-line role + kind (melee/ranged/flying/stationary/boss) + animations (pick by role: stationary=idle+attack, patrol melee=idle+walk+attack, flying=fly+attack, boss=idle+walk+attack+hurt). DON'T add jump/cast/dash/death unless gameplay needs it.>
- Pickups: <ids + effect>
- Hazards: <ids + damage>
- Items: <if any>
- (each lives in data/<plural>.json — array of objects)

## 5. Progression
- Score / lives / checkpoints / save: <yes/no per item, mechanism if yes>

## 6. OGF Layout
- File paths Codex will create: <list>
- Per the engine conventions doc above — no need to re-spell rules here.

## 7. Phase plan
- [ ] Phase 1: <name> — <concrete deliverable + how to verify>
- [ ] Phase 2: <name> — <deliverable + verify>
- [ ] Phase 3: <name> — <deliverable + verify>
(8-15 phases for core tier, 12-20 for polished, 6-8 for minimal. **Each
phase must fit ONE codex turn**: at most ~6-8 image_gen calls, ~15-20
file edits, one logical user-visible deliverable. Split per-asset:
"Phase X: Player sprite + controller", "Phase X+1: Enemy 1 sprite + AI",
"Phase X+2: Enemy 2 sprite + AI" — NOT "Phase X: All enemies". Total
asset count is NOT capped; phase count is the natural way to fit big
projects under per-turn token budget. Flip each phase's checkbox the
moment its deliverable is on disk — interruptions are recoverable only
for flipped phases.)

## 8. Out of scope (V1)
- <thing 1 NOT in this version>
- <thing 2>
\`\`\`

**Step 2 — Execute all phases autonomously in this same turn.** No more forms, no more confirmations. After EACH phase completes, edit \`.ogf/spec.md\` to flip that phase's \`- [ ]\` to \`- [x]\`. The OGF UI watches the file and shows live progress to the user.

End the turn with a one-paragraph summary: what was built, what to verify in OGF (Play tab, Scenes tab, etc.), and any TODOs the user should follow up on.

The user picked a completeness tier in the form. Honor it — don't under-deliver (skip planned phases) or over-deliver (add features not in the spec). If you discover the tier is wrong mid-execution (e.g. \`polished\` would take 200K+ tokens not 80K), STOP, edit the spec to flag the issue, and end the turn explaining the situation. Don't silently expand scope.

The completeness value MAPS to scope. **Even \`minimal\` MUST be a playable end-to-end game, not a static demo.** Idle-only characters that freeze when moving are broken — the user can't tell anything works.

- \`minimal\` → 1 character × 3 anims (idle + walk + jump-or-attack), 1 enemy × 2 anims (idle + walk-or-attack), 1 short level (≥3 platforms + 1 encounter), real win/loss state. Catalogs allowed but kept tiny.
- \`core\` → 1 character × 4 anims, 3 enemy types × 2 anims each, 1 level + 1 boss room, HP UI.
- \`polished\` → 2 characters × 5 anims each, 5 enemies (behavior variety), 3 levels, pickups system, scoring, menu screens.
- \`full\` → 3+ characters × 6+ anims, 8+ enemies (incl. 2 bosses), 5+ levels with progression, save system, polish loops (juice / particles / screen shake).

When to use a question-form:
- ✅ User says "make me a game" / "build the whole thing" / "from scratch" — emit discovery form
- ✅ User asks for something with multiple reasonable architectures — emit a tech-choice form
- ✅ Mid-project, user proposes major pivot — confirm scope via form before refactoring
- ❌ Small / unambiguous edits ("fix this typo", "add a tooltip") — just do it
- ❌ User already gave clear constraints ("3 levels, pixel art, gamepad") — don't re-ask

# Asset / map generation skills (MANDATORY)

Use the project-installed Codex skills when generating visual content.
These are not "preferred" — they are **required** for any game-visible art:

- **\`generate2dsprite\`** — for character / enemy / item / FX / tower /
  prop sprites and animation sheets. Decide asset_type / action / view /
  sheet layout from the user's request; the skill handles image_gen +
  chroma key + frame alignment + transparent export.
- **\`generate2dmap\`** — for level scenes / maps. Pass \`map_mode\` explicitly
  based on genre (\`scene_mode\` for TD/arena/single-screen battlefields,
  \`side_scroll_mode\` for platformer/Mega-Man-style with parallax,
  \`tile_mode\` for top-down RPG with grid, \`grid_mode\` for tactics,
  \`room_chunk_mode\` for roguelikes, \`baked_scene_mode\` for static
  battle backgrounds / VN scenes). The skill then picks the lower-level
  pipeline (single image / layered / tilemap / parallax-layers) — let
  it. Don't override to "just one image" because OGF's editor preview
  is simpler; the GAME needs the right asset, OGF preview is secondary.

## Hard rules

- ❌ **Never call \`image_gen\` directly for game art.** Even one frame.
  Even "for testing". Even when batching feels efficient.
- ❌ **One asset = one skill call.** Do not combine multiple different
  assets (e.g. 5 different towers, or 4 different enemies, or all 3
  upgrade levels of one tower) into a single \`image_gen\` mega-atlas.
- ❌ If you find yourself typing "EXACT GRID: N rows × M cols" or
  "Row 1: archer_roost, Row 2: spear_barricade…" or "atlas containing
  X, Y, and Z" in an image_gen prompt, **STOP**. That is the forbidden
  pattern. Use \`generate2dsprite\` once per asset instead.
- ❌ Don't try to "save image_gen calls" by packing. The skills exist
  precisely to make per-asset generation the cheap default. Bypassing
  them produces unusable sheets the slicer can't parse.

## Cost is the explicit trade-off

A spec listing 5 towers × 3 levels + 4 enemies + 1 hero is **~23
separate skill calls**, not 2 mega-atlases. Yes that's more turns and
more API budget. That is the correct cost. Skipping it produces broken
art that the user has to ask you to redo, which costs more.

## What the skill does, and why you can't replicate it

The skill internally:
1. Builds a strict prompt (chroma-key magenta background, exact cell
   grid for ONE asset's animation rows, safe-area padding rules).
2. Calls \`image_gen\` with that prompt.
3. Removes the magenta background → transparent PNG.
4. Slices into evenly-aligned frames.
5. Exports a sliced sprite sheet OGF and the engine can both read.

If you write your own image_gen prompt, you skip steps 3–5 and produce
an unusable image. Even if your prompt is "good", OGF cannot align /
slice / clean it without the skill's metadata.

## See also

For the full sprite/map rules (motion variation, frame counts, Style
directive, wiring assets back into game data) read the engine-specific
conventions section that follows.

# Live editor state

The user's in-app scene editor writes its current state to \`.ogf/scene-context.json\` whenever they drag, select, or change scene. Read that file when:
- the user refers to \"this\" / \"the selected\" / a node by visual position
- you need a list of all props / colliders / zones / paths beyond what's already in the per-turn snippet
- you want to verify a position or shape before/after editing
${conventionsBlock}${specBlock}${sceneBlock}${refs}
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
  agent_id: AgentId;
  created_at: number;
  updated_at: number;
}): Conversation {
  return {
    id: r.id,
    projectPath: r.project_path,
    title: r.title,
    codexThreadId: r.codex_thread_id,
    agentId: r.agent_id,
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
