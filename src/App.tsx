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

import { useEffect, useRef, useState } from 'react'
import './styles/global.css'
import './styles/layout.css'

import { RibbonBar }    from './components/RibbonBar'
import { Sidebar }      from './components/Sidebar'
import { ChatArea }     from './components/ChatArea'
import { InputBar }     from './components/InputBar'
import { DetailsPanel } from './components/DetailsPanel'
import { SettingsModal } from './components/SettingsModal'
import { TitleBar } from './components/TitleBar'
import { SystemPromptModal } from './components/SystemPromptModal'
import { CampaignLauncher } from './components/CampaignLauncher'
import { CreateCampaignModal } from './components/CreateCampaignModal'

import { streamCompletion } from './services/aiService'
import { applyTheme, parseImportedTheme, upsertCustomTheme } from './services/themeService'

import type {
  AppSettings,
  AvailableModel,
  Campaign,
  CampaignSummary,
  Message,
  ChatMessage,
  ModelPreset,
  Session,
} from './types'

const DEFAULT_SETTINGS: AppSettings = {
  servers: [],
  models: [],
  activeServerId: null,
  activeModelSlug: null,
  systemPrompt: 'You are a roleplaying agent responding naturally to the user.',
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
 * Build a readable default session title from the first user message.
 *
 * @param input - Raw user input.
 * @returns Trimmed single-line title.
 */
function buildSessionTitle(input: string): string {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0) return 'New Chat'
  return normalized.slice(0, 40)
}

/**
 * App
 * Top-level component that wires together all panels and manages state.
 */
