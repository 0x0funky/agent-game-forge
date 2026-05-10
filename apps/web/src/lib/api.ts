import type {
  AgentEvent,
  AgentsResponse,
  AnalyzeResponse,
  AppendCommentMessageRequest,
  AppendCommentMessageResponse,
  ApplySceneOpsRequest,
  ApplySceneOpsResponse,
  CommentThread,
  CreateProjectRequest,
  CreateProjectResponse,
  Conversation,
  ConversationsResponse,
  CreateCommentThreadRequest,
  CreateCommentThreadResponse,
  CreateConversationRequest,
  CreateRunRequest,
  CreateRunResponse,
  EngineKind,
  FileNode,
  FileTreeResponse,
  GodotActiveRunResponse,
  GodotDetectResponse,
  GodotStartRequest,
  GodotStartResponse,
  ListCommentsResponse,
  LoadSceneResponse,
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
  UpdateCommentThreadRequest,
  UpdateCommentThreadResponse,
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

export const createProject = (req: CreateProjectRequest) =>
  jsonFetch<CreateProjectResponse>('/api/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

/** Refactor existing JS game: copy <sourcePath> → <destPath> (or
 *  <source>-ogf next to source by default), register the copy as a
 *  new project. Original folder is untouched. */
export const refactorCopy = (req: { sourcePath: string; destPath?: string }) =>
  jsonFetch<{ project: Project; sourcePath: string; destPath: string }>(
    '/api/projects/refactor-copy',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  );

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

// Sprite regenerate staging — Codex writes to .ogf/regen/<relPath>; the
// user reviews + applies or discards via these endpoints.
export const fetchRegenStaging = (projectPath: string, relPath: string) =>
  jsonFetch<{ exists: boolean; size?: number; base64?: string }>(
    `/api/files/regen/exists?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );
export const applyRegen = (projectPath: string, relPath: string) =>
  jsonFetch<{ ok: true }>('/api/files/regen/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, relPath }),
  });
export const discardRegen = (projectPath: string, relPath: string) =>
  jsonFetch<{ ok: true }>('/api/files/regen/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, relPath }),
  });

// Animation pack staging (whole-folder regen, see docs/asset-centric-view-plan.md).
export const fetchPendingPacks = (projectPath: string) =>
  jsonFetch<import('@ogf/contracts').PackListResponse>(
    `/api/files/regen/packs?projectPath=${encodeURIComponent(projectPath)}`,
  );
export const applyPack = (req: import('@ogf/contracts').ApplyPackRequest) =>
  jsonFetch<import('@ogf/contracts').ApplyPackResponse>('/api/files/regen/apply-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
export const discardPack = (req: import('@ogf/contracts').DiscardPackRequest) =>
  jsonFetch<import('@ogf/contracts').DiscardPackResponse>('/api/files/regen/discard-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

// Scenes (.tscn / web JSON)
//
// fetchScene + applySceneOps are coordinated through a module-level
// in-flight write Map. This solves a recurring "tab switch loses my edit"
// race:
//
//   1. user drags a prop, mouseup commits, scheduleSave debounces 50ms
//   2. user clicks a different tab → SceneEditor unmounts
//   3. cleanup effect fires flushSave (fire-and-forget POST)
//   4. user clicks back → SceneEditor remounts → fetchScene fires
//   5. without coordination, the GET races the POST: if GET wins, the
//      response is the OLD JSON and the user sees their edit "revert"
//
// The Map stores the in-flight POST Promise per `projectPath:relPath`.
// fetchScene awaits any pending write for the same key before issuing
// the GET. New POSTs chain after pending ones so two saves to the same
// scene serialize on the daemon's filesystem write order.
const inFlightSceneWrites = new Map<string, Promise<unknown>>();

function sceneKey(projectPath: string, relPath: string): string {
  return `${projectPath}::${relPath}`;
}

export async function fetchScene(
  projectPath: string,
  relPath: string,
): Promise<LoadSceneResponse> {
  // Wait for any in-flight write to the same scene before reading.
  // Without this, a tab-switch-quickly flow can read stale JSON.
  const pending = inFlightSceneWrites.get(sceneKey(projectPath, relPath));
  if (pending) {
    try {
      await pending;
    } catch {
      // The pending write failed — read what's on disk anyway.
    }
  }
  return jsonFetch<LoadSceneResponse>(
    `/api/scenes/load?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );
}

export async function applySceneOps(
  req: ApplySceneOpsRequest,
): Promise<ApplySceneOpsResponse> {
  const key = sceneKey(req.projectPath, req.relPath);
  // Chain after any earlier in-flight write so saves to the same scene
  // are serialized in submit order. Without chaining, two near-
  // simultaneous saves can race on the daemon's filesystem write and
  // the later op's read-modify-write cycle (e.g. add-prop) operates on
  // the pre-first-write JSON, losing the first op.
  const prev = inFlightSceneWrites.get(key);
  const promise = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        // Earlier write failed — we still attempt our own write.
      }
    }
    return jsonFetch<ApplySceneOpsResponse>('/api/scenes/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  })();
  inFlightSceneWrites.set(key, promise);
  // Self-cleanup so the Map doesn't grow unbounded across long sessions.
  promise.finally(() => {
    if (inFlightSceneWrites.get(key) === promise) {
      inFlightSceneWrites.delete(key);
    }
  });
  return promise;
}

