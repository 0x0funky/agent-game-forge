export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'usage'; usage: { input?: number; output?: number; cachedRead?: number } }
  | { type: 'raw'; raw: unknown };

export interface RunStartEvent {
  runId: string;
  agentId: string;
  bin: string;
  cwd: string;
  model?: string;
  reasoning?: string;
}

export interface RunEndEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  status: RunStatus;
}

export interface SseEnvelope<T = unknown> {
  event: 'start' | 'agent' | 'stdout' | 'stderr' | 'error' | 'end';
  data: T;
}
