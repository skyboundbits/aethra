/**
 * electron/main/index.ts
 * Electron main process for Aethra.
 *
 * Responsibilities:
 *   - Create and manage the BrowserWindow
 *   - Handle IPC for settings (read/write JSON in userData)
 *   - Handle IPC for AI streaming (SSE fetch to LM Studio / Ollama)
 *
 * Settings are persisted to:
 *   <userData>/settings.json
 * Defaults are loaded from:
 *   electron/main/defaults/servers.json + models.json
 */

import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { get as httpsGet } from 'https'
import { cpus, totalmem } from 'os'
import { basename, dirname, extname, join, relative } from 'path'

import type {
  AffinityLabel,
  AppSettings,
  AiDebugEntry,
  AvailableModel,
  BinaryInstallProgress,
  Campaign,
  CampaignFileHandle,
  CampaignLoadProgress,
  CampaignSummary,
  ChatTextSize,
  CharacterProfile,
  ReusableAvatar,
  ReusableCharacter,
  HardwareGpuInfo,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeStatus,
  LocalRuntimeLoadProgress,
  ModelDownloadProgress,
  ModelPreset,
  ChatMessage,
  RelationshipEntry,
  RelationshipGraph,
  ServerKind,
  ServerProfile,
  Session,
  TokenUsage,
  ThemeDefinition,
  WindowControlsState,
} from '../../src/types'
import {
  DEFAULT_CAMPAIGN_BASE_PROMPT,
  DEFAULT_CHAT_FORMATTING_RULES,
  DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
} from '../../src/prompts/campaignPrompts'

import defaultServersRaw from './defaults/servers.json'
import defaultModelsRaw  from './defaults/models.json'

const defaultServers = defaultServersRaw as ServerProfile[]
const defaultModels  = defaultModelsRaw  as ModelPreset[]
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 600
const MAX_AI_DEBUG_ENTRIES = 200
const AI_STREAM_INITIAL_TIMEOUT_MS = 30_000
const AI_STREAM_IDLE_TIMEOUT_MS = 60_000
const LOCAL_LLAMACPP_SERVER_ID = 'llama-cpp-local'
const LOCAL_LLAMACPP_DEFAULT_HOST = '127.0.0.1'
const LOCAL_LLAMACPP_DEFAULT_PORT = 3939
const MODEL_SCAN_EXTENSIONS = new Set(['.gguf'])

/** Pinned llama.cpp GitHub release tag used for binary auto-download. */
const LLAMA_CPP_RELEASE = 'b8460'

/**
 * Static asset lookup table for the pinned llama.cpp release.
 * Key format: `{platform}-{backend}` or `darwin-metal-{arch}`.
 * Update LLAMA_CPP_RELEASE and this table together when bumping the bundled version.
 * Windows assets use .zip; macOS and Linux assets use .tar.gz.
 */
const LLAMA_CPP_ASSETS: Record<string, { fileName: string; sizeMb: number; ext: 'zip' | 'tar.gz'; cudartFile?: string; cudartSizeMb?: number }> = {
  'win32-cuda':         { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-cuda-12.4-x64.zip`,    sizeMb: 126, ext: 'zip',     cudartFile: `cudart-llama-bin-win-cuda-12.4-x64.zip`, cudartSizeMb: 248 },
  'win32-vulkan':       { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-vulkan-x64.zip`,        sizeMb: 21,  ext: 'zip'    },
  'win32-cpu':          { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip`,           sizeMb: 14,  ext: 'zip'    },
  'darwin-metal-arm64': { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-macos-arm64.tar.gz`,        sizeMb: 10,  ext: 'tar.gz' },
  'darwin-metal-x64':   { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-macos-x64.tar.gz`,         sizeMb: 25,  ext: 'tar.gz' },
  'linux-cuda':         { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-vulkan-x64.tar.gz`,  sizeMb: 20,  ext: 'tar.gz' }, // no linux cuda build; fall back to vulkan
  'linux-vulkan':       { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-vulkan-x64.tar.gz`,  sizeMb: 20,  ext: 'tar.gz' },
  'linux-cpu':          { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-x64.tar.gz`,         sizeMb: 12,  ext: 'tar.gz' },
}

/** Display name mapping for recommendedBackend values. */
const BACKEND_DISPLAY: Record<string, 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'> = {
  cuda:   'CUDA',
  vulkan: 'Vulkan',
  metal:  'Metal',
  cpu:    'CPU',
}

/** In-flight binary install guard — prevents concurrent installs. */
let isBinaryInstalling = false

/** In-memory rolling log of AI transport debug events. */
const aiDebugLog: AiDebugEntry[] = []

/** Last hardware scan cached for reuse across renderer requests. */
let cachedHardwareInfo: HardwareInfo | null = null

/** Managed local llama.cpp server child process, when running. */
let localRuntimeProcess: ChildProcessWithoutNullStreams | null = null

/** Current managed local runtime status pushed to the renderer. */
let localRuntimeStatus: LocalRuntimeStatus = {
  state: 'stopped',
  serverId: LOCAL_LLAMACPP_SERVER_ID,
  modelSlug: null,
  modelPath: null,
  pid: null,
  url: `http://${LOCAL_LLAMACPP_DEFAULT_HOST}:${LOCAL_LLAMACPP_DEFAULT_PORT}/v1`,
  lastError: null,
  startedAt: null,
}

/** Current managed local runtime startup progress pushed to the renderer. */
let localRuntimeLoadProgress: LocalRuntimeLoadProgress | null = null

/**
 * Persisted BrowserWindow placement and display state.
 */
interface PersistedWindowState {
  /** Last non-maximized window bounds. */
  bounds: {
    /** Horizontal screen coordinate in device-independent pixels. */
    x?: number
    /** Vertical screen coordinate in device-independent pixels. */
    y?: number
    /** Window width in device-independent pixels. */
    width: number
    /** Window height in device-independent pixels. */
    height: number
  }
  /** True when the window was maximized at the time it last closed. */
  isMaximized: boolean
}

/**
 * Runtime window bounds with required coordinates.
 */
interface WindowBounds {
  /** Horizontal screen coordinate in device-independent pixels. */
  x: number
  /** Vertical screen coordinate in device-independent pixels. */
  y: number
  /** Window width in device-independent pixels. */
  width: number
  /** Window height in device-independent pixels. */
  height: number
}

/**
 * Lightweight message shape used to validate campaign files from disk.
 */
interface PartialMessageRecord {
  id?: unknown
  role?: unknown
  characterId?: unknown
  characterName?: unknown
  content?: unknown
  timestamp?: unknown
}

/**
 * Lightweight session shape used to validate campaign files from disk.
 */
interface PartialSessionRecord {
  id?: unknown
  title?: unknown
  sceneSetup?: unknown
  openingNotes?: unknown
  continuitySourceSessionId?: unknown
  continuitySummary?: unknown
  disabledCharacterIds?: unknown
  messages?: unknown
  rollingSummary?: unknown
  summarizedMessageCount?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Lightweight chat file reference stored inside campaign metadata.
 */
interface PartialSessionIndexRecord {
  id?: unknown
  fileName?: unknown
}

/**
 * Lightweight campaign metadata persisted to campaign.json.
 */
interface PartialCampaignRecord {
  id?: unknown
  name?: unknown
  description?: unknown
  sessions?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Lightweight character profile shape used to validate character files from disk.
 */
interface PartialCharacterRecord {
  id?: unknown
  name?: unknown
  folderName?: unknown
  role?: unknown
  description?: unknown
  personality?: unknown
  speakingStyle?: unknown
  goals?: unknown
  controlledBy?: unknown
  gender?: unknown
  pronouns?: unknown
  avatarImageData?: unknown
  avatarCrop?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Lightweight reusable avatar shape used to validate avatar library files from disk.
 */
interface PartialReusableAvatarRecord {
  id?: unknown
  name?: unknown
  imageData?: unknown
  crop?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Lightweight reusable character shape used to validate character library files from disk.
 */
interface PartialReusableCharacterRecord {
  id?: unknown
  name?: unknown
  role?: unknown
  gender?: unknown
  pronouns?: unknown
  description?: unknown
  personality?: unknown
  speakingStyle?: unknown
  goals?: unknown
  avatarImageData?: unknown
  avatarCrop?: unknown
  controlledBy?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Build the renderer-facing window control state for a BrowserWindow.
 *
 * @param win - BrowserWindow instance to describe.
 * @returns Serializable platform and maximize state.
 */
function getWindowState(win: BrowserWindow): WindowControlsState {
  return {
    platform: process.platform as WindowControlsState['platform'],
    isMaximized: win.isMaximized(),
  }
}

/**
 * Push the latest window control state into the renderer.
 *
 * @param win - BrowserWindow whose state should be broadcast.
 */
function broadcastWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed()) {
    win.webContents.send('window:state-changed', getWindowState(win))
  }
}

/**
 * Broadcast an IPC event to every open application window.
 *
 * @param channel - IPC channel name to publish.
 * @param args - Serializable payload arguments to send.
 */
function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}

/**
 * Return the default writable models directory requested by the app.
 *
 * Defaults to a `models` folder inside the application directory rather than
 * Electron's userData/AppData tree.
 *
 * @returns Absolute path to the default local model storage folder.
 */
function defaultLocalModelsDirectory(): string {
  return app.isPackaged
    ? join(dirname(app.getPath('exe')), 'models')
    : join(app.getAppPath(), 'models')
}

/**
 * Infer the provider kind for a partially persisted server profile.
 *
 * @param server - Raw server candidate loaded from disk.
 * @returns Concrete provider kind for the server.
 */
function inferServerKind(server: Partial<ServerProfile> | null | undefined): ServerKind {
  if (server?.kind === 'lmstudio' ||
      server?.kind === 'text-generation-webui' ||
      server?.kind === 'openai-compatible' ||
      server?.kind === 'llama.cpp') {
    return server.kind
  }

  const normalizedId = typeof server?.id === 'string' ? server.id.trim().toLowerCase() : ''
  const normalizedName = typeof server?.name === 'string' ? server.name.trim().toLowerCase() : ''
  if (normalizedId === LOCAL_LLAMACPP_SERVER_ID || normalizedName === 'local llama.cpp') {
    return 'llama.cpp'
  }
  if (normalizedId === 'lmstudio-default' || normalizedName === 'lm studio') {
    return 'lmstudio'
  }
  if (normalizedId === 'textgen-webui-default' || normalizedName === 'text-generation-webui') {
    return 'text-generation-webui'
  }

  return 'openai-compatible'
}

/**
 * Build the local base URL for a normalized llama.cpp server profile.
 *
 * @param server - Server profile whose host/port should be translated.
 * @returns OpenAI-compatible base URL for the managed local runtime.
 */
function buildLocalServerBaseUrl(server: Pick<ServerProfile, 'host' | 'port'>): string {
  const host = typeof server.host === 'string' && server.host.trim().length > 0
    ? server.host.trim()
    : LOCAL_LLAMACPP_DEFAULT_HOST
  const port = typeof server.port === 'number' && Number.isFinite(server.port) && server.port > 0
    ? Math.floor(server.port)
    : LOCAL_LLAMACPP_DEFAULT_PORT

  return `http://${host}:${port}/v1`
}

/**
 * Normalize a persisted server profile so all required provider-specific
 * fields exist and invalid legacy values are corrected.
 *
 * @param server - Raw server candidate loaded from disk.
 * @returns Fully normalized server profile.
 */
function normalizeServer(server: Partial<ServerProfile>): ServerProfile {
  const kind = inferServerKind(server)
  const normalizedServer: ServerProfile = {
    id: typeof server.id === 'string' && server.id.length > 0 ? server.id : uid(),
    name: typeof server.name === 'string' && server.name.trim().length > 0 ? server.name.trim() : 'AI Server',
    kind,
    baseUrl: typeof server.baseUrl === 'string' && server.baseUrl.trim().length > 0
      ? server.baseUrl.trim()
      : 'http://localhost:1234/v1',
    apiKey: typeof server.apiKey === 'string' && server.apiKey.length > 0
      ? server.apiKey
      : 'local',
  }

  if (kind === 'llama.cpp') {
    normalizedServer.host =
      typeof server.host === 'string' && server.host.trim().length > 0
        ? server.host.trim()
        : LOCAL_LLAMACPP_DEFAULT_HOST
    normalizedServer.port =
      typeof server.port === 'number' && Number.isFinite(server.port) && server.port > 0
        ? Math.floor(server.port)
        : LOCAL_LLAMACPP_DEFAULT_PORT
    normalizedServer.modelsDirectory =
      typeof server.modelsDirectory === 'string' && server.modelsDirectory.trim().length > 0
        ? server.modelsDirectory.trim()
        : defaultLocalModelsDirectory()
    normalizedServer.executablePath =
      typeof server.executablePath === 'string' && server.executablePath.trim().length > 0
        ? server.executablePath.trim()
        : null
    normalizedServer.huggingFaceToken =
      typeof server.huggingFaceToken === 'string'
        ? server.huggingFaceToken
        : ''
    normalizedServer.baseUrl = buildLocalServerBaseUrl(normalizedServer)
    normalizedServer.apiKey = normalizedServer.apiKey || 'llama.cpp'
  }

  return normalizedServer
}

/**
 * Return the first configured local llama.cpp server profile, if present.
 *
 * @param settings - App settings to inspect.
 * @returns Local server profile or null when none is configured.
 */
function getLocalServer(settings: AppSettings): ServerProfile | null {
  return settings.servers.find((server) => server.kind === 'llama.cpp') ?? null
}

/**
 * Normalize settings loaded from disk so newer required fields always exist.
 *
 * @param raw - Parsed settings candidate from disk.
 * @returns A fully populated AppSettings object.
 */
function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const persistedServers = Array.isArray(raw?.servers) ? raw.servers.map(normalizeServer) : []
  const persistedModels = Array.isArray(raw?.models) ? raw.models : []
  const mergedServers = [
    ...persistedServers,
    ...defaultServers.filter(
      (defaultServer) => !persistedServers.some((server) => server.id === defaultServer.id),
    ),
  ].map(normalizeServer)
  const mergedModels = [
    ...persistedModels,
    ...defaultModels.filter(
      (defaultModel) => !persistedModels.some((model) => model.id === defaultModel.id),
    ),
  ]
  const activeServerId = mergedServers.some((server) => server.id === raw?.activeServerId)
    ? raw?.activeServerId ?? null
    : mergedServers[0]?.id ?? null
  const activeServer = mergedServers.find((server) => server.id === activeServerId) ?? null
  const activeModelSlug = activeServer
    ? (
      mergedModels.some((model) =>
        model.serverId === activeServer.id && model.slug === raw?.activeModelSlug,
      )
        ? raw?.activeModelSlug ?? null
        : (mergedModels.find((model) => model.serverId === activeServer.id)?.slug ?? null)
    )
    : null

