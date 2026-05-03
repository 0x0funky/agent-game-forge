// Godot binary detection + child-process runner with SSE streaming.
// Each running Godot instance is identified by a runId. The daemon keeps the
// last finished run around briefly so the UI can attach late and replay output.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import { resolveOnPath } from './agents.js';

export interface GodotInfo {
  available: boolean;
  /** Resolved absolute path to the binary, if found. */
  path?: string;
  /** First line of `--version` output. */
  version?: string;
  /** How we discovered it: env var, PATH, or manual override. */
  source?: 'env' | 'path';
}

const GODOT_BIN_CANDIDATES = ['godot', 'godot4', 'Godot', 'Godot_v4'];

function probeVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(t);
      const line = (out || err).split(/\r?\n/)[0]?.trim() || null;
      resolve(line);
    });
  });
}

/** Detect a usable Godot binary. Order: OGF_GODOT env var → PATH → Windows install scan. */
export async function detectGodot(): Promise<GodotInfo> {
  // 1) Explicit override
  const fromEnv = process.env.OGF_GODOT;
  if (fromEnv && existsSync(fromEnv)) {
    const version = await probeVersion(fromEnv);
    if (version) return { available: true, path: fromEnv, version, source: 'env' };
  }

  // 2) PATH lookup
  for (const cand of GODOT_BIN_CANDIDATES) {
    const found = resolveOnPath(cand);
    if (!found) continue;
    const version = await probeVersion(found);
    if (version) return { available: true, path: found, version, source: 'path' };
  }

  // 3) Common install locations (Windows in particular — Godot is often
  //    extracted to a folder named like the exe, with the exe inside).
  for (const cand of scanCommonInstallPaths()) {
    const version = await probeVersion(cand);
    if (version) return { available: true, path: cand, version, source: 'path' };
  }

  return { available: false };
}

/** Best-effort scan of well-known directories for `Godot*.exe`. Bounded + non-recursive. */
function scanCommonInstallPaths(): string[] {
  if (process.platform !== 'win32') return [];

  const roots: string[] = [];
  for (const drive of ['C:\\', 'D:\\', 'E:\\']) {
    if (existsSync(drive)) roots.push(drive);
  }
  const programFiles = process.env['ProgramFiles'];
  if (programFiles && existsSync(programFiles)) roots.push(programFiles);
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData && existsSync(localAppData)) roots.push(localAppData);
  const home = homedir();
  if (home && existsSync(home)) {
    for (const sub of ['Desktop', 'Downloads', 'Documents']) {
      const p = path.join(home, sub);
      if (existsSync(p)) roots.push(p);
    }
  }

  const out: string[] = [];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^Godot.*/i.test(name)) continue;
      const full = path.join(root, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && /\.exe$/i.test(name)) {
        out.push(full);
        continue;
      }
      if (st.isDirectory()) {
        // Look one level deep for the actual exe.
        let inner: string[] = [];
        try {
          inner = readdirSync(full);
        } catch {
          continue;
        }
        // Prefer non-console variant for play (interactive UI).
        const exes = inner.filter((n) => /^Godot.*\.exe$/i.test(n));
        const nonConsole = exes.find((n) => !/console/i.test(n));
        const winner = nonConsole ?? exes[0];
        if (winner) out.push(path.join(full, winner));
      }
    }
  }
  return out;
}

// ---------- Run lifecycle ----------

export type GodotRunStatus = 'running' | 'succeeded' | 'failed' | 'canceled';

export interface GodotEvent {
  /** Sequence id for SSE Last-Event-ID resume. */
  id: number;
  type: 'start' | 'stdout' | 'stderr' | 'end' | 'error';
  data: unknown;
}

interface GodotRun {
  id: string;
  status: GodotRunStatus;
  events: GodotEvent[];
  clients: Set<Response>;
  child?: ChildProcess;
  bin: string;
  projectPath: string;
  mainScene?: string;
  startedAt: number;
  endedAt?: number;
}

const MAX_EVENTS = 5000; // godot can be chatty
const KEEP_FINISHED_MS = 5 * 60 * 1000;

export class GodotRunManager {
  private runs = new Map<string, GodotRun>();
  /** One active run per project to keep things sane. */
  private activeByProject = new Map<string, string>();

