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

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { basename, join }                    from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'

import type {
  AppSettings,
  AiDebugEntry,
  AvailableModel,
  Campaign,
  CampaignFileHandle,
  CampaignSummary,
  ChatTextSize,
  CharacterProfile,
  ServerProfile,
  ModelPreset,
  Session,
  ChatMessage,
  TokenUsage,
  ThemeDefinition,
  WindowControlsState,
} from '../../src/types'

import defaultServersRaw from './defaults/servers.json'
import defaultModelsRaw  from './defaults/models.json'

const defaultServers = defaultServersRaw as ServerProfile[]
const defaultModels  = defaultModelsRaw  as ModelPreset[]
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 600
const MAX_AI_DEBUG_ENTRIES = 200

/** In-memory rolling log of AI transport debug events. */
const aiDebugLog: AiDebugEntry[] = []

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
  content?: unknown
  timestamp?: unknown
}

/**
 * Lightweight session shape used to validate campaign files from disk.
 */
interface PartialSessionRecord {
  id?: unknown
  title?: unknown
  messages?: unknown
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
 * Normalize settings loaded from disk so newer required fields always exist.
 *
 * @param raw - Parsed settings candidate from disk.
 * @returns A fully populated AppSettings object.
 */
function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const persistedServers = Array.isArray(raw?.servers) ? raw.servers : []
  const persistedModels = Array.isArray(raw?.models) ? raw.models : []
  const mergedServers = [
    ...persistedServers,
    ...defaultServers.filter(
      (defaultServer) => !persistedServers.some((server) => server.id === defaultServer.id),
    ),
  ]
  const mergedModels = [
    ...persistedModels,
    ...defaultModels.filter(
      (defaultModel) => !persistedModels.some((model) => model.id === defaultModel.id),
    ),
  ]

