export type AgentId = 'codex';
export type EngineKind = 'godot' | 'unity' | 'web' | 'unknown';

export interface AgentInfo {
  id: AgentId;
  name: string;
  bin: string;
  available: boolean;
  path?: string;
  version?: string;
  models: AgentModel[];
}

export interface AgentModel {
  id: string;
  label: string;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface CreateRunRequest {
  agentId: AgentId;
  prompt: string;
  /** Either projectPath (when no conversation yet) OR conversationId (preferred). */
  projectPath?: string;
  conversationId?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  refImagePaths?: string[];
}

export interface CreateRunResponse {
  runId: string;
  conversationId: string;
}

export interface Project {
  path: string;
  name: string;
  engine: EngineKind;
  lastOpenedAt: number;
  createdAt: number;
}

export interface OpenProjectRequest {
  path: string;
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface Conversation {
  id: string;
  projectPath: string;
  title: string | null;
  codexThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface CreateConversationRequest {
  projectPath: string;
  title?: string;
}

export interface Message {
  id: number;
  conversationId: string;
  role: 'user' | 'agent';
  content: string;
  events?: unknown[];
  position: number;
  createdAt: number;
}

export interface MessagesResponse {
  messages: Message[];
}

// -------- Files --------

export type FileKind = 'text' | 'image' | 'binary';

export interface FileNode {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  fileKind?: FileKind;
  size?: number;
  mtimeMs?: number;
  children?: FileNode[];
}

export interface FileTreeResponse {
  tree: FileNode;
}

export interface ReadFileResponse {
  kind: FileKind;
  content?: string;
  base64?: string;
  size: number;
  truncated?: boolean;
}

export interface WriteFileRequest {
  projectPath: string;
  relPath: string;
  content: string;
}

export interface UploadRefRequest {
  projectPath: string;
  filename: string;
  base64: string;
}

export interface RefImage {
  relPath: string;
  size: number;
  mtimeMs: number;
}

export interface RefImagesResponse {
  refs: RefImage[];
}

export interface AnalyzeResponse {
  engine: EngineKind;
  usedAssets: string[];
  scanned: number;
  /** Godot only: the run/main_scene from project.godot (project-relative). */
  mainScene?: string;
}

export interface UsageHit {
  file: string;
  line: number;
  col: number;
  snippet: string;
}

export interface UsagesResponse {
  hits: UsageHit[];
}

export interface PendingSliceEntry {
  /** Path to the source sprite (e.g. assets/enemies/scout/sheet-transparent.png). */
  sourcePath: string;
  /** Path of the .ogf-slice.json file. */
  sidecarPath: string;
  cols: number;
  rows: number;
  fps: number;
  anchor: string;
  padding: number;
  offsetX: number;
  offsetY: number;
  frameW?: number;
  frameH?: number;
  mtimeMs: number;
  /** Where the source sprite is referenced in the project. */
  usages: UsageHit[];
}

export interface PendingSlicesResponse {
  pending: PendingSliceEntry[];
}

export interface CodexSessionSummary {
  id: string;
  cwd: string;
  startedAt: string;
  cliVersion?: string;
  firstPrompt?: string;
  userMsgCount?: number;
  agentMsgCount?: number;
  fileSize: number;
}

export interface CodexSessionsResponse {
  sessions: CodexSessionSummary[];
}

export interface ImportCodexSessionRequest {
  projectPath: string;
  sessionId: string;
  /** When true, replay user/agent text into the new conversation's message log. Default: true. */
  replay?: boolean;
  title?: string;
}

export interface ImportCodexSessionResponse {
  conversation: Conversation;
  importedCount: number;
}

// -------- Godot runner --------

export interface GodotDetectResponse {
  available: boolean;
  path?: string;
  version?: string;
  source?: 'env' | 'path';
}

export interface GodotStartRequest {
  projectPath: string;
  /** Optional .tscn (project-relative) — defaults to the project's main_scene. */
  mainScene?: string;
  /** Override binary path, otherwise the daemon picks via detect. */
  godotPath?: string;
}

export interface GodotStartResponse {
  runId: string;
}

export interface GodotActiveRunResponse {
  runId: string | null;
}
