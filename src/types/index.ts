/**
 * src/types/index.ts
 * Central type definitions for the Aethra roleplay application.
 * All shared interfaces and enums are declared here to ensure consistency
 * across components, services, and the Electron main process.
 */

/* ── Chat & sessions ──────────────────────────────────────────────────── */

/** Identifies who authored a message in the conversation. */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * A single message within a roleplay session.
 */
export interface Message {
  /** Unique identifier for the message. */
  id: string
  /** Who sent this message. */
  role: MessageRole
  /** Campaign character ID the user selected when writing this message, if any. */
  characterId?: string
  /** Character name snapshot captured when the message was created, if any. */
  characterName?: string
  /** The text content of the message. */
  content: string
  /** Unix timestamp (ms) when the message was created. */
  timestamp: number
}

/**
 * A roleplay session, analogous to a conversation thread.
 * Contains metadata and the full message history.
 */
export interface Session {
  /** Unique identifier for the session. */
  id: string
  /** Human-readable title shown in the sidebar. */
  title: string
  /** Ordered list of messages exchanged in this session. */
  messages: Message[]
  /** Unix timestamp (ms) when the session was created. */
  createdAt: number
  /** Unix timestamp (ms) of the most recent activity. */
  updatedAt: number
}

/**
 * A persisted campaign file containing multiple sessions.
 */
export interface Campaign {
  /** Unique identifier for the campaign. */
  id: string
  /** Human-readable campaign name. */
  name: string
  /** Short descriptive summary of the campaign. */
  description: string
  /** Ordered list of sessions that belong to the campaign. */
  sessions: Session[]
  /** Unix timestamp (ms) when the campaign was created. */
  createdAt: number
  /** Unix timestamp (ms) of the most recent campaign update. */
  updatedAt: number
}

/**
 * Stored campaign plus its containing folder path.
 */
export interface CampaignFileHandle {
  /** Absolute filesystem path of the campaign folder. */
  path: string
  /** Parsed campaign content loaded from that file. */
  campaign: Campaign
}

/**
 * Lightweight campaign metadata shown in the launcher.
 */
export interface CampaignSummary {
  /** Unique campaign identifier. */
  id: string
  /** Display name shown in the campaign picker. */
  name: string
  /** Short descriptive summary shown in the campaign picker. */
  description: string
  /** Absolute filesystem path of the stored campaign folder. */
  path: string
  /** Unix timestamp (ms) of the most recent campaign update. */
  updatedAt: number
  /** Total sessions currently stored in the campaign. */
  sessionCount: number
}

/**
 * A persisted character profile stored within a campaign's characters folder.
 */
export interface CharacterProfile {
  /** Unique character identifier. */
  id: string
  /** Display name shown in the characters modal. */
  name: string
  /** Filesystem folder name allocated for this character. */
  folderName: string
  /** Character role or archetype shown in the character list. */
  role: string
  /** Character gender identity used in prompts and editor defaults. */
  gender: 'male' | 'female' | 'non-specific'
  /** Character pronouns used in prompts and editor defaults. */
  pronouns: 'he/him' | 'she/her' | 'they/them'
  /** Physical description and presentation details. */
  description: string
  /** Personality traits and temperament notes. */
  personality: string
  /** Guidance for the way this character speaks. */
  speakingStyle: string
  /** Current objectives, motivations, or priorities. */
  goals: string
  /** Uploaded avatar image stored as a data URL, if one has been chosen. */
  avatarImageData: string | null
  /** Manual circle crop state used to frame the avatar in chat. */
  avatarCrop: CharacterAvatarCrop
  /** Which participant controls this character in play. */
  controlledBy: 'ai' | 'user'
  /** Unix timestamp (ms) when the character was created. */
  createdAt: number
  /** Unix timestamp (ms) when the character was last updated. */
  updatedAt: number
}

/**
 * Manual image framing state for a circular avatar crop.
 */
export interface CharacterAvatarCrop {
  /** Horizontal image offset within the crop viewport, in pixels. */
  x: number
  /** Vertical image offset within the crop viewport, in pixels. */
  y: number
  /** Rendered image scale multiplier. */
  scale: number
}

/**
 * A single message in the format expected by OpenAI-compatible chat APIs.
 * Used when building the payload sent to the AI server.
 */
export interface ChatMessage {
  /** Author role. */
  role: 'user' | 'assistant' | 'system'
  /** Text content. */
  content: string
}

