import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentInfo, AgentModel } from '@ogf/contracts';

export interface AgentDef {
  id: 'codex';
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
    fallbackModels: [
      { id: 'default', label: 'Default' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
  },
];

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
