/**
 * Claude Code adapter — spawns the `claude` CLI in non-interactive
 * stream-json mode and maps its events to OGF's common AgentEvent shape.
 *
 * Pattern mirrors codex.ts so the rest of the daemon (RunManager, SSE,
 * Turn rendering) treats both CLIs identically.
 *
 * Claude Code wire format (verified via official docs):
 *   - Invocation: `claude -p "PROMPT" --output-format stream-json --verbose
 *                 --include-partial-messages`
 *   - Resume: `--resume <session-id>` OR `--session-id <uuid>`
 *   - Stdout: JSONL. Each line is an event object.
 *   - Stderr: human-friendly errors / warnings — surfaced as raw events.
 *   - Exit 0 on success, non-zero on fatal errors.
 *
 * Event types we expect:
 *   - `system` (subtype: `init` | `api_retry` | …) — session bookkeeping
 *   - `assistant` — assistant message; content blocks may be text / tool_use
 *   - `user` — tool_result echoed back (when Claude runs tools)
 *   - `result` — final summary for the turn (cost, usage, session_id)
 *   - `stream_event` — wrapper around raw Anthropic SSE events
 *     (only present when `--include-partial-messages` is set)
 *
 * For text streaming, --include-partial-messages emits `stream_event`
 * objects whose `.event.delta.text` carries text deltas. Without that
 * flag, only whole assistant messages arrive.
 *
 * Refs:
 *   https://code.claude.com/docs/en/cli-reference.md
 *   https://code.claude.com/docs/en/headless.md
 *   https://code.claude.com/docs/en/agent-sdk/streaming-output.md
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '@ogf/contracts';

const DEBUG_STREAM_LOG = path.join(homedir(), '.ogf', 'claude-code-debug.jsonl');
const DEBUG_STREAM_MAX = 5 * 1024 * 1024;
let debugLogChecked = false;

function debugLogLine(line: string) {
  try {
    if (!debugLogChecked) {
      debugLogChecked = true;
      mkdirSync(path.dirname(DEBUG_STREAM_LOG), { recursive: true });
      try {
        const st = statSync(DEBUG_STREAM_LOG);
        if (st.size > DEBUG_STREAM_MAX) truncateSync(DEBUG_STREAM_LOG, 0);
      } catch {
        /* fresh file */
      }
    }
    appendFileSync(DEBUG_STREAM_LOG, line + '\n', 'utf8');
  } catch {
    /* never let logging crash the parser */
  }
}

// -------------------- Spawn --------------------

export interface ClaudeCodeRunOptions {
  /** Path to the `claude` binary. */
  bin: string;
  /** Working directory for the run. */
  cwd: string;
  /** Prompt to feed Claude. */
  prompt: string;
  /** Optional model id (e.g. "claude-sonnet-4-5", "claude-opus-4"). */
  model?: string;
  /** When set, resumes that Claude Code session instead of starting a new
   *  thread. Reuses the original conversation context. */
  resumeThreadId?: string;
  env?: NodeJS.ProcessEnv;
}

export function buildClaudeCodeArgs(
  model?: string,
  resumeThreadId?: string,
): string[] {
  // -p / --print: non-interactive mode
  // --output-format stream-json: emit JSONL events on stdout
  // --verbose: include full turn-by-turn output (required for stream-json)
  // --include-partial-messages: emit raw streaming deltas (text_delta etc.)
  // --permission-mode bypassPermissions: don't block on tool prompts —
  //   OGF runs in trusted local mode like Codex's --full-auto. Users
  //   can change this later via a settings knob.
  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'bypassPermissions',
  ];
  if (model) {
    args.push('--model', model);
  }
  if (resumeThreadId) {
    args.push('--resume', resumeThreadId);
  }
  return args;
}

export function spawnClaudeCode(opts: ClaudeCodeRunOptions): ChildProcess {
  const { bin, cwd, prompt, model, resumeThreadId, env } = opts;
  const rawArgs = buildClaudeCodeArgs(model, resumeThreadId);
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  const args = useShell ? rawArgs.map(quoteForCmdShell) : rawArgs;

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

function quoteForCmdShell(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"]/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '""') + '"';
}

// -------------------- Event mapping --------------------

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface ClaudeMessage {
  role?: string;
  content?: ClaudeContentBlock[] | string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: ClaudeMessage;
  /** stream_event wraps raw Anthropic SSE events */
  event?: {
    type?: string;
    index?: number;
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
      stop_reason?: string;
    };
    content_block?: ClaudeContentBlock;
    message?: ClaudeMessage;
    usage?: ClaudeMessage['usage'];
  };
  /** Top-level fields on `result` lines */
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: ClaudeMessage['usage'];
  is_error?: boolean;
  result?: string;
  error?: string;
  /** Per-event uuid */
  uuid?: string;
  parent_tool_use_id?: string | null;
  [k: string]: unknown;
}

/** Extract a Claude Code session id from a stream line. The id is included
 *  on most events; the first occurrence is what we'll use for `--resume`. */
export function extractClaudeSessionId(raw: ClaudeStreamLine): string | null {
  if (typeof raw.session_id === 'string' && raw.session_id.length > 0) {
    return raw.session_id;
  }
  return null;
}

/** Per-parser state needed to accumulate text/tool deltas across lines. */
interface DeltaState {
  /** index → accumulated tool_use input JSON string */
  toolInputByIndex: Map<number, string>;
  /** index → tool_use metadata captured at content_block_start */
  toolMetaByIndex: Map<number, { id: string; name: string }>;
}

function createDeltaState(): DeltaState {
  return {
    toolInputByIndex: new Map(),
    toolMetaByIndex: new Map(),
  };
}