/**
 * Token usage reported by an OpenAI-compatible server.
 */
export interface TokenUsage {
  /** Tokens consumed by the prompt portion of the request. */
  promptTokens: number
  /** Tokens generated by the completion. */
  completionTokens: number
  /** Total tokens reported for the request. */
  totalTokens: number
}

/**
 * A single debug event captured around AI server traffic.
 */
export interface AiDebugEntry {
  /** Stable identifier for list rendering. */
  id: string
  /** Unix timestamp in milliseconds when the event was recorded. */
  timestamp: number
  /** High-level category for the event. */
  direction: 'request' | 'response' | 'info' | 'error'
  /** Short event label. */
  label: string
  /** Structured payload recorded for inspection. */
  payload: unknown
}

/* ── Settings ─────────────────────────────────────────────────────────── */

/** Supported visual modes for themes. */
export type ThemeMode = 'dark' | 'light'

/** Supported chat bubble text size presets. */
export type ChatTextSize = 'small' | 'medium' | 'large' | 'extra-large'

/** Supported AI provider kinds. */
export type ServerKind = 'lmstudio' | 'text-generation-webui' | 'openai-compatible' | 'llama.cpp'

/** Origin of a persisted model preset. */
export type ModelSource = 'remote' | 'huggingface' | 'local-file'

/** Public theme token names allowed in built-in or imported theme files. */
export type ThemeTokenName =
  | 'app-bg'
  | 'panel-bg'
  | 'surface-bg'
  | 'surface-bg-emphasis'
  | 'surface-bg-selected'
  | 'surface-bg-user-message'
  | 'surface-bg-accent'
  | 'surface-bg-accent-hover'
  | 'surface-bg-overlay'
  | 'border-color'
  | 'border-color-accent'
  | 'text-color-primary'
  | 'text-color-secondary'
  | 'text-color-muted'
  | 'text-color-on-accent'
  | 'text-color-brand'
  | 'scrollbar-thumb'
  | 'scrollbar-thumb-hover'
  | 'shadow-panel'
  | 'shadow-modal'

/**
 * A downloadable/importable theme definition.
 * Tokens are partial so custom themes can override only the values they need.
 */
export interface ThemeDefinition {
  /** Unique identifier used in persisted settings and theme selection. */
  id: string
  /** Human-readable theme name shown in the settings modal. */
  name: string
  /** Declares whether the theme is primarily light or dark. */
  mode: ThemeMode
  /** Token override map applied to the semantic CSS variable layer. */
  tokens: Partial<Record<ThemeTokenName, string>>
}

/**
 * Window chrome state mirrored from Electron into the renderer.
 */
export interface WindowControlsState {
  /** Host operating system reported by the Electron main process. */
  platform: 'darwin' | 'win32' | 'linux'
  /** True when the window is currently maximized. */
  isMaximized: boolean
}

/**
 * A configured AI server the user can connect to.
 * Stored in AppSettings and persisted to userData/settings.json.
 */
export interface ServerProfile {
  /** Unique identifier. */
  id: string
  /** Display name shown in the UI (e.g. "LM Studio"). */
  name: string
  /** Provider/runtime kind used for transport and local management. */
  kind: ServerKind
  /** Base URL of the OpenAI-compatible API (e.g. http://localhost:1234/v1). */
  baseUrl: string
  /** API key — most local servers accept any non-empty string. */
  apiKey: string
  /** Absolute directory where local GGUF files are stored for llama.cpp. */
  modelsDirectory?: string
  /** Absolute path to the llama-server executable when configured manually. */
  executablePath?: string | null
  /** Host interface bound by the local llama.cpp server. */
  host?: string
  /** Port bound by the local llama.cpp server. */
  port?: number
  /** Optional Hugging Face token for gated/private model downloads. */
  huggingFaceToken?: string
}

/**
 * A saved model preset associated with a server.
 */