  return {
    servers: mergedServers,
    models: mergedModels,
    activeServerId,
    activeModelSlug,
    systemPrompt: typeof raw?.systemPrompt === 'string'
      ? raw.systemPrompt
      : 'You are a roleplaying agent responding naturally to the user.',
    campaignBasePrompt: typeof raw?.campaignBasePrompt === 'string' && raw.campaignBasePrompt.trim().length > 0
      ? raw.campaignBasePrompt
      : DEFAULT_CAMPAIGN_BASE_PROMPT,
    formattingRules: typeof raw?.formattingRules === 'string' && raw.formattingRules.trim().length > 0
      ? raw.formattingRules
      : DEFAULT_CHAT_FORMATTING_RULES,
    rollingSummarySystemPrompt:
      typeof raw?.rollingSummarySystemPrompt === 'string' && raw.rollingSummarySystemPrompt.trim().length > 0
        ? raw.rollingSummarySystemPrompt
        : DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
    enableRollingSummaries: raw?.enableRollingSummaries === true,
    showChatMarkup: raw?.showChatMarkup === true,
    chatTextSize: isChatTextSize(raw?.chatTextSize) ? raw.chatTextSize : 'small',
    assistantResponseRevealDelayMs:
      typeof raw?.assistantResponseRevealDelayMs === 'number' && Number.isFinite(raw.assistantResponseRevealDelayMs)
        ? Math.max(0, Math.min(10000, Math.round(raw.assistantResponseRevealDelayMs)))
        : 1500,
    activeThemeId: typeof raw?.activeThemeId === 'string' ? raw.activeThemeId : 'default',
    customThemes: Array.isArray(raw?.customThemes) ? raw.customThemes as ThemeDefinition[] : [],
  }
}

/**
 * Build a filesystem-safe key for a model profile file.
 *
 * @param serverId - Owning server profile id.
 * @param modelSlug - Model slug within that server.
 * @returns Stable filename stem for the model profile.
 */
function buildModelProfileKey(serverId: string, modelSlug: string): string {
  return `${serverId}__${modelSlug}`
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/**
 * Return the absolute path to the persisted model profile directory.
 *
 * @returns Full path to the userData models directory.
 */
function modelProfilesPath(): string {
  return join(app.getPath('userData'), 'models')
}

/**
 * Ensure the persisted model profile directory exists.
 *
 * @returns Absolute models directory path.
 */
function ensureModelProfilesPath(): string {
  const dir = modelProfilesPath()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * Return the absolute path to a single model profile JSON file.
 *
 * @param serverId - Owning server profile id.
 * @param modelSlug - Model slug within that server.
 * @returns Full path to the model profile JSON.
 */
function modelProfilePath(serverId: string, modelSlug: string): string {
  return join(ensureModelProfilesPath(), `${buildModelProfileKey(serverId, modelSlug)}.json`)
}

/**
 * Read a stored model profile override from disk, if present.
 *
 * @param serverId - Owning server profile id.
 * @param modelSlug - Model slug within that server.
 * @returns Parsed model profile override, or null when unavailable.
 */
function loadModelProfile(serverId: string, modelSlug: string): Partial<ModelPreset> | null {
  const path = modelProfilePath(serverId, modelSlug)
  if (!existsSync(path)) {
    return null
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ModelPreset>
    return raw
  } catch {
    return null
  }
}

/**
 * Ensure the configured local llama.cpp model directory exists.
 *
 * @param server - Local server profile whose directory should be prepared.
 * @returns Absolute local models directory path.
 */
function ensureLocalModelsDirectory(server: ServerProfile): string {
  const dir = server.modelsDirectory?.trim() || defaultLocalModelsDirectory()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * Build a deterministic model slug from a local GGUF path.
 *
 * @param server - Local server profile that owns the file.
 * @param filePath - Absolute GGUF file path.
 * @returns Stable slash-delimited slug relative to the configured models root.
 */
function buildLocalModelSlug(server: ServerProfile, filePath: string): string {
  const modelsDirectory = ensureLocalModelsDirectory(server)
  const relativePath = relative(modelsDirectory, filePath).replace(/\\/g, '/')
  return relativePath.length > 0 ? relativePath : basename(filePath)
}

/**
 * Parse lightweight model metadata from a GGUF filename.
 *
 * @param input - File name or repository path to inspect.
 * @returns Parsed parameter-size and quantization hints.
 */
function parseModelMetadataHints(input: string): {
  parameterSizeBillions?: number
  quantization?: string
} {
  const normalized = input.toUpperCase()
  const quantizationMatch = normalized.match(/(?:IQ\d(?:_[A-Z0-9]+)?|Q\d(?:_[A-Z0-9]+)?|BF16|F16|FP16|F32)/)
  const parameterMatch = normalized.match(/(\d+(?:\.\d+)?)B\b/)

  return {
    parameterSizeBillions: parameterMatch ? Number(parameterMatch[1]) : undefined,
    quantization: quantizationMatch?.[0],
  }
}

/**
 * Walk a directory tree and collect GGUF files.
 *
 * @param root - Directory to scan recursively.
 * @returns Absolute GGUF file paths found under the directory.
 */
function collectLocalModelFiles(root: string): string[] {
  if (!existsSync(root)) {
    return []
  }

  const entries = readdirSync(root, { withFileTypes: true })
  const results: string[] = []

  entries.forEach((entry) => {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectLocalModelFiles(fullPath))
      return
    }

    if (entry.isFile() && MODEL_SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(fullPath)
    }
  })

  return results
}

/**
 * Apply sane local llama.cpp defaults to a model preset.
 *
 * @param model - Base model preset.
 * @returns Model preset with concrete local-runtime defaults filled in.
 */
function applyLocalModelDefaults(model: ModelPreset): ModelPreset {
  return {
    ...model,
    source: model.source ?? (model.localPath ? 'local-file' : 'remote'),
    contextWindowTokens:
      typeof model.contextWindowTokens === 'number' && model.contextWindowTokens > 0
        ? Math.floor(model.contextWindowTokens)
        : 8192,
    gpuLayers:
      typeof model.gpuLayers === 'number' && Number.isFinite(model.gpuLayers) && model.gpuLayers >= 0
        ? Math.floor(model.gpuLayers)
        : 999,
    threads:
      typeof model.threads === 'number' && Number.isFinite(model.threads) && model.threads > 0
        ? Math.floor(model.threads)
        : Math.max(1, cpus().length),
    batchSize:
      typeof model.batchSize === 'number' && Number.isFinite(model.batchSize) && model.batchSize > 0
        ? Math.floor(model.batchSize)
        : 512,
    microBatchSize:
      typeof model.microBatchSize === 'number' && Number.isFinite(model.microBatchSize) && model.microBatchSize > 0
        ? Math.floor(model.microBatchSize)
        : 128,
    flashAttention: typeof model.flashAttention === 'boolean' ? model.flashAttention : true,
    temperature:
      typeof model.temperature === 'number' && Number.isFinite(model.temperature) && model.temperature >= 0
        ? model.temperature
        : 0.7,
    topP:
      typeof model.topP === 'number' && Number.isFinite(model.topP) && model.topP >= 0 && model.topP <= 1
        ? model.topP
        : 0.95,
    topK:
      typeof model.topK === 'number' && Number.isFinite(model.topK) && model.topK >= 0
        ? Math.floor(model.topK)
        : 40,
    repeatPenalty:
      typeof model.repeatPenalty === 'number' && Number.isFinite(model.repeatPenalty) && model.repeatPenalty >= 0
        ? Number(model.repeatPenalty.toFixed(2))
        : 1.1,
    seed:
      typeof model.seed === 'number' && Number.isFinite(model.seed)
        ? Math.floor(model.seed)
        : undefined,
    maxOutputTokens:
      typeof model.maxOutputTokens === 'number' && Number.isFinite(model.maxOutputTokens) && model.maxOutputTokens > 0
        ? Math.floor(model.maxOutputTokens)
        : 512,
  }
}

/**
 * Build a normalized local model preset from a GGUF file on disk.
 *
 * @param server - Local server profile that owns the file.
 * @param filePath - Absolute GGUF path.
 * @param existingModel - Existing preset metadata to merge, if any.
 * @returns Fully normalized local model preset.
 */
function buildLocalModelPreset(
  server: ServerProfile,
  filePath: string,
  existingModel?: ModelPreset,
): ModelPreset {
  const fileName = basename(filePath)
  const stats = statSync(filePath)
  const slug = buildLocalModelSlug(server, filePath)
  const storedModel = loadModelProfile(server.id, slug) ?? {}
  const parsed = parseModelMetadataHints(
    existingModel?.huggingFaceFile ??
    (typeof storedModel.huggingFaceFile === 'string' && storedModel.huggingFaceFile.length > 0
      ? storedModel.huggingFaceFile
      : fileName),
  )

  return applyLocalModelDefaults({
    ...storedModel,
    ...(existingModel ?? {}),
    id:
      existingModel?.id ??
      (typeof storedModel.id === 'string' && storedModel.id.length > 0 ? storedModel.id : `${server.id}:${slug}`),
    serverId: server.id,
    name:
      existingModel?.name ??
      (typeof storedModel.name === 'string' && storedModel.name.length > 0
        ? storedModel.name
        : fileName.replace(/\.gguf$/i, '')),
    slug,
    source:
      existingModel?.source ??
      storedModel.source ??
      ((existingModel?.huggingFaceRepo ?? storedModel.huggingFaceRepo) ? 'huggingface' : 'local-file'),
    localPath: filePath,
    fileSizeBytes: stats.size,
    parameterSizeBillions:
      existingModel?.parameterSizeBillions ?? storedModel.parameterSizeBillions ?? parsed.parameterSizeBillions,
    quantization: existingModel?.quantization ?? storedModel.quantization ?? parsed.quantization,
  })
}

/**
 * Scan a local llama.cpp models directory and merge discovered GGUF files into
 * the persisted settings model catalog.
 *
 * @param settings - Settings object to reconcile in memory.
 * @returns Updated settings with local GGUF files reflected in `models`.
 */
function synchronizeLocalModels(settings: AppSettings): AppSettings {
  const localServers = settings.servers.filter((server) => server.kind === 'llama.cpp')
  if (localServers.length === 0) {
    return settings
  }

  const nonLocalModels = settings.models.filter((model) =>
    !localServers.some((server) => server.id === model.serverId),
  )
  const nextLocalModels: ModelPreset[] = []

  localServers.forEach((server) => {
    const existingModels = settings.models.filter((model) => model.serverId === server.id)
    const byLocalPath = new Map(
      existingModels
        .filter((model): model is ModelPreset & { localPath: string } => typeof model.localPath === 'string' && model.localPath.length > 0)
        .map((model) => [model.localPath, model] as const),
    )
    const bySlug = new Map(existingModels.map((model) => [model.slug, model] as const))
    const files = collectLocalModelFiles(ensureLocalModelsDirectory(server))
    files.forEach((filePath) => {
      const existingModel = byLocalPath.get(filePath) ?? bySlug.get(buildLocalModelSlug(server, filePath))
      nextLocalModels.push(buildLocalModelPreset(server, filePath, existingModel))
    })
  })

  return {
    ...settings,
    models: [...nonLocalModels, ...nextLocalModels],
    activeModelSlug:
      settings.activeServerId && settings.servers.some((server) => server.id === settings.activeServerId && server.kind === 'llama.cpp')
        ? (
          nextLocalModels.some((model) => model.serverId === settings.activeServerId && model.slug === settings.activeModelSlug)
            ? settings.activeModelSlug
            : (nextLocalModels.find((model) => model.serverId === settings.activeServerId)?.slug ?? null)
        )
        : settings.activeModelSlug,
  }
}

/**
 * Determine whether a model preset belongs to the managed local llama.cpp flow.
 *
 * @param model - Model preset to inspect.
 * @returns True when the preset should use local runtime defaults.
 */
function isLocalModelPreset(model: ModelPreset): boolean {
  return model.serverId === LOCAL_LLAMACPP_SERVER_ID || typeof model.localPath === 'string'
}

/**
 * Build fallback runtime parameters for a model when the server does not
 * report explicit defaults.
 *
 * @param model - Base model preset.
 * @returns Model preset with concrete runtime defaults filled in.
 */
function applyDefaultModelProfile(model: ModelPreset): ModelPreset {
  if (isLocalModelPreset(model)) {
    return applyLocalModelDefaults(model)
  }

  const fallbackMaxOutputTokens =
    typeof model.contextWindowTokens === 'number' && model.contextWindowTokens > 0
      ? Math.max(1, Math.min(512, Math.floor(model.contextWindowTokens / 4)))
      : 512

  return {
    ...model,
    temperature:
      typeof model.temperature === 'number' && Number.isFinite(model.temperature) && model.temperature >= 0
        ? model.temperature
        : 0.7,
    topP:
      typeof model.topP === 'number' && Number.isFinite(model.topP) && model.topP >= 0 && model.topP <= 1
        ? model.topP
        : 1,
    maxOutputTokens:
      typeof model.maxOutputTokens === 'number' && Number.isFinite(model.maxOutputTokens) && model.maxOutputTokens > 0
        ? Math.floor(model.maxOutputTokens)
        : fallbackMaxOutputTokens,
    presencePenalty:
      typeof model.presencePenalty === 'number' &&
      Number.isFinite(model.presencePenalty) &&
      model.presencePenalty >= -2 &&
      model.presencePenalty <= 2
        ? model.presencePenalty
        : 0,
    frequencyPenalty:
      typeof model.frequencyPenalty === 'number' &&
      Number.isFinite(model.frequencyPenalty) &&
      model.frequencyPenalty >= -2 &&
      model.frequencyPenalty <= 2
        ? model.frequencyPenalty
        : 0,
  }
}

/**
 * Merge a stored model profile override into a model preset.
 *
 * @param model - Base model preset.
 * @returns Model preset with any saved override fields applied.
 */
function applyStoredModelProfile(model: ModelPreset): ModelPreset {
  const stored = loadModelProfile(model.serverId, model.slug)
  if (!stored) {
    return applyDefaultModelProfile(model)
  }

  return applyDefaultModelProfile({
    ...model,
    contextWindowTokens:
      typeof stored.contextWindowTokens === 'number' && stored.contextWindowTokens > 0
        ? stored.contextWindowTokens
        : model.contextWindowTokens,
    temperature:
      typeof stored.temperature === 'number' && Number.isFinite(stored.temperature) && stored.temperature >= 0
        ? stored.temperature
        : model.temperature,
    topP:
      typeof stored.topP === 'number' && Number.isFinite(stored.topP) && stored.topP >= 0 && stored.topP <= 1
        ? stored.topP
        : model.topP,
    topK:
      typeof stored.topK === 'number' && Number.isFinite(stored.topK) && stored.topK >= 0
        ? Math.floor(stored.topK)
        : model.topK,
    repeatPenalty:
      typeof stored.repeatPenalty === 'number' && Number.isFinite(stored.repeatPenalty) && stored.repeatPenalty >= 0
        ? Number(stored.repeatPenalty.toFixed(2))
        : model.repeatPenalty,
    seed:
      typeof stored.seed === 'number' && Number.isFinite(stored.seed)
        ? Math.floor(stored.seed)
        : model.seed,
    maxOutputTokens:
      typeof stored.maxOutputTokens === 'number' && Number.isFinite(stored.maxOutputTokens) && stored.maxOutputTokens > 0
        ? Math.floor(stored.maxOutputTokens)
        : model.maxOutputTokens,
    presencePenalty:
      typeof stored.presencePenalty === 'number' &&
      Number.isFinite(stored.presencePenalty) &&
      stored.presencePenalty >= -2 &&
      stored.presencePenalty <= 2
        ? stored.presencePenalty
        : model.presencePenalty,
    frequencyPenalty:
      typeof stored.frequencyPenalty === 'number' &&
      Number.isFinite(stored.frequencyPenalty) &&
      stored.frequencyPenalty >= -2 &&
      stored.frequencyPenalty <= 2
        ? stored.frequencyPenalty
        : model.frequencyPenalty,
    gpuLayers:
      typeof stored.gpuLayers === 'number' && Number.isFinite(stored.gpuLayers) && stored.gpuLayers >= 0
        ? Math.floor(stored.gpuLayers)
        : model.gpuLayers,
    threads:
      typeof stored.threads === 'number' && Number.isFinite(stored.threads) && stored.threads > 0
        ? Math.floor(stored.threads)
        : model.threads,
    batchSize:
      typeof stored.batchSize === 'number' && Number.isFinite(stored.batchSize) && stored.batchSize > 0
        ? Math.floor(stored.batchSize)
        : model.batchSize,
    microBatchSize:
      typeof stored.microBatchSize === 'number' && Number.isFinite(stored.microBatchSize) && stored.microBatchSize > 0
        ? Math.floor(stored.microBatchSize)
        : model.microBatchSize,
    flashAttention:
      typeof stored.flashAttention === 'boolean'
        ? stored.flashAttention
        : model.flashAttention,
    source: stored.source ?? model.source,
    localPath:
      typeof stored.localPath === 'string' && stored.localPath.length > 0
        ? stored.localPath
        : model.localPath,
    huggingFaceRepo:
      typeof stored.huggingFaceRepo === 'string' && stored.huggingFaceRepo.length > 0
        ? stored.huggingFaceRepo
        : model.huggingFaceRepo,
    huggingFaceFile:
      typeof stored.huggingFaceFile === 'string' && stored.huggingFaceFile.length > 0
        ? stored.huggingFaceFile
        : model.huggingFaceFile,
    fileSizeBytes:
      typeof stored.fileSizeBytes === 'number' && Number.isFinite(stored.fileSizeBytes) && stored.fileSizeBytes > 0
        ? stored.fileSizeBytes
        : model.fileSizeBytes,
    parameterSizeBillions:
      typeof stored.parameterSizeBillions === 'number' &&
      Number.isFinite(stored.parameterSizeBillions) &&
      stored.parameterSizeBillions > 0
        ? stored.parameterSizeBillions
        : model.parameterSizeBillions,
    quantization:
      typeof stored.quantization === 'string' && stored.quantization.length > 0
        ? stored.quantization
        : model.quantization,
  })
}

/**
 * Persist a model preset snapshot to the dedicated per-model JSON store.
 *
 * @param model - Model preset to persist.
 */
function saveModelProfile(model: ModelPreset): void {
  const dir = ensureModelProfilesPath()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(
    modelProfilePath(model.serverId, model.slug),
    JSON.stringify(model, null, 2),
    'utf-8',
  )
}

/**
 * Validate persisted chat text size values loaded from disk.
 *
 * @param value - Unknown persisted value.
 * @returns True when the value is a supported chat text size preset.
 */
function isChatTextSize(value: unknown): value is ChatTextSize {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'extra-large'
}

/**
 * Generate a lightweight unique identifier.
 *
 * @returns Timestamp-plus-random ID string.
 */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/**
 * Append an AI debug event to the rolling in-memory log and broadcast it.
 *
 * @param winWebContents - WebContents that should receive the event.
 * @param direction - High-level category for the event.
 * @param label - Short event label.
 * @param payload - Structured payload to record.
 */
function recordAiDebugEntry(
  winWebContents: Electron.WebContents,
  direction: AiDebugEntry['direction'],
  label: string,
  payload: unknown,
): void {
  const entry: AiDebugEntry = {
    id: uid(),
    timestamp: Date.now(),
    direction,
    label,
    payload,
  }

  aiDebugLog.push(entry)
  if (aiDebugLog.length > MAX_AI_DEBUG_ENTRIES) {
    aiDebugLog.splice(0, aiDebugLog.length - MAX_AI_DEBUG_ENTRIES)
  }

  if (!winWebContents.isDestroyed()) {
    winWebContents.send('ai:debug:entry', entry)
  }
}

/**
 * Test whether a value is a plain object.
 *
 * @param value - Unknown input candidate.
 * @returns True when the value can be treated as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize a raw message loaded from disk into a safe Message shape.
 *
 * @param raw - Parsed JSON candidate.
 * @param fallbackTimestamp - Timestamp to use when one is missing.
 * @returns Normalized message.
 */
function normalizeMessage(raw: PartialMessageRecord, fallbackTimestamp: number) {
  const timestamp = isFiniteNumber(raw.timestamp) ? raw.timestamp : fallbackTimestamp
  const role = raw.role === 'assistant' || raw.role === 'system' || raw.role === 'user'
    ? raw.role
    : 'user'

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : uid(),
    role,
    characterId: typeof raw.characterId === 'string' && raw.characterId.length > 0
      ? raw.characterId
      : undefined,
    characterName: typeof raw.characterName === 'string' && raw.characterName.trim().length > 0
      ? raw.characterName.trim()
      : undefined,
    content: typeof raw.content === 'string' ? raw.content : '',
    timestamp,
  }
}

/**
 * Normalize a raw session loaded from disk into a safe Session shape.
 *
 * @param raw - Parsed JSON candidate.
 * @param fallbackTimestamp - Timestamp to use when metadata is missing.
 * @returns Normalized session.
 */
function normalizeSession(raw: PartialSessionRecord, fallbackTimestamp: number): Session {
  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : fallbackTimestamp
  const updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt
  const disabledCharacterIds = Array.isArray(raw.disabledCharacterIds)
    ? raw.disabledCharacterIds
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    : []
  const messages = Array.isArray(raw.messages)
    ? raw.messages
      .filter(isRecord)
      .map((message, index) =>
        normalizeMessage(message as PartialMessageRecord, createdAt + index),
      )
    : []

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : uid(),
    title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim() : 'New Chat',
    sceneSetup: typeof raw.sceneSetup === 'string' ? raw.sceneSetup.trim() : '',
    openingNotes: typeof raw.openingNotes === 'string' ? raw.openingNotes.trim() : '',
    continuitySourceSessionId:
      typeof raw.continuitySourceSessionId === 'string' && raw.continuitySourceSessionId.trim().length > 0
        ? raw.continuitySourceSessionId.trim()
        : undefined,
    continuitySummary: typeof raw.continuitySummary === 'string' ? raw.continuitySummary.trim() : '',
    disabledCharacterIds,
    messages,
    rollingSummary: typeof raw.rollingSummary === 'string' ? raw.rollingSummary.trim() : '',
    summarizedMessageCount: isFiniteNumber(raw.summarizedMessageCount)
      ? Math.max(0, Math.floor(raw.summarizedMessageCount))
      : 0,
    createdAt,
    updatedAt,
  }
}

