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

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join }                                from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

import type { AppSettings, ServerProfile, ModelPreset, ChatMessage, ThemeDefinition } from '../../src/types'

import defaultServersRaw from './defaults/servers.json'
import defaultModelsRaw  from './defaults/models.json'

const defaultServers = defaultServersRaw as ServerProfile[]
const defaultModels  = defaultModelsRaw  as ModelPreset[]

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
    activeThemeId: typeof raw?.activeThemeId === 'string' ? raw.activeThemeId : 'default',
    customThemes: Array.isArray(raw?.customThemes) ? raw.customThemes as ThemeDefinition[] : [],
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

/* ── IPC handlers ──────────────────────────────────────────────────────── */

/** Settings: read */
ipcMain.handle('settings:get', (): AppSettings => loadSettings())

/** Settings: write */
ipcMain.handle('settings:set', (_event, settings: AppSettings): void => {
  saveSettings(settings)
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
  const win = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  800,
    minHeight: 600,
    show: false,                    // reveal only after paint
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  win.once('ready-to-show', () => win.show())

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