export default function App() {
  /* ── State ──────────────────────────────────────────────────────────── */

  /** Active campaign currently open in the workspace. */
  const [campaign, setCampaign] = useState<Campaign | null>(null)

  /** Absolute path of the active campaign folder. */
  const [campaignPath, setCampaignPath] = useState<string | null>(null)

  /** ID of the session currently displayed in the chat area. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  /** Controlled value for the message composer textarea. */
  const [inputValue, setInputValue] = useState('')

  /** True while a streaming AI response is in-flight. */
  const [isStreaming, setIsStreaming] = useState(false)

  /** Currently active ribbon navigation tab. */
  const [activeTab, setActiveTab] = useState('campaign')

  /** Persisted app settings loaded from Electron. */
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  /** True while the settings modal is open. */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  /** True while the system prompt editor modal is open. */
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false)

  /** Status message shown in the settings modal. */
  const [settingsStatusMessage, setSettingsStatusMessage] = useState<string | null>(null)

  /** Visual state of the settings modal status message. */
  const [settingsStatusKind, setSettingsStatusKind] = useState<'error' | 'success' | null>(null)

  /** Models discovered live from the active server in the settings UI. */
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])

  /** True while fetching the remote model catalog from the active server. */
  const [isBrowsingModels, setIsBrowsingModels] = useState(false)

  /** True while a campaign file operation is in progress. */
  const [isCampaignBusy, setIsCampaignBusy] = useState(false)

  /** Status message shown in the campaign launcher. */
  const [campaignStatusMessage, setCampaignStatusMessage] = useState<string | null>(null)

  /** Campaign summaries available to open from the launcher. */
  const [availableCampaigns, setAvailableCampaigns] = useState<CampaignSummary[]>([])

  /** True while the create campaign modal is open. */
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false)

  /** Last serialized campaign that was successfully saved to disk. */
  const lastSavedCampaignRef = useRef<string | null>(null)

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

  /**
   * Load the stored campaign catalog for the launcher on first render.
   */
  useEffect(() => {
    void refreshCampaigns()
  }, [])

  /* ── Derived values ─────────────────────────────────────────────────── */

  /** All roleplay sessions available in the sidebar. */
  const sessions = campaign?.sessions ?? []

  /** The full session object for the active session (or null). */
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  /** Messages belonging to the active session. */
  const messages: Message[] = activeSession?.messages ?? []

  /** The currently selected AI server from persisted settings. */
  const activeServer =
    appSettings.servers.find((server) => server.id === appSettings.activeServerId) ??
    appSettings.servers[0] ??
    null

  /** Model presets available for the active server. */
  const activeServerModels: ModelPreset[] = activeServer
    ? appSettings.models.filter((model) => model.serverId === activeServer.id)
    : []

  /** The currently selected AI model from persisted settings. */
  const activeModel =
    activeServerModels.find((model) => model.slug === appSettings.activeModelSlug) ??
    activeServerModels[0] ??
    null

  /**
   * Keep the temporary discovered model list scoped to the current server.
   */
  useEffect(() => {
    setAvailableModels((prev) =>
      activeServer ? prev.filter((model) => model.serverId === activeServer.id) : [],
    )
  }, [activeServer?.id])

  /**
   * Keep the active session selection valid whenever the campaign changes.
   */
  useEffect(() => {
    if (!campaign) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      return
    }

    if (campaign.sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      return
    }

    const hasActiveSession = campaign.sessions.some((session) => session.id === activeSessionId)
    if (!hasActiveSession) {
      setActiveSessionId(campaign.sessions[0].id)
    }
  }, [activeSessionId, campaign])

  /**
   * Autosave the active campaign whenever its contents change after load.
   */
  useEffect(() => {
    if (!campaign || !campaignPath) {
      return
    }

    const serialized = JSON.stringify(campaign)
    if (lastSavedCampaignRef.current === serialized) {
      return
    }

    void window.api.saveCampaign(campaignPath, campaign)
      .then(() => {
        lastSavedCampaignRef.current = serialized
      })
      .catch((err) => {
        console.error('[Aethra] Could not save campaign:', err)
        setCampaignStatusMessage('Could not save the active campaign.')
      })
  }, [campaign, campaignPath])

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  /**
   * Replace the current campaign with an updated copy and refresh metadata.
   *
   * @param updater - Receives the previous campaign and returns the next one.
   */
  function updateCampaign(updater: (prev: Campaign) => Campaign): void {
    setCampaign((prev) => {
      if (!prev) {
        return prev
      }

      const nextCampaign = updater(prev)
      return {
        ...nextCampaign,
        updatedAt: Date.now(),
      }
    })
  }

  /**
   * Refresh the stored campaign catalog shown in the launcher.
   */
  async function refreshCampaigns(): Promise<void> {
    try {
      const campaigns = await window.api.listCampaigns()
      setAvailableCampaigns(campaigns)
    } catch (err) {
      console.error('[Aethra] Could not list campaigns:', err)
      setCampaignStatusMessage('Could not load saved campaigns.')
    }
  }

  /**
   * Append or update a message inside a specific session.
   * If a message with `msg.id` already exists it is replaced; otherwise appended.
   * @param sessionId - Target session.
   * @param msg       - Message to upsert.
   */
  function upsertMessage(sessionId: string, msg: Message): void {
    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const exists = s.messages.some((m) => m.id === msg.id)
        const messages = exists
          ? s.messages.map((m) => (m.id === msg.id ? msg : m))
          : [...s.messages, msg]
        return { ...s, messages, updatedAt: Date.now() }
      }),
    }))
  }

  /**
   * Ensure there is an active session to receive messages.
   *
   * @returns Active session ID, creating a new session if necessary.
   */
  function ensureActiveSession(): string {
    if (activeSessionId) {
      return activeSessionId
    }

    const now = Date.now()
    const newSession: Session = {
      id: uid(),
      title: 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }

    updateCampaign((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
    }))
    setActiveSessionId(newSession.id)
    return newSession.id
  }

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty session, add it to the list, and make it active.
   */
  function handleNewSession(): void {
    const now = Date.now()
    const newSession: Session = {
      id:        uid(),
      title:     `Session ${sessions.length + 1}`,
      messages:  [],
      createdAt: now,
      updatedAt: now,
    }
    updateCampaign((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
    }))
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
   * Open the create campaign dialog.
   */
  function handleCreateCampaign(): void {
    setCampaignStatusMessage(null)
    setIsCreateCampaignOpen(true)
  }

  /**
   * Create a new campaign from modal input and load it into the workspace.
   *
   * @param name - Campaign name entered by the user.
   * @param description - Campaign description entered by the user.
   */
  async function handleCreateCampaignSubmit(name: string, description: string): Promise<void> {
    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)

    try {
      const created = await window.api.createCampaign(name, description)
      setCampaign(created.campaign)
      setCampaignPath(created.path)
      setActiveSessionId(created.campaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = JSON.stringify(created.campaign)
      setIsCreateCampaignOpen(false)
      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not create campaign:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not create campaign.')
    } finally {
      setIsCampaignBusy(false)
    }
  }

  /**
   * Open an existing stored campaign and load it into the workspace.
   *
   * @param path - Absolute campaign folder path selected in the launcher.
   */
  async function handleOpenCampaign(path: string): Promise<void> {
    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)

    try {
      const opened = await window.api.openCampaign(path)
      setCampaign(opened.campaign)
      setCampaignPath(opened.path)
      setActiveSessionId(opened.campaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = JSON.stringify(opened.campaign)
      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not open campaign:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not open campaign.')
    } finally {
      setIsCampaignBusy(false)
    }
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
   * Open the system prompt editor modal.
   */
  function handleOpenSystemPrompt(): void {
    setIsSystemPromptOpen(true)
  }

  /**
   * Close the system prompt editor modal.
   */
  function handleCloseSystemPrompt(): void {
    setIsSystemPromptOpen(false)
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
   * Persist the prompt prepended to every chat request.
   *
   * @param systemPrompt - Updated system prompt text.
   */
  async function handleSaveSystemPrompt(systemPrompt: string): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      systemPrompt,
    }

    try {
      await persistSettings(nextSettings)
      setIsSystemPromptOpen(false)
    } catch (err) {
      console.error('[Aethra] Could not save system prompt:', err)
    }
  }

  /**
   * Select and persist the active AI server, falling back to that server's
   * first available model if the current model does not belong to it.
   *
   * @param serverId - ID of the selected server profile.
   */
  async function handleServerSelect(serverId: string): Promise<void> {
    const selectedServer = appSettings.servers.find((server) => server.id === serverId)
    if (!selectedServer) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected server.')
      return
    }

    const serverModels = appSettings.models.filter((model) => model.serverId === selectedServer.id)
    const nextModelSlug = serverModels.some((model) => model.slug === appSettings.activeModelSlug)
      ? appSettings.activeModelSlug
      : (serverModels[0]?.slug ?? null)

    const nextSettings: AppSettings = {
      ...appSettings,
      activeServerId: selectedServer.id,
      activeModelSlug: nextModelSlug,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('AI server updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected server:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save AI server selection.')
    }
  }

  /**
   * Select and persist the active AI model.
   *
   * @param modelSlug - Slug of the selected model preset.
   */
  async function handleModelSelect(modelSlug: string): Promise<void> {
    const selectedModel = appSettings.models.find((model) => model.slug === modelSlug)
    if (!selectedModel) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected model.')
      return
    }

    const nextSettings: AppSettings = {
      ...appSettings,
      activeServerId: selectedModel.serverId,
      activeModelSlug: selectedModel.slug,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('AI model updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected model:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save AI model selection.')
    }
  }

  /**
   * Query the active server for its available models and persist the catalog
   * into settings so it remains selectable on future launches.
   */
  async function handleBrowseModels(): Promise<void> {
    if (!activeServer) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select a server before browsing models.')
      return
    }

    setIsBrowsingModels(true)

    try {
      const discoveredModels = await window.api.browseModels(activeServer.id)
      const persistedModels = discoveredModels.map((model) => ({
        id: model.id,
        serverId: model.serverId,
        name: model.name,
        slug: model.slug,
      }))

      const nextModels = [
        ...appSettings.models.filter((model) => model.serverId !== activeServer.id),
        ...persistedModels,
      ]

      const nextActiveModelSlug = discoveredModels.some((model) => model.slug === appSettings.activeModelSlug)
        ? appSettings.activeModelSlug
        : (discoveredModels[0]?.slug ?? null)

      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
        activeServerId: activeServer.id,
        activeModelSlug: nextActiveModelSlug,
      }

      setAvailableModels(discoveredModels)
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        discoveredModels.length > 0
          ? `Loaded ${discoveredModels.length} model${discoveredModels.length === 1 ? '' : 's'} from ${activeServer.name}.`
          : `No models were reported by ${activeServer.name}.`,
      )
    } catch (err) {
      console.error('[Aethra] Could not browse models:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not browse models.')
    } finally {
      setIsBrowsingModels(false)
    }
  }

  /**
   * Persist an updated base URL for the selected AI server profile.
   *
   * @param serverId - ID of the server profile to update.
   * @param baseUrl  - New OpenAI-compatible base URL.
   */
  async function handleServerAddressSave(serverId: string, baseUrl: string): Promise<void> {
    const trimmedBaseUrl = baseUrl.trim()
    if (!trimmedBaseUrl) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Server address cannot be empty.')
      return
    }

    const nextServers = appSettings.servers.map((server) =>
      server.id === serverId ? { ...server, baseUrl: trimmedBaseUrl } : server,
    )

    const nextSettings: AppSettings = {
      ...appSettings,
      servers: nextServers,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Server address updated.')
    } catch (err) {
      console.error('[Aethra] Could not save server address:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the server address.')
      throw err
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
    if (!campaign || !inputValue.trim() || isStreaming) return

    const trimmedInput = inputValue.trim()
    const sessionId = ensureActiveSession()
    const targetSession = campaign?.sessions.find((session) => session.id === sessionId) ?? null

    const userMessage: Message = {
      id:        uid(),
      role:      'user',
      content:   trimmedInput,
      timestamp: Date.now(),
    }

    // Snapshot the message history *before* appending the user message so we
    // can build the API payload without relying on stale state.
    const historySnapshot = [
      { role: 'system' as const, content: appSettings.systemPrompt },
      ...toApiMessages([...(targetSession?.messages ?? []), userMessage]),
    ]

    if (targetSession && targetSession.messages.length === 0) {
      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, title: buildSessionTitle(trimmedInput), updatedAt: Date.now() }
            : session,
        ),
      }))
    }

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
      <TitleBar title="Aethra" />

      {/* Top navigation ribbon */}
      <RibbonBar activeTab={activeTab} onTabChange={handleTabChange} />

      {campaign ? (
        <div className="app-layout">
          {/* Left column: session navigator */}
          <Sidebar
            campaignName={campaign.name}
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
              disabled={isStreaming}
            />
          </main>

          {/* Right column: session details */}
          <DetailsPanel
            activeSession={activeSession}
            activeServerName={activeServer?.name ?? null}
            activeModelName={activeModel?.name ?? null}
            systemPrompt={appSettings.systemPrompt}
            onOpenSystemPrompt={handleOpenSystemPrompt}
          />
        </div>
      ) : (
        <CampaignLauncher
          campaigns={availableCampaigns}
          isBusy={isCampaignBusy}
          statusMessage={campaignStatusMessage}
          onCreateCampaign={handleCreateCampaign}
          onOpenCampaign={(path) => {
            void handleOpenCampaign(path)
          }}
        />
      )}

      {isSettingsOpen ? (
        <SettingsModal
          servers={appSettings.servers}
          models={appSettings.models}
          activeServerId={activeServer?.id ?? null}
          activeModelSlug={activeModel?.slug ?? null}
          availableModels={availableModels}
          isBrowsingModels={isBrowsingModels}
          activeThemeId={appSettings.activeThemeId}
          customThemes={appSettings.customThemes}
          statusMessage={settingsStatusMessage}
          statusKind={settingsStatusKind}
          onClose={handleCloseSettings}
          onServerSelect={(serverId) => {
            void handleServerSelect(serverId)
          }}
          onModelSelect={(modelSlug) => {
            void handleModelSelect(modelSlug)
          }}
          onBrowseModels={() => {
            void handleBrowseModels()
          }}
          onSaveServerAddress={(serverId, baseUrl) => handleServerAddressSave(serverId, baseUrl)}
          onThemeSelect={(themeId) => {
            void handleThemeSelect(themeId)
          }}
          onImportTheme={(file) => {
            void handleImportTheme(file)
          }}
        />
      ) : null}

      {isSystemPromptOpen ? (
        <SystemPromptModal
          value={appSettings.systemPrompt}
          onClose={handleCloseSystemPrompt}
          onSave={(systemPrompt) => {
            void handleSaveSystemPrompt(systemPrompt)
          }}
        />
      ) : null}

      {isCreateCampaignOpen ? (
        <CreateCampaignModal
          isBusy={isCampaignBusy}
          onClose={() => {
            setIsCreateCampaignOpen(false)
          }}
          onSubmit={(name, description) => {
            void handleCreateCampaignSubmit(name, description)
          }}
        />
      ) : null}
    </div>
  )
}