/**
 * Normalize a lightweight session-to-file index record.
 *
 * @param raw - Parsed JSON candidate.
 * @returns Normalized file reference, or null when invalid.
 */
function normalizeSessionIndexRecord(raw: PartialSessionIndexRecord): { id: string, fileName: string } | null {
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null
  }

  if (typeof raw.fileName !== 'string' || !raw.fileName.endsWith('.json')) {
    return null
  }

  return {
    id: raw.id,
    fileName: raw.fileName,
  }
}

/**
 * Create a brand-new empty campaign object.
 *
 * @param name - Human-readable campaign name.
 * @returns Newly initialized campaign.
 */
function createEmptyCampaign(name: string): Campaign {
  const now = Date.now()

  return {
    id: uid(),
    name,
    description: '',
    sessions: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Normalize a raw campaign file into the current Campaign shape.
 *
 * @param raw - Parsed JSON candidate.
 * @param fallbackName - Name inferred from the file name when missing.
 * @returns Fully populated campaign.
 */
function normalizeCampaign(raw: unknown, fallbackName: string): Campaign {
  if (!isRecord(raw)) {
    throw new Error('Campaign file must contain a JSON object.')
  }

  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now()
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions
      .filter(isRecord)
      .map((session, index) =>
        normalizeSession(session as PartialSessionRecord, createdAt + index),
      )
    : []

  const updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : uid(),
    name: typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : fallbackName,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    sessions,
    createdAt,
    updatedAt,
  }
}

/**
 * Normalize campaign metadata loaded from campaign.json.
 *
 * @param raw - Parsed JSON candidate.
 * @param fallbackName - Name inferred from the folder when missing.
 * @returns Normalized campaign metadata plus session file references.
 */
function normalizeCampaignRecord(
  raw: unknown,
  fallbackName: string,
): Campaign & { sessions: Array<{ id: string, fileName: string }> } {
  if (!isRecord(raw)) {
    throw new Error('Campaign file must contain a JSON object.')
  }

  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now()
  const updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt
  const sessionRefs = Array.isArray(raw.sessions)
    ? raw.sessions
      .filter(isRecord)
      .map((session) => normalizeSessionIndexRecord(session as PartialSessionIndexRecord))
      .filter((session): session is { id: string, fileName: string } => session !== null)
    : []

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : uid(),
    name: typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : fallbackName,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    sessions: sessionRefs,
    createdAt,
    updatedAt,
  }
}

/**
 * Return the absolute path to the managed campaigns root folder.
 *
 * @returns Full path to the campaigns directory inside userData.
 */
function campaignsRootPath(): string {
  return join(app.getPath('userData'), 'campaigns')
}

/**
 * Ensure the managed campaigns root directory exists.
 *
 * @returns Absolute campaigns root path.
 */
function ensureCampaignsRoot(): string {
  const root = campaignsRootPath()
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }

  return root
}

/**
 * Return the absolute path to a campaign's JSON file inside its folder.
 *
 * @param folderPath - Absolute campaign folder path.
 * @returns Full path to campaign.json.
 */
function campaignFilePath(folderPath: string): string {
  return join(folderPath, 'campaign.json')
}

/**
 * Return the absolute path to a campaign's chat storage folder.
 *
 * @param folderPath - Absolute campaign folder path.
 * @returns Full path to the chats directory.
 */
function campaignChatsPath(folderPath: string): string {
  return join(folderPath, 'chats')
}

/**
 * Return the absolute path to a campaign's character storage folder.
 *
 * @param folderPath - Absolute campaign folder path.
 * @returns Full path to the characters directory.
 */
function campaignCharactersPath(folderPath: string): string {
  return join(folderPath, 'characters')
}

/**
 * Return the absolute path to a character's JSON file.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param folderName - Character folder name.
 * @returns Full path to character.json.
 */
function characterFilePath(folderPath: string, folderName: string): string {
  return join(campaignCharactersPath(folderPath), folderName, 'character.json')
}

/**
 * Build a timestamp-based chat filename.
 *
 * @param timestamp - Session creation timestamp.
 * @returns Timestamp-derived JSON filename.
 */
function buildSessionFileName(timestamp: number): string {
  const date = new Date(timestamp)
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
    String(date.getMilliseconds()).padStart(3, '0'),
  ]

  return `${parts.join('')}.json`
}

/**
 * Pick a unique chat filename within a campaign folder.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param session - Session being persisted.
 * @returns Unique JSON filename for the chat file.
 */
function allocateSessionFileName(folderPath: string, session: Session): string {
  const chatsPath = campaignChatsPath(folderPath)
  const baseName = buildSessionFileName(session.createdAt)
  let candidate = baseName
  let index = 1

  while (existsSync(join(chatsPath, candidate))) {
    candidate = baseName.replace(/\.json$/, `-${index}.json`)
    index += 1
  }

  return candidate
}

/**
 * Convert a campaign name into a filesystem-safe folder slug.
 *
 * @param name - Human-readable campaign name.
 * @returns Sanitized folder name candidate.
 */
function slugifyCampaignFolder(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return slug.length > 0 ? slug : 'New Campaign'
}

/**
 * Convert a character name into a filesystem-safe folder slug.
 *
 * @param name - Human-readable character name.
 * @returns Sanitized folder name candidate.
 */
function slugifyCharacterFolder(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return slug.length > 0 ? slug : 'New Character'
}

/**
 * Pick a unique campaign folder path, appending numeric suffixes when needed.
 *
 * @param baseName - Human-readable campaign name.
 * @returns Absolute path to a unique campaign folder.
 */
function allocateCampaignFolder(baseName: string): string {
  const root = ensureCampaignsRoot()
  const slug = slugifyCampaignFolder(baseName)
  let candidate = join(root, slug)
  let index = 1

  while (existsSync(candidate)) {
    candidate = join(root, `${slug} (${index})`)
    index += 1
  }

  return candidate
}

/**
 * Ensure the character storage root exists for a campaign.
 *
 * @param folderPath - Absolute campaign folder path.
 * @returns Absolute characters root path.
 */
function ensureCharacterRoot(folderPath: string): string {
  const root = campaignCharactersPath(folderPath)
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }

  return root
}

/**
 * Pick a unique character folder name, appending numeric suffixes when needed.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param baseName - Human-readable character name.
 * @returns Unique folder name within the campaign's characters directory.
 */
function allocateCharacterFolderName(folderPath: string, baseName: string): string {
  const root = ensureCharacterRoot(folderPath)
  const slug = slugifyCharacterFolder(baseName)
  let candidate = slug
  let index = 1

  while (existsSync(join(root, candidate))) {
    candidate = `${slug} (${index})`
    index += 1
  }

  return candidate
}

/**
 * Normalize a raw character file loaded from disk into a safe CharacterProfile shape.
 *
 * @param raw - Parsed JSON candidate.
 * @param folderName - Folder name the character was read from.
 * @returns Normalized character profile.
 */
function normalizeCharacter(raw: unknown, folderName: string): CharacterProfile {
  const safeRaw = isRecord(raw) ? raw as PartialCharacterRecord : {}
  const createdAt = isFiniteNumber(safeRaw.createdAt) ? safeRaw.createdAt : Date.now()
  const updatedAt = isFiniteNumber(safeRaw.updatedAt) ? safeRaw.updatedAt : createdAt
  const name = typeof safeRaw.name === 'string' && safeRaw.name.trim().length > 0
    ? safeRaw.name.trim()
    : folderName
  const gender: CharacterProfile['gender'] =
    safeRaw.gender === 'male' || safeRaw.gender === 'female' || safeRaw.gender === 'non-specific'
      ? safeRaw.gender
      : 'non-specific'
  const pronouns: CharacterProfile['pronouns'] =
    safeRaw.pronouns === 'he/him' || safeRaw.pronouns === 'she/her' || safeRaw.pronouns === 'they/them'
      ? safeRaw.pronouns
      : gender === 'male'
        ? 'he/him'
        : gender === 'female'
          ? 'she/her'
          : 'they/them'
  const safeAvatarCrop = isRecord(safeRaw.avatarCrop) ? safeRaw.avatarCrop : {}
  const avatarCrop = {
    x: isFiniteNumber(safeAvatarCrop.x) ? safeAvatarCrop.x : 0,
    y: isFiniteNumber(safeAvatarCrop.y) ? safeAvatarCrop.y : 0,
    scale: isFiniteNumber(safeAvatarCrop.scale) && safeAvatarCrop.scale > 0 ? safeAvatarCrop.scale : 1,
  }

  return {
    id: typeof safeRaw.id === 'string' && safeRaw.id.length > 0 ? safeRaw.id : uid(),
    name,
    folderName: typeof safeRaw.folderName === 'string' && safeRaw.folderName.length > 0
      ? safeRaw.folderName
      : folderName,
    role: typeof safeRaw.role === 'string' ? safeRaw.role : '',
    gender,
    pronouns,
    description: typeof safeRaw.description === 'string' ? safeRaw.description : '',
    personality: typeof safeRaw.personality === 'string' ? safeRaw.personality : '',
    speakingStyle: typeof safeRaw.speakingStyle === 'string' ? safeRaw.speakingStyle : '',
    goals: typeof safeRaw.goals === 'string' ? safeRaw.goals : '',
    avatarImageData: typeof safeRaw.avatarImageData === 'string' && safeRaw.avatarImageData.length > 0
      ? safeRaw.avatarImageData
      : null,
    avatarCrop,
    controlledBy: safeRaw.controlledBy === 'user' || safeRaw.controlledBy === 'ai'
      ? safeRaw.controlledBy
      : 'ai',
    createdAt,
    updatedAt,
  }
}

/**
 * Persist a character profile to its campaign-scoped character folder.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param character - Character profile to save.
 * @returns Saved normalized character profile.
 */
function saveCharacter(folderPath: string, character: CharacterProfile): CharacterProfile {
  const existingCharacters = listStoredCharacters(folderPath).filter((candidate) => candidate.id === character.id)
  const requestedFolderName = character.folderName.trim().length > 0
    ? character.folderName
    : character.name
  const baseFolderName = slugifyCharacterFolder(requestedFolderName)
  const existingFolderPath = join(ensureCharacterRoot(folderPath), baseFolderName)
  const folderName = character.folderName.trim().length > 0 || !existsSync(existingFolderPath)
    ? baseFolderName
    : allocateCharacterFolderName(folderPath, character.name)
  const characterFolderPath = join(ensureCharacterRoot(folderPath), folderName)
  if (!existsSync(characterFolderPath)) {
    mkdirSync(characterFolderPath, { recursive: true })
  }

  const now = Date.now()
    const normalizedCharacter: CharacterProfile = {
      ...character,
      name: character.name.trim().length > 0 ? character.name.trim() : 'New Character',
      folderName,
      role: character.role.trim(),
      gender: character.gender,
      pronouns: character.pronouns,
      description: character.description,
      personality: character.personality,
      speakingStyle: character.speakingStyle,
      avatarImageData: typeof character.avatarImageData === 'string' && character.avatarImageData.length > 0
        ? character.avatarImageData
        : null,
      avatarCrop: {
        x: Number.isFinite(character.avatarCrop.x) ? character.avatarCrop.x : 0,
        y: Number.isFinite(character.avatarCrop.y) ? character.avatarCrop.y : 0,
        scale: Number.isFinite(character.avatarCrop.scale) && character.avatarCrop.scale > 0
          ? character.avatarCrop.scale
          : 1,
      },
    goals: character.goals,
    controlledBy: character.controlledBy,
    updatedAt: now,
  }

  writeFileSync(characterFilePath(folderPath, folderName), JSON.stringify(normalizedCharacter, null, 2), 'utf-8')

  for (const existingCharacter of existingCharacters) {
    if (existingCharacter.folderName === folderName) {
      continue
    }

    const staleFolderPath = join(ensureCharacterRoot(folderPath), existingCharacter.folderName)
    if (existsSync(staleFolderPath)) {
      rmSync(staleFolderPath, { recursive: true, force: true })
    }
  }

  return normalizedCharacter
}

/**
 * Load all stored characters for a campaign.
 *
 * @param folderPath - Absolute campaign folder path.
 * @returns Stored character profiles sorted by last updated.
 */
function listStoredCharacters(folderPath: string): CharacterProfile[] {
  const root = ensureCharacterRoot(folderPath)

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .flatMap((folderName) => {
      const path = characterFilePath(folderPath, folderName)
      if (!existsSync(path)) {
        return []
      }

      try {
        return [normalizeCharacter(JSON.parse(readFileSync(path, 'utf-8')) as unknown, folderName)]
      } catch {
        return []
      }
    })
    .sort((first, second) => second.updatedAt - first.updatedAt)
}

/**
 * Load all stored characters for a campaign while emitting progress updates.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param onProgress - Optional callback receiving character-load progress.
 * @returns Stored character profiles sorted by last updated.
 */
function loadStoredCharactersWithProgress(
  folderPath: string,
  onProgress?: (progress: CampaignLoadProgress) => void,
): CharacterProfile[] {
  const root = ensureCharacterRoot(folderPath)
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const totalCharacters = folders.length
  const loadedCharacters: CharacterProfile[] = []

  const progressPercent = (loadedCount: number): number => {
    if (totalCharacters <= 0) {
      return 98
    }

    return Math.round(84 + (loadedCount / totalCharacters) * 14)
  }

  onProgress?.({
    status: 'loading-characters',
    percent: progressPercent(0),
    message: totalCharacters > 0
      ? `Loading characters 0 of ${totalCharacters}…`
      : 'No stored characters found. Finalizing campaign…',
    sessionsLoaded: 0,
    totalSessions: totalCharacters,
  })

  folders.forEach((folderName, index) => {
    const path = characterFilePath(folderPath, folderName)
    if (existsSync(path)) {
      try {
        loadedCharacters.push(normalizeCharacter(JSON.parse(readFileSync(path, 'utf-8')) as unknown, folderName))
      } catch {
        // Skip invalid character files while continuing the load.
      }
    }

    const loadedCount = index + 1
    onProgress?.({
      status: 'loading-characters',
      percent: progressPercent(loadedCount),
      message: totalCharacters > 0
        ? `Loading characters ${loadedCount} of ${totalCharacters}…`
        : 'No stored characters found. Finalizing campaign…',
      sessionsLoaded: loadedCount,
      totalSessions: totalCharacters,
    })
  })

  return loadedCharacters.sort((first, second) => second.updatedAt - first.updatedAt)
}

/**
 * Create a new stored character for a campaign.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param name - Human-readable character name.
 * @returns Newly created character profile.
 */
function createStoredCharacter(folderPath: string, name: string): CharacterProfile {
  const trimmedName = name.trim().length > 0 ? name.trim() : 'New Character'
  const folderName = allocateCharacterFolderName(folderPath, trimmedName)
  const now = Date.now()
  const character: CharacterProfile = {
    id: uid(),
    name: trimmedName,
    folderName,
    role: '',
    gender: 'non-specific',
    pronouns: 'they/them',
    description: '',
    personality: '',
    speakingStyle: '',
    goals: '',
    avatarImageData: null,
    avatarCrop: { x: 0, y: 0, scale: 1 },
    controlledBy: 'ai',
    createdAt: now,
    updatedAt: now,
  }

  return saveCharacter(folderPath, character)
}

/**
 * Delete one stored character from a campaign.
 *
 * @param folderPath - Absolute campaign folder path.
 * @param characterId - Stable character identifier to remove.
 */
function deleteStoredCharacter(folderPath: string, characterId: string): void {
  const root = ensureCharacterRoot(folderPath)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const targetFolderPath = join(root, entry.name)
    const targetCharacterPath = characterFilePath(folderPath, entry.name)
    if (!existsSync(targetCharacterPath)) {
      continue
    }

    try {
      const storedCharacter = normalizeCharacter(
        JSON.parse(readFileSync(targetCharacterPath, 'utf-8')) as unknown,
        entry.name,
      )
      if (storedCharacter.id === characterId) {
        rmSync(targetFolderPath, { recursive: true, force: true })
      }
    } catch {
      continue
    }
  }
}

/**
 * Persist a campaign file to disk inside its folder.
 *
 * @param folderPath - Absolute path to the target campaign folder.
 * @param campaign - Campaign payload to save.
 */
