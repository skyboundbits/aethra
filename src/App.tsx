/**
 * src/App.tsx
 * Root application component for Aethra.
 *
 * Owns all top-level state:
 *   - sessions      : list of roleplay sessions
 *   - activeSession : which session is currently open
 *   - inputValue    : current text in the composer
 *   - isStreaming   : true while an AI response is in-flight
 *   - activeTab     : which ribbon nav tab is selected
 *
 * Renders the ribbon bar above the three-column floating layout:
 *   RibbonBar (top) | Sidebar | ChatArea + InputBar | DetailsPanel
 */

import { useEffect, useState } from 'react'
import './styles/global.css'
import './styles/layout.css'

import { RibbonBar }    from './components/RibbonBar'
import { Sidebar }      from './components/Sidebar'
import { ChatArea }     from './components/ChatArea'
import { InputBar }     from './components/InputBar'
import { DetailsPanel } from './components/DetailsPanel'
import { SettingsModal } from './components/SettingsModal'

import { streamCompletion } from './services/aiService'
import { applyTheme, parseImportedTheme, upsertCustomTheme } from './services/themeService'

import type { AppSettings, Session, Message, ChatMessage } from './types'

const DEFAULT_SETTINGS: AppSettings = {
  servers: [],
  models: [],
  activeServerId: null,
  activeModelSlug: null,
  activeThemeId: 'default',
  customThemes: [],
}

/**
 * Generate a lightweight unique ID.
 * Combines a timestamp with a short random hex string.
 * (Replace with crypto.randomUUID() if broader support is needed.)
 */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/**
 * Convert internal Message array to the chat format expected by the AI service.
 * @param messages - Internal message list.
 */
function toApiMessages(messages: Message[]): ChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

/**
 * App
 * Top-level component that wires together all panels and manages state.
 */