  start(opts: {
    bin: string;
    projectPath: string;
    mainScene?: string;
  }): GodotRun {
    // If a run is active for this project, kill it first.
    const existingId = this.activeByProject.get(opts.projectPath);
    if (existingId) {
      const existing = this.runs.get(existingId);
      if (existing && existing.status === 'running') {
        this.cancel(existingId);
      }
    }

    const args = ['--path', opts.projectPath];
    if (opts.mainScene) args.push(opts.mainScene);

    const run: GodotRun = {
      id: randomUUID(),
      status: 'running',
      events: [],
      clients: new Set(),
      bin: opts.bin,
      projectPath: opts.projectPath,
      mainScene: opts.mainScene,
      startedAt: Date.now(),
    };
    this.runs.set(run.id, run);
    this.activeByProject.set(opts.projectPath, run.id);

    // Pre-flight: trigger headless asset import. Codex generates PNG / WAV
    // files into the project but can't trigger Godot's editor-side import
    // step, so the project's first run after a Codex turn fails with
    // 'No loader found for resource'. Running --headless --import generates
    // the .import sidecars for any new asset before we hand off to Play.
    // - Idempotent: no-op when nothing's new (~1s).
    // - Sync via stdin/stdout pipe to keep the user feedback clear ('importing'
    //   then 'starting').
    this.emit(run, 'stdout', { chunk: '[OGF] Importing assets (--headless --import)...\n' });
    let child: ChildProcess;
    try {
      const importChild = spawn(
        opts.bin,
        ['--path', opts.projectPath, '--headless', '--import'],
        { cwd: opts.projectPath, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      // Stream import output too so the user can see what's happening.
      importChild.stdout?.on('data', (chunk: Buffer) =>
        this.emit(run, 'stdout', { chunk: chunk.toString('utf8') }),
      );
      importChild.stderr?.on('data', (chunk: Buffer) =>
        this.emit(run, 'stderr', { chunk: chunk.toString('utf8') }),
      );
      // Wait for it to finish before launching the actual game. Use sync
      // wait via a Promise-friendly close handler — the play spawn happens
      // inside the close callback below.
      importChild.on('close', (importCode) => {
        if (importCode !== 0) {
          this.emit(run, 'stderr', {
            chunk: `[OGF] Asset import exited with code ${importCode}; trying to launch anyway.\n`,
          });
        }
        this.launchGame(run, opts, args);
      });
      // Track the import process as the run's child so cancel kills it too.
      run.child = importChild;
      this.emit(run, 'start', {
        runId: run.id,
        bin: opts.bin,
        args,
        projectPath: opts.projectPath,
        mainScene: opts.mainScene,
      });
      return run;
    } catch (err) {
      this.emit(run, 'error', { message: err instanceof Error ? err.message : String(err) });
      this.finish(run, 'failed');
      return run;
    }
  }

  /** Launch the actual game after the headless import has completed. */
  private launchGame(
    run: GodotRun,
    opts: { bin: string; projectPath: string; mainScene?: string },
    args: string[],
  ): void {
    let child: ChildProcess;
    try {
      child = spawn(opts.bin, args, {
        cwd: opts.projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false, // user wants to see/click into the Godot window
      });
    } catch (err) {
      this.emit(run, 'error', { message: err instanceof Error ? err.message : String(err) });
      this.finish(run, 'failed');
      return;
    }

    run.child = child;
    this.emit(run, 'stdout', { chunk: '[OGF] Launching Godot...\n' });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.emit(run, 'stdout', { chunk: chunk.toString('utf8') });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.emit(run, 'stderr', { chunk: chunk.toString('utf8') });
    });
    child.on('error', (err) => {
      this.emit(run, 'error', { message: err.message });
    });
    child.on('close', (code, signal) => {
      const status: GodotRunStatus =
        signal === 'SIGTERM' || signal === 'SIGKILL'
          ? 'canceled'
          : code === 0
          ? 'succeeded'
          : 'failed';
      run.endedAt = Date.now();
      this.emit(run, 'end', { code, signal, status });
      this.finish(run, status);
    });
  }

  get(runId: string): GodotRun | undefined {
    return this.runs.get(runId);
  }

  attach(runId: string, res: Response, after?: number) {
    const run = this.runs.get(runId);
    if (!run) {
      res.status(404).end('run not found');
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const rec of run.events) {
      if (after !== undefined && rec.id <= after) continue;
      writeSse(res, rec);
    }

    if (run.status !== 'running') {
      res.end();
      return;
    }

    run.clients.add(res);
    res.on('close', () => {
      run.clients.delete(res);
    });
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    run.child?.kill();
    return true;
  }

  /** Returns the active run for a project (if any). Useful for the UI to reconnect on reload. */
  activeRunForProject(projectPath: string): string | null {
    const id = this.activeByProject.get(projectPath);
    if (!id) return null;
    const run = this.runs.get(id);
    if (!run || run.status !== 'running') return null;
    return id;
  }

  private emit(run: GodotRun, type: GodotEvent['type'], data: unknown) {
    const rec: GodotEvent = { id: run.events.length, type, data };
    run.events.push(rec);
    if (run.events.length > MAX_EVENTS) run.events.shift();
    for (const client of run.clients) writeSse(client, rec);
  }

  private finish(run: GodotRun, status: GodotRunStatus) {
    run.status = status;
    run.endedAt = run.endedAt ?? Date.now();
    for (const client of run.clients) client.end();
    run.clients.clear();
    if (this.activeByProject.get(run.projectPath) === run.id) {
      this.activeByProject.delete(run.projectPath);
    }
    // GC after a while so SSE can still attach for a brief replay window.
    setTimeout(() => {
      this.runs.delete(run.id);
    }, KEEP_FINISHED_MS);
  }
}

function writeSse(res: Response, rec: GodotEvent) {
  res.write(`id: ${rec.id}\n`);
  res.write(`event: ${rec.type}\n`);
  res.write(`data: ${JSON.stringify(rec.data)}\n\n`);
}

/** Resolve `res://...` paths to project-relative POSIX. */
export function resolveResPath(p: string): string {
  return p.startsWith('res://') ? p.slice(6) : p.replace(/\\/g, '/');
}

// ---------- Console line parsing ----------

export interface ConsoleLine {
  /** When stderr we mark severity as 'error'; some Godot warnings still come on stdout. */
  level: 'info' | 'warning' | 'error';
  text: string;
  /** Pulled from "res://path/to/file.gd:42" patterns when present. */
  jump?: { relPath: string; line: number };
}

const RES_LINE_RE = /res:\/\/([^"\s)]+\.gd):(\d+)/i;

export function parseConsoleLine(text: string, channel: 'stdout' | 'stderr'): ConsoleLine {
  let level: ConsoleLine['level'] =
    channel === 'stderr' ? 'error' : 'info';
  // Heuristic: SCRIPT ERROR / ERROR: / WARNING: prefixes.
  if (/^\s*(SCRIPT\s+)?ERROR[:\s]/i.test(text)) level = 'error';
  else if (/^\s*WARNING[:\s]/i.test(text)) level = 'warning';

  const m = RES_LINE_RE.exec(text);
  const jump = m ? { relPath: resolveResPath(m[1]), line: Number(m[2]) } : undefined;
  return { level, text, jump };
}