function saveCampaign(folderPath: string, campaign: Campaign): void {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }
  const chatsPath = campaignChatsPath(folderPath)
  if (!existsSync(chatsPath)) {
    mkdirSync(chatsPath, { recursive: true })
  }

  const existingMetadata = existsSync(campaignFilePath(folderPath))
    ? normalizeCampaignRecord(
      JSON.parse(readFileSync(campaignFilePath(folderPath), 'utf-8')) as PartialCampaignRecord,
      campaign.name,
    )
    : null

  const existingIndex = new Map(
    (existingMetadata?.sessions ?? []).map((session) => [session.id, session.fileName]),
  )

  const nextIndex = campaign.sessions.map((session) => {
    const fileName = existingIndex.get(session.id) ?? allocateSessionFileName(folderPath, session)
    writeFileSync(join(chatsPath, fileName), JSON.stringify(session, null, 2), 'utf-8')
    existingIndex.delete(session.id)

    return {
      id: session.id,
      fileName,
    }
  })

  for (const staleFileName of existingIndex.values()) {
    const stalePath = join(chatsPath, staleFileName)
    if (existsSync(stalePath)) {
      unlinkSync(stalePath)
    }
  }

  const campaignRecord = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    sessions: nextIndex,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  }

  writeFileSync(campaignFilePath(folderPath), JSON.stringify(campaignRecord, null, 2), 'utf-8')
}

/**
 * Load and normalize a campaign file from disk.
 *
 * @param folderPath - Absolute path to a campaign folder.
 * @returns Campaign file handle containing path and parsed content.
 */
function loadCampaignFile(
  folderPath: string,
  onProgress?: (progress: CampaignLoadProgress) => void,
): CampaignFileHandle {
  const fallbackName = basename(folderPath)
  onProgress?.({
    status: 'reading-metadata',
    percent: 6,
    message: 'Reading campaign overview…',
    sessionsLoaded: 0,
    totalSessions: 0,
  })
  const rawText = readFileSync(campaignFilePath(folderPath), 'utf-8')

  let campaign: Campaign
  let characters: CharacterProfile[] | undefined

  try {
    const campaignRecord = normalizeCampaignRecord(JSON.parse(rawText) as unknown, fallbackName)
    const chatsPath = campaignChatsPath(folderPath)
    const totalSessions = campaignRecord.sessions.length
    const progressPercent = (sessionsLoaded: number): number => {
      if (totalSessions <= 0) {
        return 82
      }

      return Math.round(12 + (sessionsLoaded / totalSessions) * 70)
    }

    onProgress?.({
      status: 'loading-chats',
      percent: progressPercent(0),
      message: totalSessions > 0
        ? `Loading chats 0 of ${totalSessions}…`
        : 'No stored chats found. Skipping transcript load…',
      sessionsLoaded: 0,
      totalSessions,
    })

    const sessions = campaignRecord.sessions.flatMap((sessionRef, index) => {
      try {
        const sessionRaw = JSON.parse(
          readFileSync(join(chatsPath, sessionRef.fileName), 'utf-8'),
        ) as unknown
        return [normalizeSession(sessionRaw as PartialSessionRecord, campaignRecord.createdAt + index)]
      } catch {
        return []
      } finally {
        const sessionsLoaded = index + 1
        onProgress?.({
          status: 'loading-chats',
          percent: progressPercent(sessionsLoaded),
          message: totalSessions > 0
            ? `Loading chats ${sessionsLoaded} of ${totalSessions}…`
            : 'No stored chats found. Skipping transcript load…',
          sessionsLoaded,
          totalSessions,
        })
      }
    })

    campaign = {
      ...campaignRecord,
      sessions,
    }
    characters = loadStoredCharactersWithProgress(folderPath, onProgress)
  } catch {
    campaign = normalizeCampaign(JSON.parse(rawText) as unknown, fallbackName)
    characters = loadStoredCharactersWithProgress(folderPath, onProgress)
  }

  onProgress?.({
    status: 'complete',
    percent: 100,
    message: 'Campaign data is ready.',
    sessionsLoaded: characters?.length ?? 0,
    totalSessions: characters?.length ?? 0,
  })

  return { path: folderPath, campaign, characters }
}

/**
 * List all stored campaigns for the launcher.
 *
 * @returns Campaign summaries sorted by most recently updated first.
 */
function listStoredCampaigns(): CampaignSummary[] {
  const root = ensureCampaignsRoot()

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((folderPath) => existsSync(campaignFilePath(folderPath)) && statSync(folderPath).isDirectory())
    .flatMap((folderPath) => {
      try {
        const { campaign } = loadCampaignFile(folderPath)
        return [{
          id: campaign.id,
          name: campaign.name,
          description: campaign.description,
          path: folderPath,
          updatedAt: campaign.updatedAt,
          sessionCount: campaign.sessions.length,
        }]
      } catch {
        return []
      }
    })
    .sort((first, second) => second.updatedAt - first.updatedAt)
}

/**
 * Build the default persisted window state used on first launch.
 *
 * @returns Default bounds and non-maximized state.
 */
function defaultWindowState(): PersistedWindowState {
  return {
    bounds: {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    },
    isMaximized: false,
  }
}

/**
 * Absolute path to the user's persisted window state file.
 *
 * @returns Full path to window-state.json inside userData.
 */
function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * Test whether a value is a finite number.
 *
 * @param value - Unknown candidate value.
 * @returns True when the value can be used as a numeric coordinate or size.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Normalize a raw persisted window state payload loaded from disk.
 *
 * @param raw - Parsed JSON candidate.
 * @returns Safe window state with defaults filled in.
 */
function normalizeWindowState(raw: Partial<PersistedWindowState> | null | undefined): PersistedWindowState {
  const defaults = defaultWindowState()
  const rawBounds = raw?.bounds

  return {
    bounds: {
      x: isFiniteNumber(rawBounds?.x) ? rawBounds.x : undefined,
      y: isFiniteNumber(rawBounds?.y) ? rawBounds.y : undefined,
      width: isFiniteNumber(rawBounds?.width)
        ? Math.max(MIN_WINDOW_WIDTH, Math.round(rawBounds.width))
        : defaults.bounds.width,
      height: isFiniteNumber(rawBounds?.height)
        ? Math.max(MIN_WINDOW_HEIGHT, Math.round(rawBounds.height))
        : defaults.bounds.height,
    },
    isMaximized: raw?.isMaximized === true,
  }
}

/**
 * Load the last persisted window state from disk.
 *
 * @returns Saved window placement and maximize state, or defaults.
 */
function loadWindowState(): PersistedWindowState {
  const path = windowStatePath()
  if (existsSync(path)) {
    try {
      return normalizeWindowState(JSON.parse(readFileSync(path, 'utf-8')) as Partial<PersistedWindowState>)
    } catch {
      // Corrupted — fall through to defaults
    }
  }

  return defaultWindowState()
}

/**
 * Persist window placement and maximize state to disk.
 *
 * @param state - Window placement snapshot to save.
 */
function saveWindowState(state: PersistedWindowState): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Calculate the overlapping area between two rectangles.
 *
 * @param first - First rectangle.
 * @param second - Second rectangle.
 * @returns Visible intersection area in square pixels.
 */
function getIntersectionArea(first: WindowBounds, second: WindowBounds): number {
  const left = Math.max(first.x, second.x)
  const top = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  return width * height
}

/**
 * Ensure restored bounds are visible on at least one current display.
 *
 * @param bounds - Candidate bounds restored from disk.
 * @returns True when enough of the window would remain on-screen.
 */
function isVisibleOnSomeDisplay(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const workArea: WindowBounds = {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
    }

    return getIntersectionArea(bounds, workArea) >= 64 * 64
  })
}

/**
 * Clamp restored bounds to a visible work area and fall back to the primary
 * display when the saved monitor is no longer available.
 *
 * @param state - Persisted window state loaded from disk.
 * @returns BrowserWindow constructor options for safe restoration.
 */
function getWindowPlacement(state: PersistedWindowState): Pick<WindowBounds, 'width' | 'height'> & Partial<Pick<WindowBounds, 'x' | 'y'>> {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const width = Math.min(
    Math.max(state.bounds.width, MIN_WINDOW_WIDTH),
    Math.max(MIN_WINDOW_WIDTH, primaryWorkArea.width),
  )
  const height = Math.min(
    Math.max(state.bounds.height, MIN_WINDOW_HEIGHT),
    Math.max(MIN_WINDOW_HEIGHT, primaryWorkArea.height),
  )

  if (!isFiniteNumber(state.bounds.x) || !isFiniteNumber(state.bounds.y)) {
    return { width, height }
  }

  const candidate: WindowBounds = {
    x: Math.round(state.bounds.x),
    y: Math.round(state.bounds.y),
    width,
    height,
  }

  if (!isVisibleOnSomeDisplay(candidate)) {
    return { width, height }
  }

  return candidate
}

/**
 * Capture the latest restorable bounds and maximize state from a window.
 *
 * @param win - BrowserWindow to serialize.
 * @returns Persistable window state snapshot.
 */
function getPersistedWindowState(win: BrowserWindow): PersistedWindowState {
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds()

  return {
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    isMaximized: win.isMaximized(),
  }
}

/* ── Settings helpers ──────────────────────────────────────────────────── */

/** Absolute path to the user's persisted settings file. */
function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Absolute path to the user's persisted reusable avatar library file. */
function reusableAvatarsPath(): string {
  return join(app.getPath('userData'), 'avatars.json')
}

/** Absolute path to the user's persisted reusable character library file. */
function reusableCharactersPath(): string {
  return join(app.getPath('userData'), 'characters-library.json')
}

/**
 * Normalize a raw reusable avatar record loaded from disk.
 *
 * @param raw - Parsed avatar candidate.
 * @returns Sanitized reusable avatar.
 */
function normalizeReusableAvatar(raw: unknown): ReusableAvatar | null {
  const safeRaw = isRecord(raw) ? raw as PartialReusableAvatarRecord : {}
  if (typeof safeRaw.imageData !== 'string' || safeRaw.imageData.length === 0) {
    return null
  }

  const createdAt = isFiniteNumber(safeRaw.createdAt) ? safeRaw.createdAt : Date.now()
  const updatedAt = isFiniteNumber(safeRaw.updatedAt) ? safeRaw.updatedAt : createdAt
  const safeCrop = isRecord(safeRaw.crop) ? safeRaw.crop : {}

  return {
    id: typeof safeRaw.id === 'string' && safeRaw.id.length > 0 ? safeRaw.id : uid(),
    name: typeof safeRaw.name === 'string' && safeRaw.name.trim().length > 0 ? safeRaw.name.trim() : 'Saved Avatar',
    imageData: safeRaw.imageData,
    crop: {
      x: isFiniteNumber(safeCrop.x) ? safeCrop.x : 0,
      y: isFiniteNumber(safeCrop.y) ? safeCrop.y : 0,
      scale: isFiniteNumber(safeCrop.scale) && safeCrop.scale > 0 ? safeCrop.scale : 1,
    },
    createdAt,
    updatedAt,
  }
}

/**
 * Load the persisted reusable avatar library from disk.
 *
 * @returns Saved reusable avatars sorted by most recently updated.
 */
function loadReusableAvatars(): ReusableAvatar[] {
  const path = reusableAvatarsPath()
  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(raw)) {
      return []
    }

    return raw
      .map((entry) => normalizeReusableAvatar(entry))
      .filter((entry): entry is ReusableAvatar => entry !== null)
      .sort((first, second) => second.updatedAt - first.updatedAt)
  } catch {
    return []
  }
}

/**
 * Persist the full reusable avatar library to disk.
 *
 * @param avatars - Avatar records to write.
 */
function saveReusableAvatars(avatars: ReusableAvatar[]): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(reusableAvatarsPath(), JSON.stringify(avatars, null, 2), 'utf-8')
}

/**
 * Create or update one reusable avatar in the global library.
 *
 * @param avatar - Avatar to persist.
 * @returns Saved normalized avatar.
 */
function saveReusableAvatar(avatar: ReusableAvatar): ReusableAvatar {
  const existing = loadReusableAvatars()
  const now = Date.now()
  const normalized = normalizeReusableAvatar({
    ...avatar,
    id: typeof avatar.id === 'string' && avatar.id.length > 0 ? avatar.id : uid(),
    name: avatar.name,
    imageData: avatar.imageData,
    crop: avatar.crop,
    createdAt: existing.find((entry) => entry.id === avatar.id)?.createdAt ?? avatar.createdAt ?? now,
    updatedAt: now,
  })

  if (!normalized) {
    throw new Error('Reusable avatars must include image data.')
  }

  const nextAvatars = [
    normalized,
    ...existing.filter((entry) => entry.id !== normalized.id),
  ].sort((first, second) => second.updatedAt - first.updatedAt)

  saveReusableAvatars(nextAvatars)
  return normalized
}

/**
 * Delete one reusable avatar from the global library.
 *
 * @param avatarId - Stable avatar identifier to remove.
 */
function deleteReusableAvatar(avatarId: string): void {
  saveReusableAvatars(loadReusableAvatars().filter((avatar) => avatar.id !== avatarId))
}

/**
 * Normalize a raw reusable character record loaded from disk.
 *
 * @param raw - Parsed character candidate.
 * @returns Sanitized reusable character.
 */
function normalizeReusableCharacter(raw: unknown): ReusableCharacter {
  const safeRaw = isRecord(raw) ? raw as PartialReusableCharacterRecord : {}
  const createdAt = isFiniteNumber(safeRaw.createdAt) ? safeRaw.createdAt : Date.now()
  const updatedAt = isFiniteNumber(safeRaw.updatedAt) ? safeRaw.updatedAt : createdAt
  const gender: ReusableCharacter['gender'] =
    safeRaw.gender === 'male' || safeRaw.gender === 'female' || safeRaw.gender === 'non-specific'
      ? safeRaw.gender
      : 'non-specific'
  const pronouns: ReusableCharacter['pronouns'] =
    safeRaw.pronouns === 'he/him' || safeRaw.pronouns === 'she/her' || safeRaw.pronouns === 'they/them'
      ? safeRaw.pronouns
      : gender === 'male'
        ? 'he/him'
        : gender === 'female'
          ? 'she/her'
          : 'they/them'
  const safeAvatarCrop = isRecord(safeRaw.avatarCrop) ? safeRaw.avatarCrop : {}

  return {
    id: typeof safeRaw.id === 'string' && safeRaw.id.length > 0 ? safeRaw.id : uid(),
    name: typeof safeRaw.name === 'string' && safeRaw.name.trim().length > 0 ? safeRaw.name.trim() : 'Saved Character',
    role: typeof safeRaw.role === 'string' ? safeRaw.role : '',
    gender,
    pronouns,
    description: typeof safeRaw.description === 'string' ? safeRaw.description : '',
    personality: typeof safeRaw.personality === 'string' ? safeRaw.personality : '',
    speakingStyle: typeof safeRaw.speakingStyle === 'string' ? safeRaw.speakingStyle : '',
    goals: typeof safeRaw.goals === 'string' ? safeRaw.goals : '',
    avatarImageData: typeof safeRaw.avatarImageData === 'string' && safeRaw.avatarImageData.length > 0
      ? safeRaw.avatarImageData
      : null,
    avatarCrop: {
      x: isFiniteNumber(safeAvatarCrop.x) ? safeAvatarCrop.x : 0,
      y: isFiniteNumber(safeAvatarCrop.y) ? safeAvatarCrop.y : 0,
      scale: isFiniteNumber(safeAvatarCrop.scale) && safeAvatarCrop.scale > 0 ? safeAvatarCrop.scale : 1,
    },
    controlledBy: safeRaw.controlledBy === 'user' || safeRaw.controlledBy === 'ai'
      ? safeRaw.controlledBy
      : 'ai',
    createdAt,
    updatedAt,
  }
}

/**
 * Load the persisted reusable character library from disk.
 *
 * @returns Saved reusable characters sorted alphabetically.
 */
function loadReusableCharacters(): ReusableCharacter[] {
  const path = reusableCharactersPath()
  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(raw)) {
      return []
    }

    return raw
      .map((entry) => normalizeReusableCharacter(entry))
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))
  } catch {
    return []
  }
}

/**
 * Persist the full reusable character library to disk.
 *
 * @param characters - Character records to write.
 */
function saveReusableCharacters(characters: ReusableCharacter[]): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(reusableCharactersPath(), JSON.stringify(characters, null, 2), 'utf-8')
}

/**
 * Create or update one reusable character in the global library.
 *
 * @param character - Character to persist.
 * @returns Saved normalized character.
 */
function saveReusableCharacter(character: ReusableCharacter): ReusableCharacter {
  const existing = loadReusableCharacters()
  const now = Date.now()
  const normalized = normalizeReusableCharacter({
    ...character,
    id: typeof character.id === 'string' && character.id.length > 0 ? character.id : uid(),
    createdAt: existing.find((entry) => entry.id === character.id)?.createdAt ?? character.createdAt ?? now,
    updatedAt: now,
  })
  const nextCharacters = [
    normalized,
    ...existing.filter((entry) => entry.id !== normalized.id),
  ].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))

  saveReusableCharacters(nextCharacters)
  return normalized
}

/**
 * Delete one reusable character from the global library.
 *
 * @param characterId - Stable character identifier to remove.
 */
function deleteReusableCharacter(characterId: string): void {
  saveReusableCharacters(loadReusableCharacters().filter((character) => character.id !== characterId))
}

/**
 * Load settings from disk, falling back to built-in defaults on first run
 * or if the file is corrupted.
 *
 * @param options - Optional behavior flags controlling hydration work.
 * @returns Fully normalized app settings.
 */
function loadSettings(options?: { syncLocalModels?: boolean }): AppSettings {
  const shouldSyncLocalModels = options?.syncLocalModels ?? true
  const path = settingsPath()
  if (existsSync(path)) {
    try {
      const normalized = normalizeSettings(JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>)
      const hydrated = {
        ...normalized,
        models: normalized.models.map((model) => applyStoredModelProfile(model)),
      }
      return shouldSyncLocalModels ? synchronizeLocalModels(hydrated) : hydrated
    } catch {
      // Corrupted — fall through to defaults
    }
  }
  const normalized = normalizeSettings(undefined)
  const hydrated = {
    ...normalized,
    models: normalized.models.map((model) => applyStoredModelProfile(model)),
  }
  return shouldSyncLocalModels ? synchronizeLocalModels(hydrated) : hydrated
}

/**
 * Persist settings to disk.
 * @param settings - The full settings object to save.
 */
function saveSettings(settings: AppSettings): void {
  const normalizedSettings = synchronizeLocalModels(normalizeSettings(settings))
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(normalizedSettings, null, 2), 'utf-8')
  normalizedSettings.models.forEach((model) => {
    saveModelProfile(model)
  })
}

