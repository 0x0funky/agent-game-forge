import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentEvent, AgentId, AgentInfo, AgentModel, ReasoningEffort } from '@ogf/contracts';
import { spawnCodex, createJsonlParser } from './codex.js';
import { spawnClaudeCode, createClaudeJsonlParser } from './claude-code.js';

export interface AgentDef {
  id: AgentId;
  name: string;
  bin: string;
  versionArgs: string[];
  fallbackModels: AgentModel[];
}

export const AGENT_DEFS: AgentDef[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    // Mirrors what the Codex CLI's interactive picker shows. Update when
    // OpenAI publishes a newer set; OGF passes whatever id you pick straight
    // to `codex --model <id>` so any string Codex CLI accepts works here.
    fallbackModels: [
      { id: 'default', label: 'Default · CLI default' },
      { id: 'gpt-5.5', label: 'gpt-5.5 · frontier coding' },
      { id: 'gpt-5.4', label: 'gpt-5.4 · everyday' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini · cheap & fast' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex · coding-tuned' },
      { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark · ultra fast' },
      { id: 'gpt-5.2', label: 'gpt-5.2 · long-running agents' },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    // Anthropic's latest Claude model IDs as of 2026-05. "default" lets the
    // CLI pick — useful when Anthropic ships a new flagship and we haven't
    // updated this list yet. OGF passes the chosen id straight to
    // `claude --model <id>`.
    fallbackModels: [
      { id: 'default', label: 'Default · CLI default' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7 · frontier' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 · everyday' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5 · cheap & fast' },
    ],
  },
];

// ── Dispatch ──
// Maps each agent id to its spawn + parser pair so the rest of the daemon
// (RunManager, /api/runs) is agent-agnostic. Both return objects with the
// same shape so callers don't need conditionals.

export interface AgentSpawnOptions {
  bin: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  resumeThreadId?: string;
  env?: NodeJS.ProcessEnv;
}

export interface AgentParserCallbacks {
  onEvent: (e: AgentEvent) => void;
  onThreadId?: (id: string) => void;
  onActivity?: () => void;
}

export interface AgentParser {
  feed: (chunk: Buffer | string) => void;
  flush: () => void;
}

export interface AgentAdapter {
  spawn: (opts: AgentSpawnOptions) => ChildProcess;
  makeParser: (cb: AgentParserCallbacks) => AgentParser;
}

const ADAPTERS: Record<AgentId, AgentAdapter> = {
  codex: {
    spawn: (opts) => spawnCodex(opts),
    makeParser: (cb) => createJsonlParser(cb),
  },
  'claude-code': {
    // Claude Code doesn't take a `reasoning` knob the way Codex does —
    // ignored at spawn. Resume uses `--resume <session-id>`.
    spawn: (opts) =>
      spawnClaudeCode({
        bin: opts.bin,
        cwd: opts.cwd,
        prompt: opts.prompt,
        model: opts.model,
        resumeThreadId: opts.resumeThreadId,
        env: opts.env,
      }),
    makeParser: (cb) => createClaudeJsonlParser(cb),
  },
};

export function getAgentAdapter(id: AgentId): AgentAdapter {
  return ADAPTERS[id];
}

export function resolveOnPath(bin: string): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function probeVersion(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
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
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0 && !out) {
        resolve(null);
        return;
      }
      const line = (out || err).split(/\r?\n/)[0]?.trim() || null;
      resolve(line);
    });
  });
}

export async function detectAgents(): Promise<AgentInfo[]> {
  const out: AgentInfo[] = [];
  for (const def of AGENT_DEFS) {
    const resolvedPath = resolveOnPath(def.bin);
    if (!resolvedPath) {
      out.push({
        id: def.id,
        name: def.name,
        bin: def.bin,
        available: false,
        models: def.fallbackModels,
      });
      continue;
    }
    const version = await probeVersion(resolvedPath, def.versionArgs);
    out.push({
      id: def.id,
      name: def.name,
      bin: def.bin,
      available: version !== null,
      path: resolvedPath,
      version: version ?? undefined,
      models: def.fallbackModels,
    });
  }
  return out;
}

export function getAgentDef(id: string): AgentDef | undefined {
  return AGENT_DEFS.find((d) => d.id === id);
}

export function isAgentId(id: string): id is AgentId {
  return id === 'codex' || id === 'claude-code';
}
