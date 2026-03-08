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
import { join }                                from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

import type {
  AppSettings,
  AvailableModel,
  ServerProfile,
  ModelPreset,
  ChatMessage,
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
  return {
    servers: Array.isArray(raw?.servers) ? raw.servers : defaultServers,
    models: Array.isArray(raw?.models) ? raw.models : defaultModels,
    activeServerId: raw?.activeServerId ?? defaultServers[0]?.id ?? null,
    activeModelSlug: raw?.activeModelSlug ?? defaultModels[0]?.slug ?? null,
    systemPrompt: typeof raw?.systemPrompt === 'string'
      ? raw.systemPrompt
      : 'You are a roleplaying agent responding naturally to the user.',
    activeThemeId: typeof raw?.activeThemeId === 'string' ? raw.activeThemeId : 'default',
    customThemes: Array.isArray(raw?.customThemes) ? raw.customThemes as ThemeDefinition[] : [],
  }
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
  baseUrl:  string,
  apiKey:   string,
  model:    string,
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }

  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let   buffer  = ''

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
        const json    = JSON.parse(data) as { choices?: [{ delta?: { content?: string } }] }
        const content = json.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {
        // Skip malformed SSE lines
      }
    }
  }
}

/**
 * Query an OpenAI-compatible server for its advertised model catalog.
 *
 * @param server - Server profile to inspect.
 * @returns Discovered models normalized for the renderer.
 */
async function browseServerModels(server: ServerProfile): Promise<AvailableModel[]> {
  const response = await fetch(`${server.baseUrl}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${server.apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }

  const json = await response.json() as {
    data?: Array<{ id?: string }>
  }

  return (json.data ?? [])
    .filter((model): model is { id: string } => typeof model.id === 'string' && model.id.length > 0)
    .map((model) => ({
      id: `${server.id}:${model.id}`,
      serverId: server.id,
      name: model.id,
      slug: model.id,
    }))
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
 * Main pushes back: ai:chunk(id, text) | ai:done(id) | ai:error(id, msg)
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

  try {
    for await (const chunk of streamChat(server.baseUrl, server.apiKey, slug, messages)) {
      if (event.sender.isDestroyed()) return
      event.sender.send('ai:chunk', id, chunk)
    }
    if (!event.sender.isDestroyed()) event.sender.send('ai:done', id)
  } catch (err) {
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
