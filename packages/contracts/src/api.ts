export type AgentId = 'codex' | 'claude-code';
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

// Mirrors the values Codex CLI accepts for `model_reasoning_effort`. Don't
// invent variants — the CLI's enum is `none / minimal / low / medium / high / xhigh`,
// and OGF previously sent `extra_high` which the CLI rejects with
// 'unknown variant'.
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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

export interface CreateProjectRequest {
  /** Absolute path the new project folder should live at. */
  path: string;
  /** Engine to scaffold. Web is `Canvas 2D + vanilla JS`. Unity disabled for now. */
  engine: Extract<EngineKind, 'godot' | 'web'>;
  /** Display name (used for project.godot config/name and HTML <title>). */
  name: string;
}

export interface CreateProjectResponse {
  project: Project;
  /** Files written by the scaffold (skipped any that already existed). */
  files: string[];
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface Conversation {
  id: string;
  projectPath: string;
  title: string | null;
  codexThreadId: string | null;
  /** Which CLI owns this conversation. Locked at create time. Pre-multi-CLI
   *  rows are backfilled to 'codex' via db migration v3. */
  agentId: AgentId;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface CreateConversationRequest {
  projectPath: string;
  /** Which CLI to associate the conversation with. Defaults to 'codex'
   *  when omitted for backward compat. */
  agentId?: AgentId;
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

// ── Animation pack staging ──
//
// generate2dsprite writes ~10 files per animation into one directory.
// A directory is a pack iff it contains BOTH sheet.png AND
// pipeline-meta.json. The pack staging endpoints work on directories
// (packDir, project-relative) instead of single relPaths.

export interface PackLayout {
  cols: number;
  rows: number;
  frames: number;
  cellSize: number | null;
  fps: number | null;
  anchor: string | null;
}

export interface PendingPack {
  /** Project-relative directory (e.g. assets/sprites/scout/idle). */
  packDir: string;
  fileCount: number;
  /** Layout of the staged pack. */
  stagingLayout: PackLayout | null;
  /** Layout of the live pack pre-apply (for diff). */
  liveLayout: PackLayout | null;
}

export interface PackListResponse {
  packs: PendingPack[];
}

export interface ApplyPackRequest {
  projectPath: string;
  packDir: string;
}

export interface ApplyPackResponse {
  applied: string[];
  failed: Array<{ relPath: string; err: string }>;
}

export interface DiscardPackRequest {
  projectPath: string;
  packDir: string;
}

export interface DiscardPackResponse {
  discarded: string[];
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

// -------- Secrets / API keys --------

/** Canonical secret keys recognized by the daemon. Add entries as new
 *  providers (Mistral, Replicate, etc.) come online. */
export type SecretKey =
  | 'openai_api_key'
  | 'gemini_api_key'
  | 'anthropic_api_key';

export interface SecretStatus {
  key: SecretKey;
  /** True when a value resolves (env or file). */
  set: boolean;
  /** True when an env var (OPENAI_API_KEY etc.) shadows the file. */
  fromEnv: boolean;
  /** Masked display ("sk-•••••••a1b2"). Empty string when unset. */
  masked: string;
  /** Env var name that shadows this key — shown in UI as a hint. */
  envVarName: string;
}

export interface SecretsResponse {
  secrets: SecretStatus[];
}

export interface SetSecretRequest {
  key: SecretKey;
  /** New value, or null/'' to clear. */
  value: string | null;
}

// -------- Image-gen preferences --------

export type ImageGenProvider = 'gemini' | 'openai';
export type ImageGenProviderPref = 'auto' | ImageGenProvider;

export interface ImageGenPrefs {
  /** 'auto' = prefer Gemini if keyed, else OpenAI. Specific value pins it. */
  provider: ImageGenProviderPref;
  /** Default model when the resolved provider is Gemini. */
  geminiModel: string;
  /** Default model when the resolved provider is OpenAI. */
  openaiModel: string;
}

export interface Preferences {
  image_gen: ImageGenPrefs;
}

export type PreferencesResponse = Preferences;

// -------- Gen-image usage / cost --------

export interface GenImageSummaryRow {
  provider: 'gemini' | 'openai';
  count: number;
  okCount: number;
  errorCount: number;
  estCostUsd: number;
}

export interface GenImageSummary {
  windowMs: number;
  totalCount: number;
  totalEstCostUsd: number;
  byProvider: GenImageSummaryRow[];
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