// Godot runner
export const detectGodot = () => jsonFetch<GodotDetectResponse>('/api/godot/detect');

export const startGodot = (req: GodotStartRequest) =>
  jsonFetch<GodotStartResponse>('/api/godot/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export async function stopGodot(runId: string): Promise<void> {
  await fetch(`/api/godot/runs/${runId}/stop`, { method: 'POST' });
}

export const fetchActiveGodotRun = (projectPath: string) =>
  jsonFetch<GodotActiveRunResponse>(
    `/api/godot/active?projectPath=${encodeURIComponent(projectPath)}`,
  );

export type GodotStreamEvent =
  | { type: 'start'; data: Record<string, unknown> }
  | { type: 'stdout'; data: { chunk: string } }
  | { type: 'stderr'; data: { chunk: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'end'; data: { code: number | null; signal: string | null; status: string } };

export function subscribeGodotRun(
  runId: string,
  onEvent: (e: GodotStreamEvent) => void,
): () => void {
  const es = new EventSource(`/api/godot/runs/${runId}/events`);
  const types: GodotStreamEvent['type'][] = ['start', 'stdout', 'stderr', 'error', 'end'];
  for (const t of types) {
    es.addEventListener(t, (ev) => {
      const e = ev as MessageEvent;
      try {
        const data = JSON.parse(e.data);
        onEvent({ type: t, data } as GodotStreamEvent);
      } catch {
        // ignore
      }
      if (t === 'end') es.close();
    });
  }
  es.onerror = () => es.close();
  return () => es.close();
}

// Comments
export const fetchComments = (projectPath: string, scene?: string) => {
  const q = `projectPath=${encodeURIComponent(projectPath)}${scene ? `&scene=${encodeURIComponent(scene)}` : ''}`;
  return jsonFetch<ListCommentsResponse>(`/api/comments?${q}`);
};

export const createCommentThread = (req: CreateCommentThreadRequest) =>
  jsonFetch<CreateCommentThreadResponse>('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export const appendCommentMessage = (threadId: string, req: AppendCommentMessageRequest) =>
  jsonFetch<AppendCommentMessageResponse>(`/api/comments/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export const updateCommentThread = (threadId: string, req: UpdateCommentThreadRequest) =>
  jsonFetch<UpdateCommentThreadResponse>(`/api/comments/${threadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

export const deleteCommentThread = (threadId: string, projectPath: string) =>
  jsonFetch<{ ok: true }>(
    `/api/comments/${threadId}?projectPath=${encodeURIComponent(projectPath)}`,
    { method: 'DELETE' },
  );

export type { CommentThread };

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
/** createRun returns the new run normally, but if the server detects an
 *  active run for the same conversation it returns 409 with the existing
 *  runId. Caller should check `existingRunId` and re-subscribe to that
 *  run's SSE stream instead of creating a duplicate codex spawn. */
export interface CreateRunDuplicate {
  duplicate: true;
  existingRunId: string;
  startedAt: number;
}
export async function createRun(
  req: CreateRunRequest,
): Promise<CreateRunResponse | CreateRunDuplicate> {
  const r = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (r.status === 409) {
    const data = (await r.json()) as { existingRunId: string; startedAt: number };
    return { duplicate: true, existingRunId: data.existingRunId, startedAt: data.startedAt };
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`/api/runs: ${r.status} ${t}`);
  }
  return r.json() as Promise<CreateRunResponse>;
}

export async function fetchActiveRun(conversationId: string): Promise<
  | { active: false }
  | { active: true; runId: string; status: string; startedAt: number; lastActivity: number }
> {
  return jsonFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/active-run`,
  );
}

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
