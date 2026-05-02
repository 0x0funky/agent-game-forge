import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentEvent, ReasoningEffort } from '@ogf/contracts';

export interface CodexRunOptions {
  bin: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  /** If set, resumes that Codex session instead of starting a new thread. */
  resumeThreadId?: string;
  env?: NodeJS.ProcessEnv;
}

export function buildCodexArgs(
  cwd: string,
  model?: string,
  reasoning?: ReasoningEffort,
  resumeThreadId?: string,
): string[] {
  // exec resume <session_id> reuses an existing rollout. Same flag set otherwise.
  const head = resumeThreadId
    ? ['exec', 'resume', resumeThreadId]
    : ['exec'];

  const tail = [
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-c',
    'sandbox_workspace_write.network_access=true',
  ];

  if (!resumeThreadId) {
    // -C is only valid on the base `exec` form; resume reuses the original cwd.
    tail.push('-C', cwd);
  }

  if (model && model !== 'default') {
    tail.push('--model', model);
  }
  if (reasoning) {
    tail.push('-c', `model_reasoning_effort="${reasoning}"`);
  }
  tail.push('-');
  return [...head, ...tail];
}

export function spawnCodex(opts: CodexRunOptions): ChildProcess {
  const { bin, cwd, prompt, model, reasoning, resumeThreadId, env } = opts;
  const args = buildCodexArgs(cwd, model, reasoning, resumeThreadId);
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });

  if (child.stdin) {
    child.stdin.end(prompt, 'utf8');
  }

  return child;
}

interface CodexJsonEvent {
  type?: string;
  msg?: {
    type?: string;
    text?: string;
    command?: string;
    [k: string]: unknown;
  };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    output?: string;
    exit_code?: number;
    status?: string;
    changes?: { path?: string; kind?: string }[];
    [k: string]: unknown;
  };
  thread_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  [k: string]: unknown;
}

export function extractThreadId(raw: CodexJsonEvent): string | null {
  if (raw.type === 'thread.started' && typeof raw.thread_id === 'string') {
    return raw.thread_id;
  }
  return null;
}

export function mapCodexEvent(raw: CodexJsonEvent): AgentEvent | null {
  const t = raw.type;

  if (t === 'thread.started') {
    return { type: 'status', label: 'initializing' };
  }
  if (t === 'turn.started') {
    return { type: 'status', label: 'running' };
  }

  if (t === 'item.started' && raw.item) {
    const itemType = raw.item.type;
    if (itemType === 'command_execution') {
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name: 'Bash',
        input: { command: raw.item.command ?? '' },
      };
    }
    if (itemType === 'file_change') {
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name: 'Edit',
        input: { changes: raw.item.changes ?? [] },
      };
    }
  }

  if (t === 'item.completed' && raw.item) {
    const itemType = raw.item.type;
    if (itemType === 'command_execution') {
      const exit = raw.item.exit_code;
      const output = String(raw.item.aggregated_output ?? raw.item.output ?? '');
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: output,
        isError: typeof exit === 'number' && exit !== 0,
      };
    }
    if (itemType === 'file_change') {
      const changes = raw.item.changes ?? [];
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: JSON.stringify(changes),
        isError: false,
      };
    }
    if (itemType === 'agent_message') {
      return { type: 'text_delta', delta: String(raw.item.text ?? '') };
    }
    if (itemType === 'reasoning') {
      const text = String(raw.item.text ?? '').trim();
      return text
        ? { type: 'tool_use', id: String(raw.item.id ?? ''), name: 'Thinking', input: { text } }
        : null;
    }
  }

  if (t === 'turn.completed' && raw.usage) {
    return {
      type: 'usage',
      usage: {
        input: raw.usage.input_tokens,
        output: raw.usage.output_tokens,
        cachedRead: raw.usage.cached_input_tokens,
      },
    };
  }

  if (t === 'turn.failed' || t === 'error') {
    const msg =
      (raw as { error?: { message?: string }; message?: string }).error?.message ??
      (raw as { message?: string }).message ??
      'turn failed';
    return {
      type: 'tool_result',
      toolUseId: 'turn',
      content: typeof msg === 'string' ? msg : JSON.stringify(msg),
      isError: true,
    };
  }

  return { type: 'raw', raw };
}

export interface JsonlParserCallbacks {
  onEvent: (e: AgentEvent) => void;
  onThreadId?: (id: string) => void;
}

export function createJsonlParser(cb: JsonlParserCallbacks) {
  let buf = '';

  function consume(line: string) {
    if (!line) return;
    try {
      const obj = JSON.parse(line) as CodexJsonEvent;
      const tid = extractThreadId(obj);
      if (tid) cb.onThreadId?.(tid);
      const ev = mapCodexEvent(obj);
      if (ev) cb.onEvent(ev);
    } catch {
      cb.onEvent({ type: 'raw', raw: line });
    }
  }

  return {
    feed(chunk: Buffer | string) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        consume(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    },
    flush() {
      const tail = buf.trim();
      buf = '';
      consume(tail);
    },
  };
}
