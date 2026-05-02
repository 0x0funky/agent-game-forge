import type {
  AgentEvent,
  AgentsResponse,
  AnalyzeResponse,
  Conversation,
  ConversationsResponse,
  CreateConversationRequest,
  CreateRunRequest,
  CreateRunResponse,
  EngineKind,
  FileNode,
  FileTreeResponse,
  Message,
  MessagesResponse,
  OpenProjectRequest,
  PendingSliceEntry,
  PendingSlicesResponse,
  Project,
  ProjectsResponse,
  ReadFileResponse,
  RefImage,
  RefImagesResponse,
  UploadRefRequest,
  UsagesResponse,
  WriteFileRequest,
} from '@ogf/contracts';

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${input}: ${r.status} ${t}`);
  }
  return r.json();
}

// Agents
export const fetchAgents = () => jsonFetch<AgentsResponse>('/api/agents');

// Projects
export const fetchProjects = () => jsonFetch<ProjectsResponse>('/api/projects');

export const openProject = (path: string) =>
  jsonFetch<{ project: Project }>('/api/projects/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path } satisfies OpenProjectRequest),
  });

export const fetchAnalyze = (projectPath: string) =>
  jsonFetch<AnalyzeResponse>(
    `/api/projects/analyze?projectPath=${encodeURIComponent(projectPath)}`,
  );

// Codex session discovery + import
import type {
  CodexSessionSummary,
  CodexSessionsResponse,
  ImportCodexSessionRequest,
  ImportCodexSessionResponse,
} from '@ogf/contracts';

export const fetchCodexSessions = (cwd: string) =>
  jsonFetch<CodexSessionsResponse>(
    `/api/codex/sessions?cwd=${encodeURIComponent(cwd)}`,
  );

export const importCodexSession = (req: ImportCodexSessionRequest) =>
  jsonFetch<ImportCodexSessionResponse>('/api/conversations/import-codex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export type { CodexSessionSummary, ImportCodexSessionResponse };

export const fetchUsages = (projectPath: string, relPath: string) =>
  jsonFetch<UsagesResponse>(
    `/api/projects/usages?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

export const fetchPendingSlices = (projectPath: string) =>
  jsonFetch<PendingSlicesResponse>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const clearPendingSlices = (projectPath: string) =>
  jsonFetch<{ ok: true; removed: number }>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
    { method: 'DELETE' },
  );

export const removeProject = (path: string) =>
  jsonFetch<{ ok: true }>(
    `/api/projects?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' },
  );

// Conversations
export const fetchConversations = (projectPath: string) =>
  jsonFetch<ConversationsResponse>(
    `/api/conversations?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const createConversation = (projectPath: string, title?: string) =>
  jsonFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, title } satisfies CreateConversationRequest),
  });

export const removeConversation = (id: string) =>
  jsonFetch<{ ok: true }>(`/api/conversations/${id}`, { method: 'DELETE' });

export const fetchMessages = (conversationId: string) =>
  jsonFetch<MessagesResponse>(`/api/conversations/${conversationId}/messages`);

// Files
export const fetchFileTree = (projectPath: string) =>
  jsonFetch<FileTreeResponse>(
    `/api/files/tree?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const fetchFileContent = (projectPath: string, relPath: string) =>
  jsonFetch<ReadFileResponse>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

export const writeFileContent = (req: WriteFileRequest) =>
  jsonFetch<{ ok: true; size: number }>('/api/files/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export const deleteFile = (projectPath: string, relPath: string) =>
  jsonFetch<{ ok: true }>(
    `/api/files?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
    { method: 'DELETE' },
  );

// Reference images
export const fetchRefs = (projectPath: string) =>
  jsonFetch<RefImagesResponse>(
    `/api/files/refs?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const uploadRef = (req: UploadRefRequest) =>
  jsonFetch<{ relPath: string; size: number }>('/api/files/refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export const deleteRef = (projectPath: string, relPath: string) =>
  jsonFetch<{ ok: true }>(
    `/api/files/refs?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
    { method: 'DELETE' },
  );

// Filesystem browse
export interface FsListEntry {
  name: string;
  path: string;
  engine?: string;
}
export interface FsListResult {
  cwd: string;
  parent: string | null;
  parts: { name: string; path: string }[];
  drives?: string[];
  entries: FsListEntry[];
  isProject?: boolean;
  engine?: string;
}
export const fsList = (p: string) =>
  jsonFetch<FsListResult>(`/api/fs/list?path=${encodeURIComponent(p)}`);

// Browser-side: convert a File to base64 for upload (without data URL prefix).
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Runs
export const createRun = (req: CreateRunRequest) =>
  jsonFetch<CreateRunResponse>('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
}

export type StreamEvent =
  | { type: 'start'; data: { conversationId: string; resumed: boolean } & Record<string, unknown> }
  | { type: 'agent'; data: AgentEvent }
  | { type: 'stdout'; data: { chunk: string } }
  | { type: 'stderr'; data: { chunk: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'end'; data: { code: number | null; status: string } };

export function subscribeRun(
  runId: string,
  onEvent: (e: StreamEvent) => void,
): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);

  const types: StreamEvent['type'][] = ['start', 'agent', 'stdout', 'stderr', 'error', 'end'];
  for (const t of types) {
    es.addEventListener(t, (ev) => {
      const e = ev as MessageEvent;
      try {
        const data = JSON.parse(e.data);
        onEvent({ type: t, data } as StreamEvent);
      } catch {
        // ignore
      }
      if (t === 'end') es.close();
    });
  }

  es.onerror = () => {
    es.close();
  };

  return () => es.close();
}

export type { AgentEvent, Conversation, EngineKind, FileNode, Message, PendingSliceEntry, Project, RefImage };

// Native folder picker (Chromium only). Returns path string or null.
// Note: showDirectoryPicker gives a handle but NOT an absolute path on disk.
// We surface handle.name as a hint and ask the daemon to resolve via user input fallback.
// This means in browsers without backing path access the user types/pastes the path.
// We deliberately use it only to detect support and offer a hint.
export function nativePickerSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function pickFolderHint(): Promise<string | null> {
  type FsApi = {
    showDirectoryPicker?: () => Promise<{ name: string }>;
  };
  const w = window as unknown as FsApi;
  if (typeof w.showDirectoryPicker !== 'function') return null;
  try {
    const handle = await w.showDirectoryPicker();
    return handle.name;
  } catch {
    return null;
  }
}