/** Map a single Claude Code stream line to ZERO OR MORE OGF AgentEvents.
 *  We use an array because a single `assistant` message can contain
 *  multiple content blocks (text + tool_use) that translate to multiple
 *  AgentEvents. */
export function mapClaudeCodeLine(
  raw: ClaudeStreamLine,
  state: DeltaState,
): AgentEvent[] {
  const out: AgentEvent[] = [];
  const t = raw.type;

  // ── system lifecycle ───────────────────────────────────────────────
  if (t === 'system') {
    if (raw.subtype === 'init') out.push({ type: 'status', label: 'initializing' });
    else if (raw.subtype === 'api_retry')
      out.push({ type: 'status', label: 'retrying' });
    return out;
  }

  // ── result / end-of-turn ───────────────────────────────────────────
  if (t === 'result') {
    if (raw.usage) {
      out.push({
        type: 'usage',
        usage: {
          input: raw.usage.input_tokens,
          output: raw.usage.output_tokens,
          cachedRead: raw.usage.cache_read_input_tokens,
        },
      });
    }
    out.push({
      type: 'status',
      label: raw.is_error ? 'error' : 'done',
    });
    return out;
  }

  // ── stream_event: raw Anthropic SSE wrapped by Claude Code ─────────
  // Only present when --include-partial-messages is set. Text streams
  // here as content_block_delta with text_delta; tool inputs stream as
  // input_json_delta.
  if (t === 'stream_event' && raw.event) {
    const ev = raw.event;
    const idx = typeof ev.index === 'number' ? ev.index : 0;

    if (ev.type === 'content_block_start') {
      const block = ev.content_block;
      if (block?.type === 'tool_use') {
        state.toolMetaByIndex.set(idx, {
          id: String(block.id ?? `tool_${idx}`),
          name: String(block.name ?? 'unknown'),
        });
        state.toolInputByIndex.set(idx, '');
      }
      return out;
    }

    if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') {
        out.push({ type: 'text_delta', delta: ev.delta.text });
      } else if (
        ev.delta.type === 'input_json_delta' &&
        typeof ev.delta.partial_json === 'string'
      ) {
        const cur = state.toolInputByIndex.get(idx) ?? '';
        state.toolInputByIndex.set(idx, cur + ev.delta.partial_json);
      }
      return out;
    }

    if (ev.type === 'content_block_stop') {
      const meta = state.toolMetaByIndex.get(idx);
      if (meta) {
        // We have a complete tool_use: parse the accumulated JSON input
        // and emit a tool_use event. Use try/catch because Claude
        // occasionally emits malformed partial_json on early termination.
        const rawInput = state.toolInputByIndex.get(idx) ?? '';
        let parsed: unknown = rawInput;
        if (rawInput.trim().length > 0) {
          try {
            parsed = JSON.parse(rawInput);
          } catch {
            parsed = { _rawInput: rawInput };
          }
        }
        out.push({
          type: 'tool_use',
          id: meta.id,
          name: meta.name,
          input: parsed,
        });
        state.toolMetaByIndex.delete(idx);
        state.toolInputByIndex.delete(idx);
      }
      return out;
    }

    if (ev.type === 'message_stop') {
      // End-of-turn signal — the `result` line carries usage/status, so we
      // don't synthesize a status here.
      return out;
    }

    // Other stream_event types (message_start, message_delta, ping) carry
    // metadata we don't surface to the UI yet.
    return out;
  }

  // ── user (tool_result echo) ────────────────────────────────────────
  // After Claude calls a tool, the CLI executes it and feeds the result
  // back as a `user` message containing tool_result content blocks. Map
  // those to OGF tool_result events so the Turn UI shows what came back.
  if (t === 'user' && raw.message && Array.isArray(raw.message.content)) {
    for (const block of raw.message.content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const content =
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
        out.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: content ?? '',
          isError: block.is_error === true,
        });
      }
    }
    return out;
  }

  // ── assistant (whole-message fallback) ─────────────────────────────
  // When --include-partial-messages IS set, the assistant whole-message
  // event arrives after the stream_event deltas — we've already emitted
  // text_delta + tool_use events for each block, so we can skip. When
  // partial-messages is OFF (future fallback path), this is our only
  // signal for assistant text + tool use; emit accordingly.
  if (t === 'assistant' && raw.message && Array.isArray(raw.message.content)) {
    // Heuristic: if delta state was used (toolMetaByIndex was ever set),
    // we already emitted. Otherwise emit blocks now as whole messages.
    // We can't tell from this line alone — fall back to skipping when
    // partial-messages mode is on (the common case for OGF). If a future
    // build flips that flag off, we'd need a separate code path here.
    return out;
  }

  return out;
}

// -------------------- Parser --------------------

export interface ClaudeJsonlParserCallbacks {
  onEvent: (e: AgentEvent) => void;
  onThreadId?: (id: string) => void;
  onActivity?: () => void;
}

export function createClaudeJsonlParser(cb: ClaudeJsonlParserCallbacks) {
  let buf = '';
  const state = createDeltaState();
  let seenThread = false;

  function consume(line: string) {
    if (!line) return;
    debugLogLine(line);
    cb.onActivity?.();
    let obj: ClaudeStreamLine;
    try {
      obj = JSON.parse(line) as ClaudeStreamLine;
    } catch {
      cb.onEvent({ type: 'raw', raw: line });
      return;
    }
    if (!seenThread) {
      const tid = extractClaudeSessionId(obj);
      if (tid) {
        seenThread = true;
        cb.onThreadId?.(tid);
      }
    }
    const events = mapClaudeCodeLine(obj, state);
    for (const e of events) cb.onEvent(e);
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
      if (tail) consume(tail);
    },
  };
}