/**
 * Classify a GPU vendor from a best-effort device name.
 *
 * @param name - GPU/device name to inspect.
 * @returns Vendor bucket used for fit guidance and backend suggestions.
 */
function classifyGpuVendor(name: string): HardwareGpuInfo['vendor'] {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('nvidia') || normalized.includes('geforce') || normalized.includes('quadro')) {
    return 'nvidia'
  }
  if (normalized.includes('amd') || normalized.includes('radeon')) {
    return 'amd'
  }
  if (normalized.includes('intel') || normalized.includes('arc')) {
    return 'intel'
  }

  return 'unknown'
}

/**
 * Detect the host hardware inventory used for local llama.cpp guidance.
 *
 * @returns Hardware summary cached for subsequent requests.
 */
/**
 * Query NVIDIA GPUs using nvidia-smi for accurate VRAM detection.
 * Returns array of GPU entries if nvidia-smi is available, empty array otherwise.
 *
 * @returns Array of detected NVIDIA GPU entries with correct VRAM.
 */
function detectNvidiaGpusViaSmi(): HardwareGpuInfo[] {
  const result = spawnSync('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader',
  ], {
    encoding: 'utf-8',
    windowsHide: true,
  })

  if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.trim().length === 0) {
    return []
  }

  const gpuEntries: HardwareGpuInfo[] = []
  const lines = result.stdout.trim().split('\n')

  lines.forEach((line) => {
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length < 1) return

    const name = parts[0] ?? ''
    const memoryMibStr = parts[1] ?? ''
    const driverVersion = parts[2] ?? ''

    if (!name) return

    // Parse memory: "24564 MiB" -> bytes (24564 * 1024 * 1024)
    const memoryMatch = memoryMibStr.match(/^(\d+)/)
    const memoryMib = memoryMatch ? Number(memoryMatch[1]) : null
    const vramBytes = typeof memoryMib === 'number' && memoryMib > 0
      ? memoryMib * 1024 * 1024
      : null

    gpuEntries.push({
      name,
      vendor: 'nvidia',
      vramBytes,
      driverVersion: driverVersion && driverVersion.length > 0 ? driverVersion : null,
    })
  })

  return gpuEntries
}

function detectHardwareInfo(): HardwareInfo {
  if (cachedHardwareInfo) {
    return cachedHardwareInfo
  }

  let gpuEntries: HardwareGpuInfo[] = []

  // Try nvidia-smi first for NVIDIA GPUs (more accurate on Windows)
  if (process.platform === 'win32') {
    gpuEntries = detectNvidiaGpusViaSmi()
  }

  // Fall back to Win32_VideoController if nvidia-smi didn't find anything
  if (process.platform === 'win32' && gpuEntries.length === 0) {
    const command = [
      '$devices = Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion',
      'if ($devices) { $devices | ConvertTo-Json -Compress } else { "[]" }',
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf-8',
      windowsHide: true,
    })

    if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim().length > 0) {
      try {
        const parsed = JSON.parse(result.stdout.trim()) as
          | Array<{ Name?: string, AdapterRAM?: number | string, DriverVersion?: string }>
          | { Name?: string, AdapterRAM?: number | string, DriverVersion?: string }
        const entries = Array.isArray(parsed) ? parsed : [parsed]
        entries.forEach((entry) => {
          if (typeof entry.Name !== 'string' || entry.Name.trim().length === 0) {
            return
          }

          const rawRam = typeof entry.AdapterRAM === 'string'
            ? Number(entry.AdapterRAM)
            : entry.AdapterRAM
          gpuEntries.push({
            name: entry.Name.trim(),
            vendor: classifyGpuVendor(entry.Name),
            vramBytes:
              typeof rawRam === 'number' && Number.isFinite(rawRam) && rawRam > 0
                ? rawRam
                : null,
            driverVersion: typeof entry.DriverVersion === 'string' && entry.DriverVersion.trim().length > 0
              ? entry.DriverVersion.trim()
              : null,
          })
        })
      } catch {
        // Ignore parse errors and fall back to CPU-only detection.
      }
    }
  }

  const recommendedBackend: HardwareInfo['recommendedBackend'] =
    process.platform === 'darwin'
      ? 'metal'
      : gpuEntries.some((gpu) => gpu.vendor === 'nvidia')
        ? 'cuda'
        : gpuEntries.some((gpu) => gpu.vendor === 'amd' || gpu.vendor === 'intel')
          ? 'vulkan'
          : 'cpu'

  cachedHardwareInfo = {
    detectedAt: Date.now(),
    platform: process.platform,
    cpuModel: cpus()[0]?.model ?? 'Unknown CPU',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    gpus: gpuEntries,
    recommendedBackend,
  }

  return cachedHardwareInfo
}

/**
 * Detect whether a server profile should be treated as the managed local
 * llama.cpp runtime.
 *
 * @param server - Server profile to inspect.
 * @returns True when the server is the local runtime provider.
 */
function isLocalLlamaServer(server: ServerProfile): boolean {
  return server.kind === 'llama.cpp'
}

/**
 * Detect the best llama.cpp backend for the current machine and return
 * the asset lookup key, display name, and estimated download size.
 *
 * On macOS, Metal is always used; the arch (arm64/x64) determines the asset.
 * On Windows/Linux, the recommendedBackend from hardware detection is used.
 *
 * @returns Object with asset key, display name, and size in MB.
 */
function detectLlamaBinaryBackend(): { key: string; display: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'; sizeMb: number } {
  // Ensure hardware info is detected first so we have accurate GPU detection
  const hardwareInfo = cachedHardwareInfo ?? detectHardwareInfo()
  const backend = hardwareInfo.recommendedBackend ?? 'cpu'
  const platform = process.platform

  console.log(`[LLAMA] Backend detection: platform=${platform}, recommendedBackend=${backend}, gpus=${hardwareInfo.gpus.length}`)
  hardwareInfo.gpus.forEach((gpu, i) => {
    console.log(`[LLAMA]   GPU ${i}: ${gpu.name} (${gpu.vendor}) - ${gpu.vramBytes ? (gpu.vramBytes / 1024 / 1024 / 1024).toFixed(1) : 'unknown'} GB`)
  })

  // On macOS, Metal is always the backend regardless of recommendedBackend value.
  // Differentiate Apple Silicon (arm64) from Intel (x64) for the asset filename.
  let key: string
  let display: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  if (platform === 'darwin') {
    const arch = process.arch === 'x64' ? 'x64' : 'arm64'
    key = `darwin-metal-${arch}`
    display = 'Metal'
  } else {
    let resolvedBackend = backend
    // No Linux CUDA build for this release — fall back to Vulkan
    if (platform === 'linux' && backend === 'cuda') {
      resolvedBackend = 'vulkan'
    }
    key = `${platform}-${resolvedBackend}`
    display = BACKEND_DISPLAY[resolvedBackend] ?? 'CPU'
  }

  const asset = LLAMA_CPP_ASSETS[key] ?? LLAMA_CPP_ASSETS[`${platform}-cpu`]
  console.log(`[LLAMA] Resolved to key=${key}, display=${display}, sizeMb=${asset?.sizeMb ?? 0}`)
  return { key, display, sizeMb: asset?.sizeMb ?? 0 }
}

/**
 * Download a file from a URL with progress tracking.
 *
 * @param url - URL to download from.
 * @param destPath - Where to save the file.
 * @param onProgress - Progress callback (percent: 0-100 or null).
 * @returns Promise that resolves when download completes.
 */
async function downloadFile(url: string, destPath: string, onProgress: (percent: number | null) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const follow = (redirectUrl: string): void => {
      httpsGet(redirectUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading from ${redirectUrl}`))
          return
        }
        const total = res.headers['content-length'] ? parseInt(res.headers['content-length'], 10) : null
        let downloaded = 0
        const out = createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          const pct = total ? Math.round((downloaded / total) * 100) : null
          onProgress(pct)
        })
        res.pipe(out)
        out.on('finish', resolve)
        out.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

/**
 * Download and extract the llama-server binary for the current platform.
 *
 * Broadcasts BinaryInstallProgress updates throughout. On success, returns the
 * absolute path to the installed executable. On failure, broadcasts an error
 * status and re-throws with a human-readable message.
 *
 * @returns Resolved absolute path to the installed llama-server executable.
 */
async function installLlamaBinary(): Promise<string> {
  const { key, display } = detectLlamaBinaryBackend()
  const asset = LLAMA_CPP_ASSETS[key] ?? LLAMA_CPP_ASSETS[`${process.platform}-cpu`]
  if (!asset) {
    throw new Error(`No llama.cpp asset available for platform '${process.platform}'.`)
  }

  // Destination: next to exe in packaged builds; next to app root in dev mode
  const destination = app.isPackaged
    ? join(dirname(app.getPath('exe')), 'llama.cpp')
    : join(app.getAppPath(), 'llama.cpp')

  const fileName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const destBinary = join(destination, fileName)

  const tempDir = app.getPath('temp')
  const archivePath = join(tempDir, `llama-cpp-${LLAMA_CPP_RELEASE}.${asset.ext}`)
  const extractDir = join(tempDir, `llama-cpp-extract-${LLAMA_CPP_RELEASE}`)

  /** Remove temp archive and extract dir, swallowing errors. */
  const cleanupTemp = (): void => {
    try { if (existsSync(archivePath)) rmSync(archivePath) } catch { /* ignore */ }
    try { if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  /** Broadcast a BinaryInstallProgress update to all renderer windows. */
  const broadcast = (status: BinaryInstallProgress['status'], percent: number | null, message: string): void => {
    const progress: BinaryInstallProgress = {
      status,
      percent,
      message,
      backend: status === 'detecting' ? null : display,
    }
    broadcastToAllWindows('llama:binary:install:progress', progress)
  }

  try {
    // Phase 0: detecting
    broadcast('detecting', null, 'Detecting platform and backend…')

    const url = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_RELEASE}/${asset.fileName}`

    // Ensure destination directory exists
    mkdirSync(destination, { recursive: true })

    // Phase 1: download main binary
    broadcast('downloading', 0, `Downloading llama-server (${display})…`)
    await downloadFile(url, archivePath, (pct) => {
      broadcast('downloading', pct, `Downloading llama-server (${display})…${pct != null ? `  ${pct}%` : ''}`)
    })

    // Phase 1b: download CUDA runtime DLLs if needed
    if (asset.cudartFile && process.platform === 'win32') {
      const cudartUrl = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_RELEASE}/${asset.cudartFile}`
      const cudartArchivePath = join(tempDir, `cudart-${LLAMA_CPP_RELEASE}.zip`)
      broadcast('downloading', 0, `Downloading CUDA runtime libraries…`)
      try {
        await downloadFile(cudartUrl, cudartArchivePath, (pct) => {
          broadcast('downloading', pct, `Downloading CUDA runtime libraries…${pct != null ? `  ${pct}%` : ''}`)
        })
        // Extract CUDA DLLs to the same extract directory
        const cudartExtractResult = spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${cudartArchivePath}' -DestinationPath '${extractDir}' -Force`,
        ], { encoding: 'utf-8', windowsHide: true, timeout: 120_000 })
        if (cudartExtractResult.status !== 0) {
          console.warn('CUDA runtime extraction warning (non-fatal):', cudartExtractResult.stderr)
        }
        try { if (existsSync(cudartArchivePath)) rmSync(cudartArchivePath) } catch { /* ignore */ }
      } catch (err) {
        console.warn('CUDA runtime download warning (non-fatal):', err instanceof Error ? err.message : String(err))
      }
    }

    // Phase 2: extract
    broadcast('extracting', null, 'Extracting…')
    mkdirSync(extractDir, { recursive: true })

    const extractResult = process.platform === 'win32'
      ? spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
        ], { encoding: 'utf-8', windowsHide: true, timeout: 120_000 })
      : spawnSync('tar', ['-xzf', archivePath, '-C', extractDir],
          { encoding: 'utf-8', timeout: 120_000 })

    if (extractResult.status !== 0) {
      const stderr = typeof extractResult.stderr === 'string' ? extractResult.stderr.trim() : ''
      throw new Error(`Extraction failed: ${stderr || 'unknown error'}`)
    }

    // Locate source root — zips may contain a single named subdirectory
    let sourceRoot = extractDir
    const topLevel = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    if (topLevel.length === 1) {
      sourceRoot = join(extractDir, topLevel[0].name)
    }

    // Copy binary
    const sourceBinary = join(sourceRoot, fileName)
    if (!existsSync(sourceBinary)) {
      throw new Error(`llama-server binary not found in extracted archive at '${sourceBinary}'.`)
    }
    copyFileSync(sourceBinary, destBinary)

    if (process.platform === 'win32') {
      // Copy all DLLs from source root (required runtime dependencies)
      readdirSync(sourceRoot)
        .filter((f) => f.toLowerCase().endsWith('.dll'))
        .forEach((dll) => copyFileSync(join(sourceRoot, dll), join(destination, dll)))
    } else {
      // Ensure the binary is executable on macOS and Linux
      chmodSync(destBinary, 0o755)
    }

    // Cleanup and finish
    cleanupTemp()
    broadcast('complete', null, 'llama-server installed successfully.')
    return destBinary

  } catch (err) {
    cleanupTemp()
    const message = err instanceof Error ? err.message : String(err)
    broadcast('error', null, message)
    throw err
  }
}

/**
 * Find a usable llama-server executable path for a local server profile.
 *
 * @param server - Local server profile that may include an explicit path.
 * @returns Absolute executable path when found, or null otherwise.
 */
function resolveLlamaExecutablePath(server: ServerProfile): string | null {
  const explicitPath = typeof server.executablePath === 'string' && server.executablePath.trim().length > 0
    ? server.executablePath.trim()
    : null
  const fileName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const candidates = [
    explicitPath,
    join(app.getAppPath(), fileName),
    join(app.getAppPath(), 'bin', fileName),
    join(app.getAppPath(), 'llama.cpp', fileName),   // app-root llama.cpp subdir (dev-mode install target)
    join(dirname(app.getPath('exe')), fileName),
    join(dirname(app.getPath('exe')), 'llama.cpp', fileName),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)

  const existingCandidate = candidates.find((candidate) => existsSync(candidate))
  if (existingCandidate) {
    return existingCandidate
  }

  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which'
  const lookup = spawnSync(lookupCommand, [fileName], {
    encoding: 'utf-8',
    windowsHide: true,
  })
  if (lookup.status === 0 && typeof lookup.stdout === 'string') {
    const resolved = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && existsSync(line))

    if (resolved) {
      return resolved
    }
  }

  return null
}

/**
 * Push the latest managed local runtime state into every open renderer.
 */
function broadcastLocalRuntimeStatus(): void {
  broadcastToAllWindows('llama:runtime:status', localRuntimeStatus)
}

/**
 * Push the latest local runtime startup progress into every open renderer.
 */
function broadcastLocalRuntimeLoadProgress(): void {
  broadcastToAllWindows('llama:runtime:load-progress', localRuntimeLoadProgress)
}

/**
 * Update and broadcast the local runtime startup progress.
 *
 * @param nextProgress - Progress payload to publish, or null to clear it.
 */
function setLocalRuntimeLoadProgress(nextProgress: LocalRuntimeLoadProgress | null): void {
  localRuntimeLoadProgress = nextProgress
  broadcastLocalRuntimeLoadProgress()
}

/**
 * Parse a llama.cpp startup log line into a renderer-facing progress update.
 *
 * @param line - Single stderr log line emitted during startup.
 * @returns Structured progress update, or null when the line is not informative.
 */
function parseLocalRuntimeLoadProgress(line: string): LocalRuntimeLoadProgress | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return null
  }

  const lowerLine = trimmedLine.toLowerCase()

  if (lowerLine.includes('loading model') || lowerLine.includes('load_tensors')) {
    const fractionMatch = trimmedLine.match(/(\d+)\s*\/\s*(\d+)/)
    if (fractionMatch) {
      const completed = Number(fractionMatch[1])
      const total = Number(fractionMatch[2])
      if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
        return {
          status: 'loading-model',
          percent: Math.max(0, Math.min(100, Math.round((completed / total) * 100))),
          message: `Loading model tensors (${completed}/${total})`,
        }
      }
    }

    return {
      status: 'loading-model',
      percent: null,
      message: 'Loading model tensors…',
    }
  }

  if (lowerLine.includes('server is listening') || lowerLine.includes('listening at')) {
    return {
      status: 'ready',
      percent: 100,
      message: 'Local runtime is ready.',
    }
  }

  if (lowerLine.includes('exception') || lowerLine.includes('error:') || lowerLine.includes('fatal')) {
    return {
      status: 'error',
      percent: null,
      message: trimmedLine,
    }
  }

  if (lowerLine.includes('main:') || lowerLine.includes('build:') || lowerLine.includes('system info')) {
    return {
      status: 'starting',
      percent: null,
      message: 'Preparing local runtime…',
    }
  }

  return null
}

/**
 * Update and broadcast the managed local runtime status.
 *
 * @param nextStatus - Partial status fields to merge into the current state.
 */
function setLocalRuntimeStatus(nextStatus: Partial<LocalRuntimeStatus>): void {
  localRuntimeStatus = {
    ...localRuntimeStatus,
    ...nextStatus,
  }
  broadcastLocalRuntimeStatus()
}

/**
 * Stop the managed local llama.cpp server if it is running.
 */
function stopLocalRuntime(): void {
  if (localRuntimeProcess && !localRuntimeProcess.killed) {
    localRuntimeProcess.kill()
  }
  localRuntimeProcess = null
  setLocalRuntimeLoadProgress(null)
  setLocalRuntimeStatus({
    state: 'stopped',
    modelSlug: null,
    modelPath: null,
    pid: null,
    lastError: null,
    startedAt: null,
  })
}

/**
 * Poll a local HTTP endpoint until it begins responding or the timeout expires.
 *
 * @param url - URL to test.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 */