export interface ModelPreset {
  /** Unique identifier. */
  id: string
  /** ID of the ServerProfile this model belongs to. */
  serverId: string
  /** Display name shown in the UI (e.g. "Llama 3 8B"). */
  name: string
  /** Model slug sent to the API (e.g. "llama3", "local-model"). */
  slug: string
  /** Indicates whether this model comes from a remote catalog or a local file. */
  source?: ModelSource
  /** Absolute local filesystem path for llama.cpp-managed GGUF files. */
  localPath?: string
  /** Hugging Face repository id the model was downloaded from. */
  huggingFaceRepo?: string
  /** Hugging Face filename/path selected within the repository. */
  huggingFaceFile?: string
  /** Stored model file size in bytes, when known. */
  fileSizeBytes?: number
  /** Parsed parameter size hint in billions, when detectable. */
  parameterSizeBillions?: number
  /** Parsed quantization hint, such as Q4_K_M or Q8_0. */
  quantization?: string
  /** Optional approximate context window size for UI budgeting. */
  contextWindowTokens?: number
  /** Optional llama.cpp GPU layer count used when loading a local model. */
  gpuLayers?: number
  /** Optional llama.cpp CPU thread count used when loading a local model. */
  threads?: number
  /** Optional llama.cpp batch size used when loading a local model. */
  batchSize?: number
  /** Optional llama.cpp micro-batch size used when loading a local model. */
  microBatchSize?: number
  /** Optional llama.cpp flash-attention toggle used when loading a local model. */
  flashAttention?: boolean
  /** Optional sampling temperature used for chat completions. */
  temperature?: number
  /** Optional nucleus sampling value used for chat completions. */
  topP?: number
  /** Optional top-k sampling limit used for chat completions. */
  topK?: number
  /** Optional repetition penalty used for chat completions. */
  repeatPenalty?: number
  /** Optional RNG seed override used for chat completions. */
  seed?: number
  /** Optional maximum number of tokens to generate per completion. */
  maxOutputTokens?: number
  /** Optional presence penalty used for chat completions. */
  presencePenalty?: number
  /** Optional frequency penalty used for chat completions. */
  frequencyPenalty?: number
}

/**
 * A model discovered live from a configured AI server.
 */
export interface AvailableModel {
  /** Stable ID from the upstream server model listing. */
  id: string
  /** ID of the ServerProfile the model belongs to. */
  serverId: string
  /** Human-readable display name. */
  name: string
  /** Model slug sent to the API. */
  slug: string
  /** Indicates whether this model comes from a remote catalog or a local file. */
  source?: ModelSource
  /** Absolute local filesystem path for llama.cpp-managed GGUF files. */
  localPath?: string
  /** Hugging Face repository id the model was downloaded from. */
  huggingFaceRepo?: string
  /** Hugging Face filename/path selected within the repository. */
  huggingFaceFile?: string
  /** Stored model file size in bytes, when known. */
  fileSizeBytes?: number
  /** Parsed parameter size hint in billions, when detectable. */
  parameterSizeBillions?: number
  /** Parsed quantization hint, such as Q4_K_M or Q8_0. */
  quantization?: string
  /** Optional approximate context window size for UI budgeting. */
  contextWindowTokens?: number
  /** Optional llama.cpp GPU layer count used when loading a local model. */
  gpuLayers?: number
  /** Optional llama.cpp CPU thread count used when loading a local model. */
  threads?: number
  /** Optional llama.cpp batch size used when loading a local model. */
  batchSize?: number
  /** Optional llama.cpp micro-batch size used when loading a local model. */
  microBatchSize?: number
  /** Optional llama.cpp flash-attention toggle used when loading a local model. */
  flashAttention?: boolean
  /** Optional sampling temperature reported by the server. */
  temperature?: number
  /** Optional nucleus sampling value reported by the server. */
  topP?: number
  /** Optional top-k sampling limit reported by the server. */
  topK?: number
  /** Optional repetition penalty reported by the server. */
  repeatPenalty?: number
  /** Optional RNG seed override reported by the server. */
  seed?: number
  /** Optional maximum number of tokens to generate per completion. */
  maxOutputTokens?: number
  /** Optional presence penalty reported by the server. */
  presencePenalty?: number
  /** Optional frequency penalty reported by the server. */
  frequencyPenalty?: number
}

/**
 * A single GPU/device entry detected on the host system.
 */
export interface HardwareGpuInfo {
  /** Human-readable device name. */
  name: string
  /** Best-effort vendor classification derived from the device name. */
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown'
  /** Dedicated or advertised VRAM in bytes, when detectable. */
  vramBytes: number | null
  /** Best-effort driver version string, when available. */
  driverVersion: string | null
}

/**
 * Hardware summary used for local model fit guidance.
 */