  return {
    servers: mergedServers,
    models: mergedModels,
    activeServerId: raw?.activeServerId ?? mergedServers[0]?.id ?? null,
    activeModelSlug: raw?.activeModelSlug ?? mergedModels[0]?.slug ?? null,
    systemPrompt: typeof raw?.systemPrompt === 'string'
      ? raw.systemPrompt
      : 'You are a roleplaying agent responding naturally to the user.',
    chatTextSize: isChatTextSize(raw?.chatTextSize) ? raw.chatTextSize : 'small',
    activeThemeId: typeof raw?.activeThemeId === 'string' ? raw.activeThemeId : 'default',
    customThemes: Array.isArray(raw?.customThemes) ? raw.customThemes as ThemeDefinition[] : [],
  }
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
    messages,
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
    goals: character.goals,
    controlledBy: character.controlledBy,
    updatedAt: now,
  }

  writeFileSync(characterFilePath(folderPath, folderName), JSON.stringify(normalizedCharacter, null, 2), 'utf-8')
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
    controlledBy: 'ai',
    createdAt: now,
    updatedAt: now,
  }

  return saveCharacter(folderPath, character)
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
function loadCampaignFile(folderPath: string): CampaignFileHandle {
  const fallbackName = basename(folderPath)
  const rawText = readFileSync(campaignFilePath(folderPath), 'utf-8')

  let campaign: Campaign

  try {
    const campaignRecord = normalizeCampaignRecord(JSON.parse(rawText) as unknown, fallbackName)
    const chatsPath = campaignChatsPath(folderPath)
    const sessions = campaignRecord.sessions.flatMap((sessionRef, index) => {
      try {
        const sessionRaw = JSON.parse(
          readFileSync(join(chatsPath, sessionRef.fileName), 'utf-8'),
        ) as unknown
        return [normalizeSession(sessionRaw as PartialSessionRecord, campaignRecord.createdAt + index)]
      } catch {
        return []
      }
    })

    campaign = {
      ...campaignRecord,
      sessions,
    }
  } catch {
    campaign = normalizeCampaign(JSON.parse(rawText) as unknown, fallbackName)
  }

  return { path: folderPath, campaign }
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

/**
 * Load settings from disk, falling back to built-in defaults on first run
 * or if the file is corrupted.
 */
function loadSettings(): AppSettings {
  const path = settingsPath()
  if (existsSync(path)) {
    try {
      return normalizeSettings(JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>)
    } catch {
      // Corrupted — fall through to defaults
    }
  }
  return normalizeSettings(undefined)
}

/**
 * Persist settings to disk.
 * @param settings - The full settings object to save.
 */
function saveSettings(settings: AppSettings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Detect whether a server profile should use LM Studio's native chat API.
 *
 * @param server - Server profile selected for the request.
 * @returns True when the native LM Studio transport should be used.
 */
function isLmStudioServer(server: ServerProfile): boolean {
  return server.id === 'lmstudio-default' || server.name.trim().toLowerCase() === 'lm studio'
}

/**
 * Detect whether a server profile is text-generation-webui.
 *
 * @param server - Server profile selected for the request.
 * @returns True when the text-generation-webui-specific endpoints should be used.
 */
function isTextGenerationWebUiServer(server: ServerProfile): boolean {
  return (
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
  maxTokens: number | null,
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      flushAggregatedContentDebug()
      break
    }

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
        const content = json.choices?.[0]?.delta?.content
        if (content) {
          aggregatedContent += content
          yield { chunk: content }
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
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
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
  }

  logger?.('request', 'lmstudio.chat.request', {
    url: endpoint,
    body: requestBody,
  })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

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
  maxTokens: number | null,
  logger?: (direction: AiDebugEntry['direction'], label: string, payload: unknown) => void,
): AsyncGenerator<{ chunk?: string, usage?: TokenUsage }> {
  if (isLmStudioServer(server)) {
    try {
      logger?.('info', 'lmstudio.transport.selected', {
        serverId: server.id,
        baseUrl: server.baseUrl,
      })
      yield* streamLmStudioChat(server.baseUrl, server.apiKey, model, messages, logger)
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
    maxTokens,
  })
  yield* streamChat(server, server.baseUrl, server.apiKey, model, messages, contextWindowTokens, temperature, maxTokens, logger)
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

  return Math.max(1, Math.ceil(serialized.length / 3))
}

/**
 * Query an OpenAI-compatible server for its advertised model catalog.
 *
 * @param server - Server profile to inspect.
 * @returns Discovered models normalized for the renderer.
 */
async function browseServerModels(server: ServerProfile): Promise<AvailableModel[]> {
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
      .map((modelName) => ({
        id: `${server.id}:${modelName}`,
        serverId: server.id,
        name: modelName,
        slug: modelName,
      }))
  }

  const rawModels = Array.isArray(json) ? json : (json.data ?? [])

  return rawModels
    .filter((model): model is Record<string, unknown> & { id: string } => typeof model.id === 'string' && model.id.length > 0)
    .map((model) => ({
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

/* ── IPC handlers ──────────────────────────────────────────────────────── */

/** Settings: read */
ipcMain.handle('settings:get', (): AppSettings => loadSettings())

/** Settings: write */
ipcMain.handle('settings:set', (_event, settings: AppSettings): void => {
  saveSettings(settings)
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

  return browseServerModels(server)
})

/**
 * Models: ask the configured server to load a model into memory.
 */
ipcMain.handle(
  'models:load',
  async (_event, serverId: string, modelName: string, contextWindowTokens: number): Promise<void> => {
    const settings = loadSettings()
    const server = settings.servers.find((candidate) => candidate.id === serverId)

    if (!server) {
      throw new Error('Selected server could not be found.')
    }

    await loadServerModel(server, modelName, contextWindowTokens)
  },
)

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
  return loadCampaignFile(path)
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
  const settings = loadSettings()

  const server =
    settings.servers.find((s) => s.id === serverId) ??
    settings.servers.find((s) => s.id === settings.activeServerId) ??
    settings.servers[0]

  if (!server) {
    event.sender.send('ai:error', id, 'No server configured. Open Settings to add one.')
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
  const maxTokens = contextWindowTokens === null
    ? null
    : Math.max(1, Math.min(512, contextWindowTokens - promptEstimate))

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
    maxTokens,
  })

  try {
    for await (const item of streamServerChat(server, slug, messages, contextWindowTokens, temperature, maxTokens, debug)) {
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