async function waitForLocalRuntime(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: string | null = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) {
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(lastError ? `llama.cpp did not start in time (${lastError}).` : 'llama.cpp did not start in time.')
}

/**
 * Start the managed local llama.cpp server for the requested model.
 *
 * @param server - Local server profile that owns the runtime.
 * @param model - Local model preset to load.
 * @returns Updated runtime status after startup completes.
 */
async function startLocalRuntime(server: ServerProfile, model: ModelPreset): Promise<LocalRuntimeStatus> {
  if (!model.localPath) {
    throw new Error('The selected local model does not have a GGUF file path.')
  }

  if (!existsSync(model.localPath)) {
    throw new Error('The selected GGUF file no longer exists on disk.')
  }

  const executablePath = resolveLlamaExecutablePath(server)
  if (!executablePath) {
    throw new Error('Could not find llama-server. Configure its executable path in Settings or add it to PATH.')
  }

  stopLocalRuntime()

  const host = server.host?.trim() || LOCAL_LLAMACPP_DEFAULT_HOST
  const port = typeof server.port === 'number' && Number.isFinite(server.port) && server.port > 0
    ? Math.floor(server.port)
    : LOCAL_LLAMACPP_DEFAULT_PORT
  const runtimeUrl = buildLocalServerBaseUrl({ host, port })
  const args = [
    '--model', model.localPath,
    '--host', host,
    '--port', port.toString(),
    '--ctx-size', (model.contextWindowTokens ?? 8192).toString(),
    '--threads', (model.threads ?? Math.max(1, cpus().length)).toString(),
    '--batch-size', (model.batchSize ?? 512).toString(),
    '--ubatch-size', (model.microBatchSize ?? 128).toString(),
    '--n-gpu-layers', (model.gpuLayers ?? 999).toString(),
  ]

  args.push('--flash-attn', model.flashAttention === false ? 'off' : 'on')

  const child = spawn(executablePath, args, {
    windowsHide: true,
    stdio: 'pipe',
  })
  localRuntimeProcess = child
  setLocalRuntimeLoadProgress({
    status: 'starting',
    percent: null,
    message: 'Starting llama.cpp runtime…',
  })
  setLocalRuntimeStatus({
    state: 'starting',
    serverId: server.id,
    modelSlug: model.slug,
    modelPath: model.localPath,
    pid: child.pid ?? null,
    url: runtimeUrl,
    lastError: null,
    startedAt: null,
  })

  let stderrBuffer = ''
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuffer += text
    text
      .split(/\r?\n/)
      .map((line) => parseLocalRuntimeLoadProgress(line))
      .filter((progress): progress is LocalRuntimeLoadProgress => progress !== null)
      .forEach((progress) => {
        setLocalRuntimeLoadProgress(progress)
      })
    // Broadcast startup logs to renderer in real-time (first 5000 chars)
    if (stderrBuffer.length <= 5000) {
      broadcastToAllWindows('llama:startup-log', text)
    }
    if (stderrBuffer.length > 4000) {
      stderrBuffer = stderrBuffer.slice(stderrBuffer.length - 4000)
    }
  })

  child.on('exit', (code, signal) => {
    if (localRuntimeProcess !== child) {
      return
    }

    const wasStarting = localRuntimeStatus.state === 'starting'
    const lastError = code === 0 && signal === null
      ? null
      : (stderrBuffer.trim() || `llama.cpp exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`)

    localRuntimeProcess = null
    setLocalRuntimeLoadProgress(
      lastError
        ? {
            status: 'error',
            percent: null,
            message: lastError,
          }
        : null,
    )
    setLocalRuntimeStatus({
      state: wasStarting && lastError ? 'error' : 'stopped',
      pid: null,
      startedAt: null,
      lastError,
      modelSlug: wasStarting ? null : localRuntimeStatus.modelSlug,
      modelPath: wasStarting ? null : localRuntimeStatus.modelPath,
    })
  })

  await waitForLocalRuntime(`${runtimeUrl}/models`, 60_000)
  setLocalRuntimeLoadProgress({
    status: 'ready',
    percent: 100,
    message: 'Local runtime is ready.',
  })
  setLocalRuntimeStatus({
    state: 'running',
    startedAt: Date.now(),
    url: runtimeUrl,
    lastError: null,
  })
  setLocalRuntimeLoadProgress(null)

  return localRuntimeStatus
}

/**
 * Encode each path segment in a repository-relative Hugging Face file path.
 *
 * @param path - Raw repository-relative file path.
 * @returns Safely encoded URL path.
 */
function encodeRepositoryPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * Read the GGUF files available in a Hugging Face repository.
 *
 * @param repoId - Repository identifier like `bartowski/Some-GGUF`.
 * @param token - Optional Hugging Face access token.
 * @returns GGUF files with lightweight metadata hints.
 */
async function browseHuggingFaceRepo(repoId: string, token?: string): Promise<HuggingFaceModelFile[]> {
  const trimmedRepoId = repoId.trim()
  if (!trimmedRepoId) {
    throw new Error('Enter a Hugging Face repository id before browsing files.')
  }

  const response = await fetch(`https://huggingface.co/api/models/${trimmedRepoId}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error(`Hugging Face returned HTTP ${response.status}: ${await response.text()}`)
  }

  const json = await response.json() as {
    siblings?: Array<{ rfilename?: string, size?: number }>
  }

  return (json.siblings ?? [])
    .filter((file): file is { rfilename: string, size?: number } =>
      typeof file.rfilename === 'string' && file.rfilename.toLowerCase().endsWith('.gguf'),
    )
    .map((file) => {
      const parsed = parseModelMetadataHints(file.rfilename)
      return {
        path: file.rfilename,
        name: basename(file.rfilename),
        sizeBytes: typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0 ? file.size : null,
        parameterSizeBillions: parsed.parameterSizeBillions ?? null,
        quantization: parsed.quantization ?? null,
      }
    })
}

/**
 * Push a model download progress update into every open renderer.
 *
 * @param progress - Progress payload to broadcast.
 */
function broadcastModelDownloadProgress(progress: ModelDownloadProgress): void {
  broadcastToAllWindows('llama:model-download:progress', progress)
}

/**
 * Download a GGUF model from Hugging Face into the configured local models directory.
 *
 * @param server - Local server profile owning the models directory.
 * @param repoId - Hugging Face repository identifier.
 * @param fileName - Repository-relative GGUF path.
 * @returns Persisted local model preset describing the downloaded file.
 */
async function downloadHuggingFaceModel(
  server: ServerProfile,
  repoId: string,
  fileName: string,
): Promise<ModelPreset> {
  const trimmedRepoId = repoId.trim()
  const trimmedFileName = fileName.trim()
  if (!trimmedRepoId || !trimmedFileName) {
    throw new Error('Both the Hugging Face repository and file name are required.')
  }

  const modelsRoot = ensureLocalModelsDirectory(server)
  const destinationPath = join(modelsRoot, ...trimmedRepoId.split('/'), ...trimmedFileName.split('/'))
  const tempPath = `${destinationPath}.partial`
  const downloadId = uid()
  const headers = server.huggingFaceToken
    ? { Authorization: `Bearer ${server.huggingFaceToken}` }
    : undefined
  const url = `https://huggingface.co/${trimmedRepoId}/resolve/main/${encodeRepositoryPath(trimmedFileName)}?download=true`

  if (existsSync(destinationPath)) {
    const settings = loadSettings({ syncLocalModels: false })
    const existingModel = settings.models.find((model) =>
      model.serverId === server.id && model.localPath === destinationPath,
    )
    return buildLocalModelPreset(server, destinationPath, existingModel)
  }

  mkdirSync(dirname(destinationPath), { recursive: true })
  broadcastModelDownloadProgress({
    downloadId,
    serverId: server.id,
    repoId: trimmedRepoId,
    fileName: trimmedFileName,
    destinationPath,
    status: 'starting',
    bytesDownloaded: 0,
    totalBytes: null,
    percent: null,
    message: null,
  })

  const response = await fetch(url, { method: 'GET', headers })
  if (!response.ok || !response.body) {
    throw new Error(`Hugging Face returned HTTP ${response.status}: ${await response.text()}`)
  }

  const totalHeader = response.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : null
  const writer = createWriteStream(tempPath)
  const reader = response.body.getReader()
  let bytesDownloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (value) {
        bytesDownloaded += value.byteLength
        writer.write(Buffer.from(value))
        broadcastModelDownloadProgress({
          downloadId,
          serverId: server.id,
          repoId: trimmedRepoId,
          fileName: trimmedFileName,
          destinationPath,
          status: 'downloading',
          bytesDownloaded,
          totalBytes: totalBytes && Number.isFinite(totalBytes) ? totalBytes : null,
          percent: totalBytes && Number.isFinite(totalBytes) && totalBytes > 0
            ? Math.min(100, Number(((bytesDownloaded / totalBytes) * 100).toFixed(1)))
            : null,
          message: null,
        })
      }
    }
  } catch (error) {
    writer.close()
    if (existsSync(tempPath)) {
      unlinkSync(tempPath)
    }
    broadcastModelDownloadProgress({
      downloadId,
      serverId: server.id,
      repoId: trimmedRepoId,
      fileName: trimmedFileName,
      destinationPath,
      status: 'error',
      bytesDownloaded,
      totalBytes: totalBytes && Number.isFinite(totalBytes) ? totalBytes : null,
      percent: null,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  await new Promise<void>((resolve, reject) => {
    writer.once('error', reject)
    writer.end(resolve)
  })
  renameSync(tempPath, destinationPath)
  broadcastModelDownloadProgress({
    downloadId,
    serverId: server.id,
    repoId: trimmedRepoId,
    fileName: trimmedFileName,
    destinationPath,
    status: 'completed',
    bytesDownloaded,
    totalBytes: totalBytes && Number.isFinite(totalBytes) ? totalBytes : bytesDownloaded,
    percent: 100,
    message: null,
  })

  const settings = loadSettings({ syncLocalModels: false })
  const existingModel = settings.models.find((model) =>
    model.serverId === server.id && model.localPath === destinationPath,
  )
  const downloadedModel = buildLocalModelPreset(server, destinationPath, existingModel)
  downloadedModel.source = 'huggingface'
  downloadedModel.huggingFaceRepo = trimmedRepoId
  downloadedModel.huggingFaceFile = trimmedFileName
  saveModelProfile(downloadedModel)

  return downloadedModel
}

/**
 * Detect whether a server profile should use LM Studio's native chat API.
 *
 * @param server - Server profile selected for the request.
 * @returns True when the native LM Studio transport should be used.
 */
function isLmStudioServer(server: ServerProfile): boolean {
  return server.kind === 'lmstudio' || server.id === 'lmstudio-default' || server.name.trim().toLowerCase() === 'lm studio'
}

/**
 * Detect whether a server profile is text-generation-webui.
 *
 * @param server - Server profile selected for the request.
 * @returns True when the text-generation-webui-specific endpoints should be used.
 */
function isTextGenerationWebUiServer(server: ServerProfile): boolean {
  return (
    server.kind === 'text-generation-webui' ||
    server.id === 'textgen-webui-default' ||
    server.name.trim().toLowerCase() === 'text-generation-webui'
  )
}

/**
 * Convert a configured base URL into LM Studio's native chat endpoint.
 *
 * @param baseUrl - User-configured server base URL.
 * @returns Absolute endpoint URL for the native LM Studio chat API.
 */
function toLmStudioChatEndpoint(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  if (trimmedBaseUrl.endsWith('/v1')) {
    return `${trimmedBaseUrl.slice(0, -3)}/api/v1/chat`
  }

  if (trimmedBaseUrl.endsWith('/api/v1')) {
    return `${trimmedBaseUrl}/chat`
  }

  return `${trimmedBaseUrl}/api/v1/chat`
}

/**
 * Convert a configured base URL into LM Studio's native models endpoint.
 *
 * @param baseUrl - User-configured server base URL.
 * @returns Absolute endpoint URL for the native LM Studio models API.
 */
function toLmStudioModelsEndpoint(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  if (trimmedBaseUrl.endsWith('/v1')) {
    return `${trimmedBaseUrl.slice(0, -3)}/api/v0/models`
  }

  if (trimmedBaseUrl.endsWith('/api/v1')) {
    return `${trimmedBaseUrl.slice(0, -7)}/api/v0/models`
  }

  if (trimmedBaseUrl.endsWith('/api/v0')) {
    return `${trimmedBaseUrl}/models`
  }

  return `${trimmedBaseUrl}/api/v0/models`
}

/**
 * Convert a configured base URL into text-generation-webui's internal model list endpoint.
 *
 * @param baseUrl - User-configured server base URL.
 * @returns Absolute endpoint URL for the internal model list API.
 */
function toTextGenerationWebUiModelsEndpoint(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  if (trimmedBaseUrl.endsWith('/v1')) {
    return `${trimmedBaseUrl}/internal/model/list`
  }

  return `${trimmedBaseUrl}/v1/internal/model/list`
}

/**
 * Convert a configured base URL into text-generation-webui's internal model load endpoint.
 *
 * @param baseUrl - User-configured server base URL.
 * @returns Absolute endpoint URL for the internal model load API.
 */
function toTextGenerationWebUiLoadModelEndpoint(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  if (trimmedBaseUrl.endsWith('/v1')) {
    return `${trimmedBaseUrl}/internal/model/load`
  }

  return `${trimmedBaseUrl}/v1/internal/model/load`
}

/* ── AI streaming helper ───────────────────────────────────────────────── */

/**
 * Async generator that posts a streaming chat-completions request
 * and yields each text token as it arrives via Server-Sent Events.
 *
 * @param baseUrl  - OpenAI-compatible server base URL (e.g. http://localhost:1234/v1).
 * @param apiKey   - API key (any string for most local servers).
 * @param model    - Model slug.
 * @param messages - Full conversation history.
 */
async function* streamChat(
  server: ServerProfile,
  baseUrl:  string,
  apiKey:   string,
  model:    string,
  messages: ChatMessage[],
  contextWindowTokens: number | null,
  temperature: number | null,
  topP: number | null,
  topK: number | null,
  repeatPenalty: number | null,
  presencePenalty: number | null,
  frequencyPenalty: number | null,
  maxTokens: number | null,
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
  const streamTimeout = createAiStreamTimeoutController()
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }

  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_tokens = Math.floor(maxTokens)
  }

  if (typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0) {
    requestBody.temperature = temperature
  }

  if (typeof topP === 'number' && Number.isFinite(topP) && topP >= 0 && topP <= 1) {
    requestBody.top_p = topP
  }

  if (typeof topK === 'number' && Number.isFinite(topK) && topK >= 0) {
    requestBody.top_k = Math.floor(topK)
  }

  if (typeof repeatPenalty === 'number' && Number.isFinite(repeatPenalty) && repeatPenalty >= 0) {
    requestBody.repeat_penalty = Number(repeatPenalty.toFixed(2))
  }

  if (
    typeof presencePenalty === 'number' &&
    Number.isFinite(presencePenalty) &&
    presencePenalty >= -2 &&
    presencePenalty <= 2
  ) {
    requestBody.presence_penalty = presencePenalty
  }

  if (
    typeof frequencyPenalty === 'number' &&
    Number.isFinite(frequencyPenalty) &&
    frequencyPenalty >= -2 &&
    frequencyPenalty <= 2
  ) {
    requestBody.frequency_penalty = frequencyPenalty
  }

  if (isTextGenerationWebUiServer(server)) {
    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
      requestBody.max_new_tokens = Math.floor(maxTokens)
    }

    if (
      typeof contextWindowTokens === 'number' &&
      Number.isFinite(contextWindowTokens) &&
      contextWindowTokens > 0
    ) {
      requestBody.truncation_length = Math.floor(contextWindowTokens)
    }
  }

  logger?.('request', 'openai.chat.request', {
    url: `${baseUrl}/chat/completions`,
    serverKind: isTextGenerationWebUiServer(server) ? 'text-generation-webui' : 'openai-compatible',
    body: requestBody,
  })

  streamTimeout.armInitialTimeout()

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: streamTimeout.controller.signal,
    })

    logger?.('response', 'openai.chat.response', {
      status: response.status,
      ok: response.ok,
      url: `${baseUrl}/chat/completions`,
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text()
      logger?.('error', 'openai.chat.error', {
        status: response.status,
        body: errorText,
      })
      throw new Error(`Server returned HTTP ${response.status}: ${errorText}`)
    }

    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''
    let   aggregatedContent = ''
    // Strip Qwen3-style <think>...</think> blocks that arrive mid-stream.
    // inThinkBlock tracks whether we are currently inside a <think> tag.
    let   inThinkBlock = false

    /**
     * Emit a single debug entry containing the full streamed assistant content.
     */
    function flushAggregatedContentDebug(): void {
      if (!aggregatedContent) {
        return
      }

      logger?.('response', 'openai.chat.chunk', { content: aggregatedContent })
      aggregatedContent = ''
    }

    streamTimeout.armIdleTimeout()

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        flushAggregatedContentDebug()
        break
      }

      streamTimeout.armIdleTimeout()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          flushAggregatedContentDebug()
          return
        }

        try {
          const json = JSON.parse(data) as {
            choices?: [{ delta?: { content?: string } }]
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
              total_tokens?: number
            }
          }
          let content = json.choices?.[0]?.delta?.content
          if (content) {
            // Strip <think>...</think> blocks emitted by Qwen3-family models.
            // The tags can span multiple chunks so we track state across iterations.
            if (inThinkBlock) {
              const closeIdx = content.indexOf('</think>')
              if (closeIdx !== -1) {
                inThinkBlock = false
                content = content.slice(closeIdx + '</think>'.length)
              } else {
                content = ''
              }
            }
            if (!inThinkBlock && content.includes('<think>')) {
              const openIdx = content.indexOf('<think>')
              const closeIdx = content.indexOf('</think>', openIdx)
              if (closeIdx !== -1) {
                // Entire block in one chunk
                content = content.slice(0, openIdx) + content.slice(closeIdx + '</think>'.length)
              } else {
                inThinkBlock = true
                content = content.slice(0, openIdx)
              }
            }
            if (content) {
              aggregatedContent += content
              yield { chunk: content }
            }
          }

          const usage = json.usage
          if (
            typeof usage?.prompt_tokens === 'number' &&
            typeof usage?.completion_tokens === 'number' &&
            typeof usage?.total_tokens === 'number'
          ) {
            logger?.('response', 'openai.chat.usage', usage)
            yield {
              usage: {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              },
            }
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } catch (error) {
    if (streamTimeout.controller.signal.aborted) {
      const timeoutMessage = streamTimeout.getTimeoutMessage() ?? 'The model request timed out.'
      logger?.('error', 'openai.chat.timeout', { message: timeoutMessage })
      throw new Error(timeoutMessage)
    }

    throw error
  } finally {
    streamTimeout.clearTimeout()
  }
}