export default function App() {
  /* ── State ──────────────────────────────────────────────────────────── */

  /** All roleplay sessions available in the sidebar. */
  const [sessions, setSessions] = useState<Session[]>([])

  /** ID of the session currently displayed in the chat area. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  /** Controlled value for the message composer textarea. */
  const [inputValue, setInputValue] = useState('')

  /** True while a streaming AI response is in-flight. */
  const [isStreaming, setIsStreaming] = useState(false)

  /** Currently active ribbon navigation tab. */
  const [activeTab, setActiveTab] = useState('chat')

  /** Persisted app settings loaded from Electron. */
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  /** True while the settings modal is open. */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  /** Status message shown in the settings modal. */
  const [settingsStatusMessage, setSettingsStatusMessage] = useState<string | null>(null)

  /** Visual state of the settings modal status message. */
  const [settingsStatusKind, setSettingsStatusKind] = useState<'error' | 'success' | null>(null)

  /**
   * Load persisted settings on first render.
   */
  useEffect(() => {
    let cancelled = false

    /**
     * Read settings from the main process and seed local state.
     */
    async function loadSettings(): Promise<void> {
      try {
        const settings = await window.api.getSettings()
        if (!cancelled) {
          setAppSettings(settings)
        }
      } catch (err) {
        console.error('[Aethra] Could not load app settings:', err)
        if (!cancelled) {
          setSettingsStatusKind('error')
          setSettingsStatusMessage('Could not load settings. Using in-memory defaults.')
        }
      }
    }

    loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Apply the currently active theme whenever theme settings change.
   */
  useEffect(() => {
    applyTheme(appSettings.activeThemeId, appSettings.customThemes)
  }, [appSettings.activeThemeId, appSettings.customThemes])

  /* ── Derived values ─────────────────────────────────────────────────── */

  /** The full session object for the active session (or null). */
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  /** Messages belonging to the active session. */
  const messages: Message[] = activeSession?.messages ?? []

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  /**
   * Append or update a message inside a specific session.
   * If a message with `msg.id` already exists it is replaced; otherwise appended.
   * @param sessionId - Target session.
   * @param msg       - Message to upsert.
   */
  function upsertMessage(sessionId: string, msg: Message) {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const exists = s.messages.some((m) => m.id === msg.id)
        const messages = exists
          ? s.messages.map((m) => (m.id === msg.id ? msg : m))
          : [...s.messages, msg]
        return { ...s, messages, updatedAt: Date.now() }
      }),
    )
  }

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty session, add it to the list, and make it active.
   */
  function handleNewSession() {
    const now = Date.now()
    const newSession: Session = {
      id:        uid(),
      title:     `Session ${sessions.length + 1}`,
      messages:  [],
      createdAt: now,
      updatedAt: now,
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
  }

  /**
   * Switch the active session.
   * @param id - ID of the session to activate.
   */
  function handleSelectSession(id: string) {
    setActiveSessionId(id)
  }

  /**
   * Persist settings to the main process and keep local state in sync.
   *
   * @param nextSettings - Fully updated app settings object.
   */
  async function persistSettings(nextSettings: AppSettings): Promise<void> {
    setAppSettings(nextSettings)
    await window.api.saveSettings(nextSettings)
  }

  /**
   * Handle top-level ribbon tab changes.
   * Opens the settings modal instead of navigating away from the chat layout.
   *
   * @param tabId - Selected tab identifier.
   */
  function handleTabChange(tabId: string): void {
    if (tabId === 'settings') {
      setSettingsStatusKind(null)
      setSettingsStatusMessage(null)
      setIsSettingsOpen(true)
      return
    }

    setActiveTab(tabId)
  }

  /**
   * Close the settings modal.
   */
  function handleCloseSettings(): void {
    setIsSettingsOpen(false)
  }

  /**
   * Select and persist the active app theme.
   *
   * @param themeId - Built-in or imported theme ID.
   */
  async function handleThemeSelect(themeId: string): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      activeThemeId: themeId,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Theme updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected theme:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save theme selection.')
    }
  }

  /**
   * Import a user-downloaded theme JSON file, save it, and make it active.
   *
   * @param file - Uploaded theme file chosen in the settings modal.
   */
  async function handleImportTheme(file: File): Promise<void> {
    try {
      const rawText = await file.text()
      const parsed = parseImportedTheme(JSON.parse(rawText) as unknown)
      const nextSettings: AppSettings = {
        ...appSettings,
        customThemes: upsertCustomTheme(appSettings.customThemes, parsed),
        activeThemeId: parsed.id,
      }

      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Imported "${parsed.name}" and applied it.`)
    } catch (err) {
      console.error('[Aethra] Theme import failed:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Theme import failed.')
    }
  }

  /**
   * Append the current input as a user message, then stream the AI response.
   * The assistant message is created immediately with empty content and updated
   * chunk-by-chunk as the stream arrives.
   */
  function handleSend() {
    if (!inputValue.trim() || !activeSessionId || isStreaming) return

    const sessionId = activeSessionId

    const userMessage: Message = {
      id:        uid(),
      role:      'user',
      content:   inputValue.trim(),
      timestamp: Date.now(),
    }

    // Snapshot the message history *before* appending the user message so we
    // can build the API payload without relying on stale state.
    const historySnapshot = toApiMessages([...messages, userMessage])

    upsertMessage(sessionId, userMessage)
    setInputValue('')
    setIsStreaming(true)

    // Create a placeholder assistant message that will be filled by the stream.
    const assistantId = uid()
    const assistantMessage: Message = {
      id:        assistantId,
      role:      'assistant',
      content:   '',
      timestamp: Date.now(),
    }
    upsertMessage(sessionId, assistantMessage)

    // Accumulate streamed text outside React state to avoid excessive re-renders,
    // then push the full string on each chunk.
    let accumulated = ''

    streamCompletion(
      historySnapshot,
      /* onToken */ (chunk) => {
        accumulated += chunk
        upsertMessage(sessionId, { ...assistantMessage, content: accumulated })
      },
      /* onDone */ () => {
        setIsStreaming(false)
      },
      /* onError */ (err) => {
        console.error('[Aethra] AI stream error:', err)
        upsertMessage(sessionId, {
          ...assistantMessage,
          content: '⚠️ Could not reach the AI server. Is LM Studio running?',
        })
        setIsStreaming(false)
      },
    )
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="app-root">
      {/* Top navigation ribbon */}
      <RibbonBar activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Three-column panel layout */}
      <div className="app-layout">
        {/* Left column: session navigator */}
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
        />

        {/* Centre column: chat feed + composer */}
        <main className="panel panel--chat">
          <ChatArea messages={messages} />
          <InputBar
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            disabled={activeSession === null || isStreaming}
          />
        </main>

        {/* Right column: session details */}
        <DetailsPanel activeSession={activeSession} />
      </div>

      {isSettingsOpen ? (
        <SettingsModal
          activeThemeId={appSettings.activeThemeId}
          customThemes={appSettings.customThemes}
          statusMessage={settingsStatusMessage}
          statusKind={settingsStatusKind}
          onClose={handleCloseSettings}
          onThemeSelect={(themeId) => {
            void handleThemeSelect(themeId)
          }}
          onImportTheme={(file) => {
            void handleImportTheme(file)
          }}
        />
      ) : null}
    </div>
  )
}
