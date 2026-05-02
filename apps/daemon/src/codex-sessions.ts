import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CodexSessionSummary {
  id: string;
  filePath: string;
  cwd: string;
  startedAt: string;     // ISO from session_meta
  cliVersion?: string;
  /** Quick preview: the first user_message text (truncated). */
  firstPrompt?: string;
  /** Approximate count of user_message events. */
  userMsgCount?: number;
  /** Approximate count of agent_message events. */
  agentMsgCount?: number;
  /** File size on disk. */
  fileSize: number;
}

export interface CodexReplayMessage {
  role: 'user' | 'agent';
  content: string;
  ts?: string;
}

const SESSIONS_ROOT = path.join(homedir(), '.codex', 'sessions');

function normalizePath(p: string | undefined | null): string {
  if (!p) return '';
  return path.resolve(p).toLowerCase().replace(/\\/g, '/');
}

interface SessionMetaPayload {
  id?: string;
  cwd?: string;
  timestamp?: string;
  cli_version?: string;
}

interface RolloutLine {
  type?: string;
  payload?: SessionMetaPayload | Record<string, unknown>;
}

/**
 * Read just the first line (session_meta) of a rollout file to extract metadata cheaply.
 */
function readSessionMeta(filePath: string): { meta: SessionMetaPayload; firstLine: string } | null {
  try {
    // Read up to ~64KB to be safe (session_meta first line is usually ~10-50KB due to base_instructions).
    const buf = readFileSync(filePath, { encoding: 'utf8' });
    const nl = buf.indexOf('\n');
    const firstLine = nl < 0 ? buf : buf.slice(0, nl);
    const obj = JSON.parse(firstLine) as RolloutLine;
    if (obj.type !== 'session_meta') return null;
    const meta = (obj.payload ?? {}) as SessionMetaPayload;
    return { meta, firstLine };
  } catch {
    return null;
  }
}

function walkSessionFiles(rootAbs: string, onFile: (abs: string, name: string) => void) {
  let entries: string[] = [];
  try {
    entries = readdirSync(rootAbs);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = path.join(rootAbs, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSessionFiles(abs, onFile);
    } else if (st.isFile() && name.endsWith('.jsonl')) {
      onFile(abs, name);
    }
  }
}

/**
 * Discover Codex sessions whose cwd matches the given project path.
 * Quick: only reads each rollout's first line (session_meta).
 * For cheaper preview we also extract first user_message (slow path).
 */
export function findSessionsForCwd(targetCwd: string): CodexSessionSummary[] {
  const want = normalizePath(targetCwd);
  if (!want) return [];

  const matched: { filePath: string; meta: SessionMetaPayload; size: number; mtimeMs: number }[] = [];
  walkSessionFiles(SESSIONS_ROOT, (abs) => {
    let st;
    try { st = statSync(abs); } catch { return; }
    const m = readSessionMeta(abs);
    if (!m) return;
    if (normalizePath(m.meta.cwd) === want) {
      matched.push({ filePath: abs, meta: m.meta, size: st.size, mtimeMs: st.mtimeMs });
    }
  });

  // Sort newest first
  matched.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // For each, pull first user_message + counts (cheap streaming line scan)
  const out: CodexSessionSummary[] = [];
  for (const r of matched) {
    let firstPrompt: string | undefined;
    let userCount = 0;
    let agentCount = 0;
    try {
      const content = readFileSync(r.filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        if (!firstPrompt && line.includes('"user_message"')) {
          try {
            const obj = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
            const p = obj.payload;
            if (
              obj.type === 'event_msg' &&
              p &&
              (p as { type?: string }).type === 'user_message'
            ) {
              const m = String((p as { message?: string }).message ?? '').trim();
              if (m) firstPrompt = m.length > 200 ? m.slice(0, 200) + '…' : m;
              userCount++;
              continue;
            }
          } catch { /* ignore */ }
        }
        if (line.includes('"user_message"')) userCount++;
        else if (line.includes('"agent_message"')) agentCount++;
      }
    } catch { /* ignore */ }

    out.push({
      id: r.meta.id ?? path.basename(r.filePath, '.jsonl'),
      filePath: r.filePath,
      cwd: r.meta.cwd ?? '',
      startedAt: r.meta.timestamp ?? '',
      cliVersion: r.meta.cli_version,
      firstPrompt,
      userMsgCount: userCount,
      agentMsgCount: agentCount,
      fileSize: r.size,
    });
  }
  return out;
}

/**
 * Replay user/agent messages from a session rollout into a flat list usable
 * by OGF. Each turn = one user message + one agent message (concatenated text
 * from any number of agent_message events between user prompts).
 */
export function replaySession(sessionId: string): {
  cwd: string;
  startedAt: string;
  messages: CodexReplayMessage[];
} | null {
  // Find file by session id
  let filePath: string | null = null;
  walkSessionFiles(SESSIONS_ROOT, (abs, name) => {
    if (name.includes(sessionId)) filePath = abs;
  });
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const messages: CodexReplayMessage[] = [];
  let cwd = '';
  let startedAt = '';
  let agentBuffer = '';
  let agentTs: string | undefined;

  function flushAgent() {
    if (agentBuffer.trim()) {
      messages.push({ role: 'agent', content: agentBuffer.trim(), ts: agentTs });
    }
    agentBuffer = '';
    agentTs = undefined;
  }

  for (const line of lines) {
    if (!line) continue;
    let obj: { type?: string; payload?: Record<string, unknown>; timestamp?: string };
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'session_meta') {
      const p = (obj.payload ?? {}) as SessionMetaPayload;
      cwd = p.cwd ?? '';
      startedAt = p.timestamp ?? '';
      continue;
    }
    if (obj.type !== 'event_msg' || !obj.payload) continue;
    const p = obj.payload as { type?: string; message?: string; text?: string };
    if (p.type === 'user_message') {
      flushAgent();
      const text = String(p.message ?? '').trim();
      if (text) messages.push({ role: 'user', content: text, ts: obj.timestamp });
    } else if (p.type === 'agent_message') {
      const text = String(p.message ?? p.text ?? '');
      if (text) {
        agentBuffer += (agentBuffer && !agentBuffer.endsWith('\n') ? '\n' : '') + text;
        agentTs = agentTs ?? obj.timestamp;
      }
    }
  }
  flushAgent();

  return { cwd, startedAt, messages };
}