export interface HardwareInfo {
  /** Unix timestamp (ms) when the scan completed. */
  detectedAt: number
  /** Host platform string reported by Node.js. */
  platform: string
  /** CPU model string reported by Node.js. */
  cpuModel: string
  /** Logical CPU core count. */
  logicalCpuCount: number
  /** Total system memory in bytes. */
  totalMemoryBytes: number
  /** Best-effort GPU inventory. */
  gpus: HardwareGpuInfo[]
  /** Recommended llama.cpp acceleration backend for the detected system. */
  recommendedBackend: 'cuda' | 'vulkan' | 'metal' | 'cpu'
}

/**
 * Heuristic fit assessment for running a local GGUF model on the detected GPU.
 */
export interface ModelFitEstimate {
  /** High-level severity bucket for the advice. */
  level: 'good' | 'warning' | 'critical' | 'unknown'
  /** Human-readable recommendation text. */
  message: string
  /** Estimated VRAM required for a mostly-GPU load, in bytes. */
  estimatedVramBytes: number | null
  /** Best available GPU VRAM reported by hardware detection, in bytes. */
  availableVramBytes: number | null
  /** True when the model is likely to fit mostly or fully into GPU memory. */
  fitsFullyInGpu: boolean | null
}

/**
 * A downloadable GGUF file discovered in a Hugging Face repository.
 */
export interface HuggingFaceModelFile {
  /** Repository-relative file path. */
  path: string
  /** File name without directory segments. */
  name: string
  /** File size in bytes, when reported by Hugging Face. */
  sizeBytes: number | null
  /** Parsed parameter size hint in billions, when detectable. */
  parameterSizeBillions: number | null
  /** Parsed quantization hint, such as Q4_K_M or Q8_0. */
  quantization: string | null
}

/**
 * Progress update emitted while downloading a model from Hugging Face.
 */
export interface ModelDownloadProgress {
  /** Stable identifier for the download operation. */
  downloadId: string
  /** Owning server/profile id. */
  serverId: string
  /** Hugging Face repository id being downloaded. */
  repoId: string
  /** Repository-relative model file path. */
  fileName: string
  /** Absolute destination path on disk. */
  destinationPath: string
  /** Current status of the download. */
  status: 'starting' | 'downloading' | 'completed' | 'error'
  /** Bytes written so far. */
  bytesDownloaded: number
  /** Expected total bytes, when reported by the server. */
  totalBytes: number | null
  /** Completion percentage, when the total size is known. */
  percent: number | null
  /** Optional user-facing error or status detail. */
  message: string | null
}

/**
 * Progress update broadcast during an automatic llama-server binary install.
 * Sent via the `llama:binary:install:progress` IPC channel.
 */
export interface BinaryInstallProgress {
  /** Current phase of the install operation. */
  status: 'detecting' | 'downloading' | 'extracting' | 'complete' | 'error'
  /** Download completion 0–100; null during non-download phases. */
  percent: number | null
  /** Human-readable status line for display in the UI. */
  message: string
  /** Display name of the detected backend; null during the detecting phase. */
  backend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU' | null
}

/**
 * Current state of the managed local llama.cpp server process.
 */
export interface LocalRuntimeStatus {
  /** Lifecycle state for the managed process. */
  state: 'stopped' | 'starting' | 'running' | 'error'
  /** Server/profile id owning the runtime. */
  serverId: string
  /** Active model slug, when a model is loaded. */
  modelSlug: string | null
  /** Active model path, when a model is loaded. */
  modelPath: string | null
  /** Child process identifier, when running. */
  pid: number | null
  /** Base URL exposed by the local server. */
  url: string
  /** Optional last error recorded by the runtime manager. */
  lastError: string | null
  /** Unix timestamp (ms) when the current runtime started. */
  startedAt: number | null
}

/**
 * Persisted application settings.
 * Loaded from / saved to <userData>/settings.json by the main process.
 */
export interface AppSettings {
  /** All configured server profiles. */
  servers: ServerProfile[]
  /** All saved model presets. */
  models: ModelPreset[]
  /** ID of the server profile currently selected as default. */
  activeServerId: string | null
  /** Model slug currently selected as default. */
  activeModelSlug: string | null
  /** System prompt prepended to each chat request. */
  systemPrompt: string
  /** Selected chat bubble text size preset. */
  chatTextSize: ChatTextSize
  /** Selected visual theme ID. Built-ins and custom themes share the same namespace. */
  activeThemeId: string
  /** Imported user theme definitions. */
  customThemes: ThemeDefinition[]
}