/**
 * Async generator that consumes LM Studio's native chat event stream.
 *
 * @param baseUrl  - Configured LM Studio base URL.
 * @param apiKey   - API key sent to LM Studio.
 * @param model    - Model slug.
 * @param messages - Full conversation history.
 */
async function* streamLmStudioChat(
  baseUrl:  string,
  apiKey:   string,
  model:    string,
  messages: ChatMessage[],
  temperature: number | null,
  topP: number | null,
  maxTokens: number | null,
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
  const streamTimeout = createAiStreamTimeoutController()
  const flattenedTranscript = messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n')

  const input = [
    {
      type: 'text',
      content: flattenedTranscript,
    },
  ]
  const endpoint = toLmStudioChatEndpoint(baseUrl)
  const requestBody = {
    model,
    input,
    stream: true,
    ...(typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0
      ? { temperature }
      : {}),
    ...(typeof topP === 'number' && Number.isFinite(topP) && topP >= 0 && topP <= 1
      ? { top_p: topP }
      : {}),
    ...(typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
      ? { max_tokens: Math.floor(maxTokens) }
      : {}),
  }

  logger?.('request', 'lmstudio.chat.request', {
    url: endpoint,
    body: requestBody,
  })

  streamTimeout.armInitialTimeout()

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: streamTimeout.controller.signal,
    })

    logger?.('response', 'lmstudio.chat.response', {
      status: response.status,
      ok: response.ok,
      url: endpoint,
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text()
      logger?.('error', 'lmstudio.chat.error', {
        status: response.status,
        body: errorText,
      })
      throw new Error(`Server returned HTTP ${response.status}: ${errorText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let emittedText = false

    streamTimeout.armIdleTimeout()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      streamTimeout.armIdleTimeout()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return

        try {
          const json = JSON.parse(data) as {
            type?: string
            delta?: string
            content?: string
            message?: { content?: string }
            result?: {
              output?: Array<{
                type?: string
                content?: string
              }>
              stats?: {
                input_tokens?: number
                total_output_tokens?: number
              }
            }
          }

          const deltaText =
            (typeof json.delta === 'string' && json.delta) ||
            (typeof json.content === 'string' && json.content) ||
            (typeof json.message?.content === 'string' && json.message.content) ||
            null

          if (deltaText && json.type !== 'chat.end') {
            emittedText = true
            logger?.('response', 'lmstudio.chat.chunk', { type: json.type ?? null, content: deltaText })
            yield { chunk: deltaText }
          }

          if (json.type === 'chat.end') {
            if (!emittedText) {
              const finalMessage = json.result?.output
                ?.filter((entry) => entry.type === 'message' && typeof entry.content === 'string')
                .map((entry) => entry.content ?? '')
                .join('')

              if (finalMessage) {
                logger?.('response', 'lmstudio.chat.final_message', { content: finalMessage })
                yield { chunk: finalMessage }
              }
            }

            const stats = json.result?.stats
            if (
              typeof stats?.input_tokens === 'number' &&
              typeof stats?.total_output_tokens === 'number'
            ) {
              logger?.('response', 'lmstudio.chat.stats', stats)
              yield {
                usage: {
                  promptTokens: stats.input_tokens,
                  completionTokens: stats.total_output_tokens,
                  totalTokens: stats.input_tokens + stats.total_output_tokens,
                },
              }
            }
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } catch (error) {
    if (streamTimeout.controller.signal.aborted) {
      const timeoutMessage = streamTimeout.getTimeoutMessage() ?? 'The model request timed out.'
      logger?.('error', 'lmstudio.chat.timeout', { message: timeoutMessage })
      throw new Error(timeoutMessage)
    }

    throw error
  } finally {
    streamTimeout.clearTimeout()
  }
}

/**
 * Stream chat from a selected server, preferring LM Studio's native API when
 * available and falling back to the OpenAI-compatible endpoint otherwise.
 *
 * @param server   - Selected server profile.
 * @param model    - Model slug.
 * @param messages - Full conversation history.
 */
async function* streamServerChat(
  server: ServerProfile,
  model: string,
  messages: ChatMessage[],
  contextWindowTokens: number | null,
  temperature: number | null,
  topP: number | null,
  topK: number | null,
  repeatPenalty: number | null,
  presencePenalty: number | null,
  frequencyPenalty: number | null,
  maxTokens: number | null,
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
  if (isLmStudioServer(server)) {
    try {
      logger?.('info', 'lmstudio.transport.selected', {
        serverId: server.id,
        baseUrl: server.baseUrl,
      })
      yield* streamLmStudioChat(server.baseUrl, server.apiKey, model, messages, temperature, topP, maxTokens, logger)
      return
    } catch (error) {
      logger?.('error', 'lmstudio.transport.fallback', {
        message: error instanceof Error ? error.message : String(error),
      })
      console.warn('[Aethra] LM Studio native chat failed, falling back to OpenAI-compatible stream:', error)
    }
  }

  logger?.('info', 'openai.transport.selected', {
    serverId: server.id,
    baseUrl: server.baseUrl,
    contextWindowTokens,
    temperature,
    topP,
    topK,
    repeatPenalty,
    presencePenalty,
    frequencyPenalty,
    maxTokens,
  })
  yield* streamChat(
    server,
    server.baseUrl,
    server.apiKey,
    model,
    messages,
    contextWindowTokens,
    temperature,
    topP,
    topK,
    repeatPenalty,
    presencePenalty,
    frequencyPenalty,
    maxTokens,
    logger,
  )
}

/**
 * Estimate token usage for an outbound prompt payload conservatively enough
 * to leave headroom when reserving completion tokens.
 *
 * @param messages - Full prompt payload that will be sent to the model.
 * @returns Rough token count estimate.
 */
function estimatePromptTokens(messages: ChatMessage[]): number {
  const serialized = messages
    .map((message) => `${message.role}:${message.content}`)
    .join('\n')

  return Math.max(1, Math.ceil(serialized.length / 4))
}

/**
 * Create timeout helpers for abortable AI streaming requests.
 * The initial timeout covers connection / first-byte latency; the idle timeout
 * covers streams that stop delivering data after they begin.
 *
 * @returns Timeout controller plus helper callbacks.
 */
function createAiStreamTimeoutController(): {
  controller: AbortController
  armInitialTimeout: () => void
  armIdleTimeout: () => void
  clearTimeout: () => void
  getTimeoutMessage: () => string | null
} {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let timeoutMessage: string | null = null

  const clearTimeoutState = () => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }

  const armTimeout = (durationMs: number, message: string) => {
    clearTimeoutState()
    timeoutHandle = setTimeout(() => {
      timeoutMessage = message
      controller.abort()
    }, durationMs)
  }

  return {
    controller,
    armInitialTimeout: () => {
      armTimeout(
        AI_STREAM_INITIAL_TIMEOUT_MS,
        'The model did not respond in time. Check that the server is running and try again.',
      )
    },
    armIdleTimeout: () => {
      armTimeout(
        AI_STREAM_IDLE_TIMEOUT_MS,
        'The model stopped responding during streaming. Check the server and try again.',
      )
    },
    clearTimeout: clearTimeoutState,
    getTimeoutMessage: () => timeoutMessage,
  }
}

/**
 * Query an OpenAI-compatible server for its advertised model catalog.
 *
 * @param server - Server profile to inspect.
 * @returns Discovered models normalized for the renderer.
 */
async function browseServerModels(server: ServerProfile): Promise<AvailableModel[]> {
  if (isLocalLlamaServer(server)) {
    const settings = synchronizeLocalModels(loadSettings({ syncLocalModels: false }))
    return settings.models
      .filter((model) => model.serverId === server.id)
      .map((model) => ({
        ...model,
      }))
  }

  const endpoint = isLmStudioServer(server)
    ? toLmStudioModelsEndpoint(server.baseUrl)
    : isTextGenerationWebUiServer(server)
      ? toTextGenerationWebUiModelsEndpoint(server.baseUrl)
      : `${server.baseUrl}/models`

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${server.apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }

  const json = await response.json() as {
    data?: Array<Record<string, unknown>>
    model_names?: string[]
  } | Array<Record<string, unknown>>

  if (!Array.isArray(json) && Array.isArray(json.model_names)) {
    return json.model_names
      .filter((modelName): modelName is string => typeof modelName === 'string' && modelName.length > 0)
      .map((modelName) => applyStoredModelProfile({
        id: `${server.id}:${modelName}`,
        serverId: server.id,
        name: modelName,
        slug: modelName,
      }))
  }

  const rawModels = Array.isArray(json) ? json : (json.data ?? [])

  return rawModels
    .filter((model): model is Record<string, unknown> & { id: string } => typeof model.id === 'string' && model.id.length > 0)
    .map((model) => applyStoredModelProfile({
      id: `${server.id}:${model.id}`,
      serverId: server.id,
      name: model.id,
      slug: model.id,
      contextWindowTokens:
        typeof model.context_window === 'number' ? model.context_window
        : typeof model.context_length === 'number' ? model.context_length
        : typeof model.max_context_length === 'number' ? model.max_context_length
        : typeof model.max_seq_len === 'number' ? model.max_seq_len
        : typeof model.maxContextLength === 'number' ? model.maxContextLength
        : typeof model.contextLength === 'number' ? model.contextLength
        : undefined,
      temperature:
        typeof model.temperature === 'number' && Number.isFinite(model.temperature) && model.temperature >= 0
          ? model.temperature
          : undefined,
      topP:
        typeof model.top_p === 'number' && Number.isFinite(model.top_p) && model.top_p >= 0 && model.top_p <= 1
          ? model.top_p
          : undefined,
      topK:
        typeof model.top_k === 'number' && Number.isFinite(model.top_k) && model.top_k >= 0
          ? Math.floor(model.top_k)
          : undefined,
      repeatPenalty:
        typeof model.repeat_penalty === 'number' && Number.isFinite(model.repeat_penalty) && model.repeat_penalty >= 0
          ? Number(model.repeat_penalty.toFixed(2))
          : undefined,
    }))
}

/**
 * Load a model on text-generation-webui with the requested context size.
 *
 * @param server - Server profile to control.
 * @param modelName - Exact upstream model name to load.
 * @param contextWindowTokens - Requested context window size in tokens.
 */
async function loadServerModel(
  server: ServerProfile,
  modelName: string,
  contextWindowTokens: number,
): Promise<void> {
  if (!isTextGenerationWebUiServer(server)) {
    throw new Error('Model loading from the ribbon is currently supported only for text-generation-webui.')
  }

  const endpoint = toTextGenerationWebUiLoadModelEndpoint(server.baseUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${server.apiKey}`,
    },
    body: JSON.stringify({
      model_name: modelName,
      args: {
        ctx_size: contextWindowTokens,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }
}

/* ── Relationship graph helpers ────────────────────────────────────────── */

/**
 * Resolve the absolute path to a campaign's relationships.json file.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @returns Absolute path to relationships.json.
 */
function relationshipsFilePath(campaignPath: string): string {
  return join(campaignPath, 'relationships.json')
}

/**
 * Load the relationship graph from disk, returning null when absent or
 * when the stored campaignId does not match the expected value.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @param campaignId - Expected campaign ID for integrity check.
 * @returns Parsed graph or null.
 */
function loadRelationshipGraph(campaignPath: string, campaignId: string): RelationshipGraph | null {
  const filePath = relationshipsFilePath(campaignPath)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RelationshipGraph
    if (raw.campaignId !== campaignId) {
      console.warn('[Aethra] relationships.json campaignId mismatch — ignoring stored graph')
      return null
    }
    return raw
  } catch {
    return null
  }
}

/**
 * Write a relationship graph to disk.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @param graph - Graph to persist.
 */
function saveRelationshipGraph(campaignPath: string, graph: RelationshipGraph): void {
  writeFileSync(relationshipsFilePath(campaignPath), JSON.stringify(graph, null, 2), 'utf-8')
}

/** Valid affinity label set for LLM response validation. */
const VALID_AFFINITY_LABELS = new Set<AffinityLabel>([
  'hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted',
])

/**
 * Assemble all session transcripts (oldest first) into a single string
 * for the relationship refresh prompt. Prepends rolling summaries where present.
 *
 * @param sessions - All campaign sessions.
 * @returns Formatted transcript string.
 */
function buildRelationshipTranscript(sessions: Session[]): string {
  return sessions
    .map((session) => {
      const lines: string[] = [`--- Session: ${session.title || 'Untitled'} ---`]
      if (session.rollingSummary.trim().length > 0) {
        lines.push(`Summary of earlier events:\n${session.rollingSummary.trim()}`)
      }
      session.messages.forEach((message) => {
        if (message.role === 'assistant' || message.role === 'user') {
          const speaker = message.characterName?.trim() ?? (message.role === 'user' ? 'Player' : 'Assistant')
          lines.push(`[${speaker}] ${message.content}`)
        }
      })
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Call the active LLM server with a non-streaming chat completion request
 * for relationship analysis. Returns the raw response text.
 *
 * @param messages - Chat messages to send.
 * @param settings - App settings containing active server/model config.
 * @returns Raw response content string.
 */
async function fetchRelationshipCompletion(
  messages: ChatMessage[],
  settings: ReturnType<typeof loadSettings>,
): Promise<string> {
  const server = settings.servers.find((s) => s.id === settings.activeServerId)
  if (!server) {
    throw new Error('No active server configured. Select a server in Settings before refreshing relationships.')
  }
  const modelSlug = settings.activeModelSlug
  if (!modelSlug) {
    throw new Error('No active model configured. Select a model in Settings before refreshing relationships.')
  }

  const endpoint = `${server.baseUrl}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${server.apiKey}`,
    },
    body: JSON.stringify({
      model: modelSlug,
      messages,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Model returned an empty response.')
  }
  return content.trim()
}

/**
 * Parse and validate the raw JSON array returned by the LLM for relationship entries.
 * Invalid or unknown entries are silently skipped; bad field values are clamped/defaulted.
 *
 * @param raw - Raw response text from the LLM.
 * @param validCharacterIds - Set of known character IDs to validate against.
 * @returns Validated array of partial entries (without manualNotes or lastAiRefreshedAt).
 */
function parseRelationshipEntries(
  raw: string,
  validCharacterIds: Set<string>,
): Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>> {
  // Strip optional markdown code fences the model may wrap around the JSON
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error('Refresh failed — model returned invalid data. Try again.')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Refresh failed — model returned invalid data. Try again.')
  }
  const validated: Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>> = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const fromId = typeof entry.fromCharacterId === 'string' ? entry.fromCharacterId : ''
    const toId = typeof entry.toCharacterId === 'string' ? entry.toCharacterId : ''
    if (!fromId || !toId || !validCharacterIds.has(fromId) || !validCharacterIds.has(toId)) continue
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : ''
    if (!summary) continue
    const rawScore = typeof entry.trustScore === 'number' ? entry.trustScore : 50
    const trustScore = Math.max(0, Math.min(100, Math.round(rawScore)))
    const rawLabel = typeof entry.affinityLabel === 'string' ? entry.affinityLabel : ''
    const affinityLabel: AffinityLabel = VALID_AFFINITY_LABELS.has(rawLabel as AffinityLabel)
      ? (rawLabel as AffinityLabel)
      : 'neutral'
    validated.push({ fromCharacterId: fromId, toCharacterId: toId, trustScore, affinityLabel, summary })
  }
  return validated
}

/**
 * Merge validated LLM entries into the existing relationship graph.
 * Preserves manualNotes for existing entries; adds new entries for new pairs.
 * Orphaned entries (deleted characters) are retained unchanged.
 *
 * @param existing - Current persisted graph (or null when no graph exists yet).
 * @param campaignId - Campaign ID for the returned graph.
 * @param validated - Validated entries from the LLM response.
 * @returns Updated graph (not yet saved to disk).
 */
function mergeRelationshipEntries(
  existing: RelationshipGraph | null,
  campaignId: string,
  validated: Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>>,
): RelationshipGraph {
  const now = Date.now()
  const existingEntries: RelationshipEntry[] = existing?.entries ?? []

  const updated: RelationshipEntry[] = existingEntries.map((entry) => {
    const match = validated.find(
      (v) => v.fromCharacterId === entry.fromCharacterId && v.toCharacterId === entry.toCharacterId,
    )
    if (!match) return entry
    return {
      ...entry,
      trustScore: match.trustScore,
      affinityLabel: match.affinityLabel,
      summary: match.summary,
      lastAiRefreshedAt: now,
    }
  })

  // Add new pairs not already in the graph
  for (const v of validated) {
    const exists = existingEntries.some(
      (e) => e.fromCharacterId === v.fromCharacterId && e.toCharacterId === v.toCharacterId,
    )
    if (!exists) {
      updated.push({ ...v, manualNotes: '', lastAiRefreshedAt: now })
    }
  }

  return { campaignId, entries: updated, lastRefreshedAt: now }
}

/* ── IPC handlers ──────────────────────────────────────────────────────── */

/** Settings: read */
ipcMain.handle('settings:get', (): AppSettings => loadSettings())

/** Settings: write */
ipcMain.handle('settings:set', (_event, settings: AppSettings): void => {
  saveSettings(settings)
  const localServer = getLocalServer(normalizeSettings(settings))
  if (localServer) {
    setLocalRuntimeStatus({
      serverId: localServer.id,
      url: localServer.baseUrl,
    })
  }
})

/**
 * Models: read the current remote model list for a configured server.
 */
ipcMain.handle('models:browse', async (_event, serverId: string): Promise<AvailableModel[]> => {
  const settings = loadSettings()
  const server = settings.servers.find((candidate) => candidate.id === serverId)

  if (!server) {
    throw new Error('Selected server could not be found.')
  }

  const models = await browseServerModels(server)
  return models
})

/**
 * Models: ask the configured server to load a model into memory.
 */
ipcMain.handle(
  'models:load',
  async (_event, serverId: string, modelName: string, contextWindowTokens: number): Promise<void> => {
    const settings = loadSettings({ syncLocalModels: false })
    const server = settings.servers.find((candidate) => candidate.id === serverId)

    if (!server) {
      throw new Error('Selected server could not be found.')
    }

    await loadServerModel(server, modelName, contextWindowTokens)
  },
)

/** Hardware: read local machine capabilities for llama.cpp guidance. */
ipcMain.handle('hardware:get', (): HardwareInfo => {
  return detectHardwareInfo()
})

/** Local llama.cpp: choose a models directory. */
ipcMain.handle('llama:pick-models-directory', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
})

/** Local llama.cpp: choose a llama-server executable. */
ipcMain.handle('llama:pick-executable', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'llama-server',
        extensions: process.platform === 'win32' ? ['exe'] : ['*'],
      },
    ],
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
})

/** Local llama.cpp: browse GGUF files in a Hugging Face repository. */
ipcMain.handle('llama:hf:browse', async (_event, serverId: string, repoId: string): Promise<HuggingFaceModelFile[]> => {
  const settings = loadSettings({ syncLocalModels: false })
  const server = settings.servers.find((candidate) => candidate.id === serverId)

  if (!server || !isLocalLlamaServer(server)) {
    throw new Error('Select the local llama.cpp provider before browsing Hugging Face models.')
  }

  return browseHuggingFaceRepo(repoId, server.huggingFaceToken)
})

/** Local llama.cpp: download a GGUF file from Hugging Face. */
ipcMain.handle('llama:hf:download', async (_event, serverId: string, repoId: string, fileName: string): Promise<ModelPreset> => {
  const settings = loadSettings({ syncLocalModels: false })
  const server = settings.servers.find((candidate) => candidate.id === serverId)

  if (!server || !isLocalLlamaServer(server)) {
    throw new Error('Select the local llama.cpp provider before downloading models.')
  }

  const downloadedModel = await downloadHuggingFaceModel(server, repoId, fileName)
  const nextSettings = synchronizeLocalModels(loadSettings({ syncLocalModels: false }))
  saveSettings(nextSettings)
  return downloadedModel
})

/** Local llama.cpp: read the managed runtime status. */
ipcMain.handle('llama:runtime:get-status', (): LocalRuntimeStatus => {
  return localRuntimeStatus
})

/** Local llama.cpp: start or switch the managed runtime to the selected local model. */
ipcMain.handle('llama:runtime:load', async (_event, serverId: string, modelSlug: string): Promise<LocalRuntimeStatus> => {
  const settings = synchronizeLocalModels(loadSettings({ syncLocalModels: false }))
  const server = settings.servers.find((candidate) => candidate.id === serverId)

  if (!server || !isLocalLlamaServer(server)) {
    throw new Error('Select the local llama.cpp provider before loading a local model.')
  }

  const model = settings.models.find((candidate) => candidate.serverId === server.id && candidate.slug === modelSlug)
  if (!model) {
    throw new Error('The selected local model could not be found.')
  }

  return startLocalRuntime(server, model)
})

/** Local llama.cpp: stop the managed runtime. */
ipcMain.handle('llama:runtime:stop', (): void => {
  stopLocalRuntime()
})

/** Local llama.cpp: check whether the llama-server binary is present and detect backend. */
ipcMain.handle('llama:binary:check', (_event, serverId: string): {
  found: boolean
  path: string | null
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  estimatedSizeMb: number
} => {
  const settings = loadSettings({ syncLocalModels: false })
  const server = settings.servers.find((s) => s.id === serverId) ?? null
  const resolved = server ? resolveLlamaExecutablePath(server) : null
  const { display, sizeMb } = detectLlamaBinaryBackend()
  return {
    found: resolved !== null,
    path: resolved,
    detectedBackend: display,
    estimatedSizeMb: sizeMb,
  }
})

/** Local llama.cpp: download and install the llama-server binary. */
ipcMain.handle('llama:binary:install', async (_event, _serverId: string): Promise<{
  success: boolean
  executablePath: string | null
  error?: string
}> => {
  if (isBinaryInstalling) {
    return { success: false, executablePath: null, error: 'Install already in progress.' }
  }
  isBinaryInstalling = true
  try {
    const executablePath = await installLlamaBinary()
    return { success: true, executablePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, executablePath: null, error: message }
  } finally {
    isBinaryInstalling = false
  }
})

/** AI debug log: read */
ipcMain.handle('ai:debug:get', (): AiDebugEntry[] => {
  return [...aiDebugLog]
})

/** AI debug log: clear */
ipcMain.handle('ai:debug:clear', (): void => {
  aiDebugLog.length = 0
})

/** AI debug log: append renderer-provided entry */
ipcMain.handle('ai:debug:append', (event, entry: Omit<AiDebugEntry, 'id'>): void => {
  recordAiDebugEntry(
    event.sender,
    entry.direction,
    entry.label,
    entry.payload,
  )
})

/**
 * Campaigns: create a new managed campaign folder and initial JSON file.
 */
ipcMain.handle('campaign:create', async (_event, name: string, description: string): Promise<CampaignFileHandle> => {
  const campaignName = name.trim().length > 0 ? name.trim() : 'New Campaign'
  const folderPath = allocateCampaignFolder(campaignName)
  const campaign: Campaign = {
    ...createEmptyCampaign(campaignName),
    description: description.trim(),
  }

  saveCampaign(folderPath, campaign)
  return { path: folderPath, campaign }
})

/**
 * Campaigns: list stored campaigns for the launcher.
 */
ipcMain.handle('campaign:list', (): CampaignSummary[] => {
  return listStoredCampaigns()
})

/**
 * Campaigns: open an existing managed campaign by folder path.
 */
ipcMain.handle('campaign:open', async (_event, path: string): Promise<CampaignFileHandle> => {
  const sendProgress = (progress: CampaignLoadProgress): void => {
    if (!_event.sender.isDestroyed()) {
      _event.sender.send('campaign:load:progress', progress)
    }
  }

  try {
    return loadCampaignFile(path, sendProgress)
  } catch (error) {
    sendProgress({
      status: 'error',
      percent: 0,
      message: error instanceof Error ? error.message : 'Could not load campaign.',
      sessionsLoaded: 0,
      totalSessions: 0,
    })
    throw error
  }
})

/**
 * Campaigns: choose a campaign.json file from disk and return its folder path.
 */
ipcMain.handle('campaign:pick-file', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Open Campaign File',
    properties: ['openFile'],
    filters: [
      {
        name: 'Campaign Files',
        extensions: ['json'],
      },
    ],
  })

  if (result.canceled) {
    return null
  }

  const selectedPath = result.filePaths[0]
  return selectedPath ? dirname(selectedPath) : null
})

/**
 * Campaigns: save the current campaign to its JSON file.
 */
ipcMain.handle('campaign:save', (_event, path: string, campaign: Campaign): void => {
  saveCampaign(path, campaign)
})

/**
 * Characters: list stored characters for an existing campaign folder.
 */
ipcMain.handle('characters:list', (_event, campaignPath: string): CharacterProfile[] => {
  return listStoredCharacters(campaignPath)
})

/**
 * Characters: create a new character folder and seed character.json.
 */
ipcMain.handle('characters:create', (_event, campaignPath: string, name: string): CharacterProfile => {
  return createStoredCharacter(campaignPath, name)
})

/**
 * Characters: persist edits to an existing character profile.
 */
ipcMain.handle('characters:save', (_event, campaignPath: string, character: CharacterProfile): CharacterProfile => {
  return saveCharacter(campaignPath, character)
})

/**
 * Characters: delete one campaign-scoped character.
 */
ipcMain.handle('characters:delete', (_event, campaignPath: string, characterId: string): void => {
  deleteStoredCharacter(campaignPath, characterId)
})

/**
 * Relationships: load the campaign relationship graph from disk.
 */
ipcMain.handle('relationships:get', (_event, campaignPath: string, campaignId: string): RelationshipGraph | null => {
  return loadRelationshipGraph(campaignPath, campaignId)
})

/**
 * Relationships: persist the campaign relationship graph to disk.
 */
ipcMain.handle('relationships:set', (_event, campaignPath: string, graph: RelationshipGraph): void => {
  saveRelationshipGraph(campaignPath, graph)
})

/**
 * Relationships: run LLM analysis and return merged graph without saving.
 */
ipcMain.handle(
  'relationships:refresh',
  async (
    _event,
    campaignPath: string,
    campaignId: string,
    characters: CharacterProfile[],
    sessions: Session[],
  ): Promise<RelationshipGraph> => {
    const settings = loadSettings()
    const validIds = new Set(characters.map((c) => c.id))
    const transcript = buildRelationshipTranscript(sessions)

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You analyse roleplay transcripts and extract character relationship states.

For each directed character pair (A→B), output a JSON array of relationship entries.
Each entry must have:
- fromCharacterId (string, exact character ID from the provided character list)
- toCharacterId (string, exact character ID from the provided character list)
- trustScore (integer 0–100)
- affinityLabel (one of: hostile, wary, neutral, friendly, allied, devoted)
- summary (1–3 sentences: how A currently perceives or feels toward B, grounded in transcript events only)

Base all values strictly on evidence in the transcripts.
Do not invent events or relationships not evidenced in the transcripts.
Output only a valid JSON array. No explanation, no markdown, no wrapper text.`,
      },
      {
        role: 'user',
        content: `Characters:\n${characters.map((c) => `${c.id}: ${c.name}`).join('\n')}\n\nTranscripts (all sessions, oldest first):\n${transcript}\n\nGenerate relationship entries for all directed pairs where both characters appear in the transcripts.`,
      },
    ]

    const raw = await fetchRelationshipCompletion(messages, settings)
    const validated = parseRelationshipEntries(raw, validIds)
    const existing = loadRelationshipGraph(campaignPath, campaignId)
    return mergeRelationshipEntries(existing, campaignId, validated)
  },
)

/**
 * Avatars: list globally stored reusable avatars.
 */
ipcMain.handle('avatars:list', (): ReusableAvatar[] => {
  return loadReusableAvatars()
})

/**
 * Avatars: create or update one reusable avatar in the global library.
 */
ipcMain.handle('avatars:save', (_event, avatar: ReusableAvatar): ReusableAvatar => {
  return saveReusableAvatar(avatar)
})

/**
 * Avatars: delete one reusable avatar from the global library.
 */
ipcMain.handle('avatars:delete', (_event, avatarId: string): void => {
  deleteReusableAvatar(avatarId)
})

/**
 * Characters: list globally stored reusable characters.
 */
ipcMain.handle('characters:reusable:list', (): ReusableCharacter[] => {
  return loadReusableCharacters()
})

/**
 * Characters: create or update one reusable character in the global library.
 */
ipcMain.handle('characters:reusable:save', (_event, character: ReusableCharacter): ReusableCharacter => {
  return saveReusableCharacter(character)
})

/**
 * Characters: delete one reusable character from the global library.
 */
ipcMain.handle('characters:reusable:delete', (_event, characterId: string): void => {
  deleteReusableCharacter(characterId)
})

/** Window controls: read state */
ipcMain.handle('window:get-state', (event): WindowControlsState => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return {
      platform: process.platform as WindowControlsState['platform'],
      isMaximized: false,
    }
  }

  return getWindowState(win)
})

/** Window controls: minimize */
ipcMain.handle('window:minimize', (event): void => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})

/** Window controls: maximize/restore */
ipcMain.handle('window:toggle-maximize', (event): void => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return

  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
})

/** Window controls: close */
ipcMain.handle('window:close', (event): void => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

/**
 * AI streaming.
 * Renderer sends { id, messages, serverId, modelSlug }.
 * Main pushes back: ai:chunk(id, text) | ai:usage(id, usage) | ai:done(id) | ai:error(id, msg)
 */
ipcMain.on('ai:stream', async (event, payload: {
  id:         string
  messages:   ChatMessage[]
  serverId:   string | null
  modelSlug:  string | null
}) => {
  const { id, messages, serverId, modelSlug } = payload
  const settings = loadSettings({ syncLocalModels: false })

  const server =
    settings.servers.find((s) => s.id === serverId) ??
    settings.servers.find((s) => s.id === settings.activeServerId) ??
    settings.servers[0]

  if (!server) {
    event.sender.send('ai:error', id, 'No server configured. Open Settings to add one.')
    return
  }

  if (isLocalLlamaServer(server) && localRuntimeStatus.state !== 'running') {
    event.sender.send('ai:error', id, 'The local llama.cpp model is not loaded. Open Load Model and start a local model first.')
    return
  }

  const slug = modelSlug ?? settings.activeModelSlug ?? server.id
  const activeModel = settings.models.find((candidate) =>
    candidate.serverId === server.id && candidate.slug === slug,
  )
  const promptEstimate = estimatePromptTokens(messages)
  const contextWindowTokens =
    typeof activeModel?.contextWindowTokens === 'number' && activeModel.contextWindowTokens > 0
      ? activeModel.contextWindowTokens
      : null
  const temperature =
    typeof activeModel?.temperature === 'number' && Number.isFinite(activeModel.temperature) && activeModel.temperature >= 0
      ? activeModel.temperature
      : null
  const topP =
    typeof activeModel?.topP === 'number' && Number.isFinite(activeModel.topP) && activeModel.topP >= 0 && activeModel.topP <= 1
      ? activeModel.topP
      : null
  const topK =
    typeof activeModel?.topK === 'number' && Number.isFinite(activeModel.topK) && activeModel.topK >= 0
      ? Math.floor(activeModel.topK)
      : null
  const repeatPenalty =
    typeof activeModel?.repeatPenalty === 'number' && Number.isFinite(activeModel.repeatPenalty) && activeModel.repeatPenalty >= 0
      ? Number(activeModel.repeatPenalty.toFixed(2))
      : null
  const presencePenalty =
    typeof activeModel?.presencePenalty === 'number' &&
    Number.isFinite(activeModel.presencePenalty) &&
    activeModel.presencePenalty >= -2 &&
    activeModel.presencePenalty <= 2
      ? activeModel.presencePenalty
      : null
  const frequencyPenalty =
    typeof activeModel?.frequencyPenalty === 'number' &&
    Number.isFinite(activeModel.frequencyPenalty) &&
    activeModel.frequencyPenalty >= -2 &&
    activeModel.frequencyPenalty <= 2
      ? activeModel.frequencyPenalty
      : null
  const configuredMaxOutputTokens =
    typeof activeModel?.maxOutputTokens === 'number' &&
    Number.isFinite(activeModel.maxOutputTokens) &&
    activeModel.maxOutputTokens > 0
      ? Math.floor(activeModel.maxOutputTokens)
      : null
  const maxTokens = contextWindowTokens === null
    ? configuredMaxOutputTokens
    : Math.max(1, Math.min(configuredMaxOutputTokens ?? 512, contextWindowTokens - promptEstimate))

  const debug = (direction: AiDebugEntry['direction'], label: string, details: unknown) => {
    recordAiDebugEntry(event.sender, direction, label, {
      serverId: server.id,
      serverName: server.name,
      model: slug,
      ...((isRecord(details) ? details : { value: details })),
    })
  }

  debug('info', 'ai.stream.start', {
    requestId: id,
    messageCount: messages.length,
    promptEstimate,
    contextWindowTokens,
    temperature,
    topP,
    topK,
    repeatPenalty,
    presencePenalty,
    frequencyPenalty,
    configuredMaxOutputTokens,
    maxTokens,
  })

  try {
    for await (const item of streamServerChat(
      server,
      slug,
      messages,
      contextWindowTokens,
      temperature,
      topP,
      topK,
      repeatPenalty,
      presencePenalty,
      frequencyPenalty,
      maxTokens,
      debug,
    )) {
      if (event.sender.isDestroyed()) return

      if (item.chunk) {
        event.sender.send('ai:chunk', id, item.chunk)
      }

      if (item.usage) {
        event.sender.send('ai:usage', id, item.usage)
      }
    }
    debug('info', 'ai.stream.done', { requestId: id })
    if (!event.sender.isDestroyed()) event.sender.send('ai:done', id)
  } catch (err) {
    debug('error', 'ai.stream.error', {
      requestId: id,
      message: err instanceof Error ? err.message : String(err),
    })
    if (!event.sender.isDestroyed()) event.sender.send('ai:error', id, String(err))
  }
})

/* ── Window ────────────────────────────────────────────────────────────── */

/**
 * Create the main application window.
 */
function createWindow(): void {
  const persistedWindowState = loadWindowState()
  const placement = getWindowPlacement(persistedWindowState)
  const win = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    x: placement.x,
    y: placement.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,                    // reveal only after paint
    frame: false,
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  win.on('maximize', () => broadcastWindowState(win))
  win.on('unmaximize', () => broadcastWindowState(win))
  win.on('enter-full-screen', () => broadcastWindowState(win))
  win.on('leave-full-screen', () => broadcastWindowState(win))
  win.on('move', () => {
    if (!win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) {
      saveWindowState(getPersistedWindowState(win))
    }
  })
  win.on('resize', () => {
    if (!win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) {
      saveWindowState(getPersistedWindowState(win))
    }
  })
  win.on('close', () => saveWindowState(getPersistedWindowState(win)))

  win.once('ready-to-show', () => {
    if (persistedWindowState.isMaximized) {
      win.maximize()
    }
    win.show()
  })
  win.webContents.once('did-finish-load', () => broadcastWindowState(win))

  // Open <a target="_blank"> in the system browser, not a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ── App lifecycle ─────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
