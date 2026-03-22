/**
 * src/components/SettingsModal.tsx
 * Modal dialog for app-level settings, including remote AI providers,
 * local llama.cpp configuration, model browsing, and theme selection.
 */

import { useEffect, useRef, useState } from 'react'
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
import { Modal } from './Modal'
import { PaletteIcon, SettingsIcon, SparklesIcon } from './icons'
import { formatBytes } from '../services/modelFitService'
import { BUILT_IN_THEMES } from '../services/themeService'
import '../styles/settings.css'

import type {
  AvailableModel,
  BinaryInstallProgress,
  ChatTextSize,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeStatus,
  ModelDownloadProgress,
  ModelPreset,
  ServerProfile,
  ThemeDefinition,
} from '../types'

type SettingsSectionId =
  | 'interface'
  | 'campaign'
  | 'session'
  | 'chat'
  | 'remote-ai'
  | 'local-ai'
  | 'embedded-ai'

const BUILT_IN_THEME_DESCRIPTIONS: Record<string, string> = {
  default: 'Original dark theme',
  'midnight-blue': 'Blue dark theme',
  'ember-red': 'Red dark theme',
  'verdant-green': 'Green dark theme',
  'amber-orange': 'Orange dark theme',
  graphite: 'Alternative dark theme',
  dawn: 'Warm light theme',
  linen: 'Soft neutral light theme',
}

const BUILT_IN_THEME_SWATCHES: Record<string, [string, string, string]> = {
  default: ['#0d0f14', '#5b7cf6', '#1b1f2b'],
  'midnight-blue': ['#08111e', '#3f87ff', '#17253c'],
  'ember-red': ['#180b0d', '#d7485a', '#32171b'],
  'verdant-green': ['#09130f', '#42b883', '#172821'],
  'amber-orange': ['#15100a', '#e28a2f', '#302117'],
  graphite: ['#101112', '#8da2b8', '#202326'],
  dawn: ['#efe9df', '#b65a3a', '#f2ebe2'],
  linen: ['#f4f0e8', '#4f7a9d', '#f6f1e7'],
}

/** Props accepted by the SettingsModal component. */
interface SettingsModalProps {
  /** Configured AI servers available to select. */
  servers: ServerProfile[]
  /** Configured model presets available to select. */
  models: ModelPreset[]
  /** Currently selected server profile ID. */
  activeServerId: string | null
  /** Currently selected model slug. */
  activeModelSlug: string | null
  /** Models discovered from the active server during this session. */
  availableModels: AvailableModel[]
  /** True while the app is refreshing the model list. */
  isBrowsingModels: boolean
  /** Latest detected hardware info for local llama.cpp guidance. */
  hardwareInfo: HardwareInfo | null
  /** Current managed local runtime status. */
  localRuntimeStatus: LocalRuntimeStatus | null
  /** Latest Hugging Face model download progress update. */
  modelDownloadProgress: ModelDownloadProgress | null
  /** GGUF files currently listed from a Hugging Face repository. */
  huggingFaceFiles: HuggingFaceModelFile[]
  /** True while browsing a Hugging Face repository. */
  isBrowsingHuggingFace: boolean
  /** True while downloading a Hugging Face GGUF file. */
  isDownloadingModel: boolean
  /** Currently active theme ID. */
  activeThemeId: string
  /** Currently active chat bubble text size preset. */
  chatTextSize: ChatTextSize
  /** Whether prompts should use rolling summaries plus a recent chat window. */
  enableRollingSummaries: boolean
  /** Imported custom themes available to select. */
  customThemes: ThemeDefinition[]
  /** Current llama-server binary install progress, or null. */
  binaryInstallProgress: BinaryInstallProgress | null
  /** Optional status text shown after save/import attempts. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** Close handler for the modal. */
  onClose: () => void
  /** Called when the user selects a server profile. */
  onServerSelect: (serverId: string) => void
  /** Called when the user selects a model preset. */
  onModelSelect: (modelSlug: string) => void
  /** Called when the user saves a context budget override for a model. */
  onSaveModelContext: (modelSlug: string, contextWindowTokens: number | null) => Promise<void>
  /** Called when the user refreshes the model list for the active server. */
  onBrowseModels: () => void
  /** Called when the user saves a manually edited remote server address. */
  onSaveServerAddress: (serverId: string, baseUrl: string) => Promise<void>
  /** Called when the user saves local llama.cpp-specific configuration. */
  onSaveLocalServerConfig: (
    serverId: string,
    values: {
      modelsDirectory: string
      executablePath: string
      host: string
      port: number
      huggingFaceToken: string
    },
  ) => Promise<void>
  /** Opens a native folder picker for the models directory. */
  onPickModelsDirectory: () => Promise<string | null>
  /** Opens a native file picker for the llama-server executable. */
  onPickLlamaExecutable: () => Promise<string | null>
  /** Called when the user browses a Hugging Face repository. */
  onBrowseHuggingFaceModels: (repoId: string) => void
  /** Called when the user downloads a GGUF file from Hugging Face. */
  onDownloadHuggingFaceModel: (repoId: string, fileName: string) => void
  /** Called when the user selects a theme. */
  onThemeSelect: (themeId: string) => void
  /** Called when the user selects a chat text size preset. */
  onChatTextSizeSelect: (textSize: ChatTextSize) => void
  /** Called when the user toggles rolling summaries for campaign prompts. */
  onRollingSummariesToggle: (enabled: boolean) => void
  /** Called when the user imports a theme JSON file. */
  onImportTheme: (file: File) => void
}

/**
 * Build concise secondary metadata for a model option row.
 *
 * @param model - Model option to summarize.
 * @returns Human-readable description shown under the model name.
 */
function buildModelDescription(model: AvailableModel | ModelPreset): string {
  const parts = [model.slug]

  if (typeof model.fileSizeBytes === 'number' && model.fileSizeBytes > 0) {
    parts.push(formatBytes(model.fileSizeBytes))
  }
  if (model.quantization) {
    parts.push(model.quantization)
  }
  if (typeof model.contextWindowTokens === 'number' && model.contextWindowTokens > 0) {
    parts.push(`${model.contextWindowTokens.toLocaleString()} ctx`)
  }

  return parts.join(' • ')
}

/**
 * Normalize a Hugging Face repository reference into owner/repo form.
 *
 * @param value - User-entered repository text or URL.
 * @returns Normalized repository id, or an empty string when invalid.
 */
function normalizeHuggingFaceRepoId(value: string): string {
  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return ''
  }

  const directMatch = trimmedValue.match(/^([^/\s]+\/[^/\s]+)$/)
  if (directMatch) {
    return directMatch[1]
  }

  const urlMatch = trimmedValue.match(
    /^https?:\/\/(?:www\.)?huggingface(?:\.co)?\/([^/\s]+\/[^/\s]+?)(?:\/+)?$/i,
  )
  if (urlMatch) {
    return urlMatch[1]
  }

  return trimmedValue
}

/**
 * SettingsModal
 * Renders interface settings plus remote/local AI configuration in a single modal.
 */
export function SettingsModal({
  servers,
  models,
  activeServerId,
  activeModelSlug,
  availableModels,
  isBrowsingModels,
  hardwareInfo,
  localRuntimeStatus,
  modelDownloadProgress,
  huggingFaceFiles,
  isBrowsingHuggingFace,
  isDownloadingModel,
  activeThemeId,
  chatTextSize,
  enableRollingSummaries,
  customThemes,
  binaryInstallProgress,
  statusMessage,
  statusKind,
  onClose,
  onServerSelect,
  onModelSelect,
  onSaveModelContext,
  onBrowseModels,
  onSaveServerAddress,
  onSaveLocalServerConfig,
  onPickModelsDirectory,
  onPickLlamaExecutable,
  onBrowseHuggingFaceModels,
  onDownloadHuggingFaceModel,
  onThemeSelect,
  onChatTextSizeSelect,
  onRollingSummariesToggle,
  onImportTheme,
}: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('interface')
  const [binaryCheckResult, setBinaryCheckResult] = useState<{
    found: boolean
    path: string | null
    detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
    estimatedSizeMb: number
  } | null>(null)
  const [serverAddressValue, setServerAddressValue] = useState('')
  const [contextWindowValue, setContextWindowValue] = useState('')
  const [modelsDirectoryValue, setModelsDirectoryValue] = useState('')
  const [executablePathValue, setExecutablePathValue] = useState('')
  const [hostValue, setHostValue] = useState('127.0.0.1')
  const [portValue, setPortValue] = useState('3939')
  const [huggingFaceTokenValue, setHuggingFaceTokenValue] = useState('')
  const [huggingFaceRepoValue, setHuggingFaceRepoValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const localAiServers = servers.filter((server) => server.kind !== 'llama.cpp')
  const embeddedAiServers = servers.filter((server) => server.kind === 'llama.cpp')
  const localAiServer = localAiServers.find((server) => server.id === activeServerId) ?? localAiServers[0] ?? null
  const embeddedAiServer =
    embeddedAiServers.find((server) => server.id === activeServerId) ?? embeddedAiServers[0] ?? null
  const activeServer =
    activeSection === 'local-ai'
      ? localAiServer
      : activeSection === 'embedded-ai'
        ? embeddedAiServer
        : servers.find((server) => server.id === activeServerId) ?? servers[0] ?? null
  const visibleModels = activeServer
    ? models.filter((model) => model.serverId === activeServer.id)
    : []
  const modelOptions = availableModels.length > 0 ? availableModels : visibleModels
  const activeModel = visibleModels.find((model) => model.slug === activeModelSlug) ?? null
  const isEmbeddedServer = activeServer?.kind === 'llama.cpp'

  /**
   * Keep remote and local fields aligned with the selected server profile.
   */
  useEffect(() => {
    setServerAddressValue(activeServer?.baseUrl ?? '')
    setModelsDirectoryValue(activeServer?.modelsDirectory ?? '')
    setExecutablePathValue(activeServer?.executablePath ?? '')
    setHostValue(activeServer?.host ?? '127.0.0.1')
    setPortValue((activeServer?.port ?? 3939).toString())
    setHuggingFaceTokenValue(activeServer?.huggingFaceToken ?? '')
  }, [
    activeServer?.baseUrl,
    activeServer?.executablePath,
    activeServer?.host,
    activeServer?.huggingFaceToken,
    activeServer?.id,
    activeServer?.modelsDirectory,
    activeServer?.port,
  ])

  /**
   * Keep the context budget field synced with the selected model preset.
   */
  useEffect(() => {
    setContextWindowValue(activeModel?.contextWindowTokens?.toString() ?? '')
  }, [activeModel?.contextWindowTokens, activeModel?.slug])

  /**
   * Run a binary check whenever the active server changes to a llama.cpp server.
   */
  useEffect(() => {
    if (!embeddedAiServer) {
      setBinaryCheckResult(null)
      return
    }
    window.api.checkLlamaBinary(embeddedAiServer.id).then(setBinaryCheckResult).catch(() => {
      setBinaryCheckResult(null)
    })
  }, [embeddedAiServer?.id])

  /**
   * Re-check the binary after a successful install completes.
   */
  useEffect(() => {
    if (binaryInstallProgress?.status !== 'complete') return
    if (!embeddedAiServer) return
    window.api.checkLlamaBinary(embeddedAiServer.id).then(setBinaryCheckResult).catch(() => {})
  }, [binaryInstallProgress?.status, embeddedAiServer?.id])

  /**
   * Open the hidden file input for theme import.
   */
  function handlePickFile(): void {
    fileInputRef.current?.click()
  }

  /**
   * Handle file selection from the hidden theme import input.
   *
   * @param event - File input change event.
   */
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    onImportTheme(file)
    event.target.value = ''
  }

  /**
   * Open the native models-directory picker and mirror the result into local state.
   */
  async function handleChooseModelsDirectory(): Promise<void> {
    const selectedPath = await onPickModelsDirectory()
    if (selectedPath) {
      setModelsDirectoryValue(selectedPath)
    }
  }

  /**
   * Open the native llama-server picker and mirror the result into local state.
   */
  async function handleChooseExecutable(): Promise<void> {
    const selectedPath = await onPickLlamaExecutable()
    if (selectedPath) {
      setExecutablePathValue(selectedPath)
    }
  }

  /**
   * Switch the visible settings section.
   *
   * @param sectionId - Identifier of the section to display.
   */
  function handleSectionSelect(sectionId: SettingsSectionId): void {
    setActiveSection(sectionId)
  }

  /**
   * Persist the currently visible AI settings and close the modal.
   */
  async function handleSaveAndClose(): Promise<void> {
    if (activeSection === 'local-ai' && activeServer) {
      setIsSaving(true)
      try {
        await onSaveServerAddress(activeServer.id, serverAddressValue)

        if (activeModel) {
          const trimmedValue = contextWindowValue.trim()
          await onSaveModelContext(
            activeModel.slug,
            trimmedValue.length === 0 ? null : Number(trimmedValue),
          )
        }
      } finally {
        setIsSaving(false)
      }
    }

    if (activeSection === 'embedded-ai' && activeServer) {
      setIsSaving(true)
      try {
        await onSaveLocalServerConfig(activeServer.id, {
          modelsDirectory: modelsDirectoryValue,
          executablePath: executablePathValue,
          host: hostValue,
          port: Number(portValue),
          huggingFaceToken: huggingFaceTokenValue,
        })

        if (activeModel) {
          const trimmedValue = contextWindowValue.trim()
          await onSaveModelContext(
            activeModel.slug,
            trimmedValue.length === 0 ? null : Number(trimmedValue),
          )
        }
      } finally {
        setIsSaving(false)
      }
    }

    onClose()
  }

  return (
    <Modal
      title={(
        <>
          <SettingsIcon className="modal__title-icon" aria-hidden="true" />
          <span>Settings</span>
        </>
      )}
      onClose={onClose}
      className="modal--settings"
    >
      <div className="settings-modal">
        <div className="settings-modal__body">
          <nav className="settings-modal__nav" aria-label="Settings sections">
            <SettingsSectionTab
              id="interface"
              label="Interface"
              description="Themes and appearance"
              icon={<PaletteIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="campaign"
              label="Campaign"
              description="Campaign-wide settings"
              icon={<PaletteIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="session"
              label="Session"
              description="Per-session behavior"
              icon={<PaletteIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="chat"
              label="Chat"
              description="Reserved for chat settings"
              icon={<PaletteIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="remote-ai"
              label="Remote AI"
              description="Cloud and hosted providers"
              icon={<SparklesIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="local-ai"
              label="Local AI"
              description="LM Studio and local servers"
              icon={<SparklesIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="embedded-ai"
              label="Embedded AI"
              description="Managed llama.cpp runtime"
              icon={<SparklesIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
          </nav>

          <div className="settings-modal__panel">
            {statusMessage ? (
              <div className={`settings-modal__status settings-modal__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : null}
            {activeSection === 'interface' ? (
              <section className="settings-modal__section">
                <div className="settings-modal__heading-row">
                  <div>
                    <h2 className="settings-modal__heading">Interface</h2>
                    <p className="settings-modal__subheading">
                      Select a built-in theme or import a JSON theme package.
                    </p>
                  </div>
                  <button className="settings-modal__import-btn" onClick={handlePickFile}>
                    Import Theme
                  </button>
                  <input
                    ref={fileInputRef}
                    className="settings-modal__file-input"
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                  />
                </div>

                <div className="settings-modal__group">
                  <div className="settings-modal__group-title">Built-in</div>
                  <div className="settings-modal__theme-list" role="radiogroup" aria-label="Built-in themes">
                    {BUILT_IN_THEMES.map((theme) => (
                      <ThemeOption
                        key={theme.id}
                        id={theme.id}
                        name={theme.name}
                        description={BUILT_IN_THEME_DESCRIPTIONS[theme.id] ?? 'Built-in theme'}
                        swatches={BUILT_IN_THEME_SWATCHES[theme.id]}
                        checked={activeThemeId === theme.id}
                        onSelect={onThemeSelect}
                      />
                    ))}
                  </div>
                </div>

                <div className="settings-modal__group">
                  <div className="settings-modal__group-title">Imported</div>
                  {customThemes.length === 0 ? (
                    <p className="settings-modal__empty">
                      No imported themes yet. Download a theme JSON and import it here.
                    </p>
                  ) : (
                    <div className="settings-modal__theme-list" role="radiogroup" aria-label="Imported themes">
                      {customThemes.map((theme) => (
                        <ThemeOption
                          key={theme.id}
                          id={theme.id}
                          name={theme.name}
                          description={`Imported ${theme.mode} theme`}
                          checked={activeThemeId === theme.id}
                          onSelect={onThemeSelect}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : activeSection === 'campaign' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Campaign</h2>
                  <p className="settings-modal__subheading">
                    Campaign settings will appear here.
                  </p>
                </div>

                <div className="settings-modal__empty-panel">
                  No campaign settings yet.
                </div>
              </section>
            ) : activeSection === 'session' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Session</h2>
                  <p className="settings-modal__subheading">
                    Session behavior and context controls.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <label className="settings-modal__toggle" htmlFor="settings-rolling-summaries">
                    <span className="settings-modal__toggle-body">
                      <span className="settings-modal__label">Rolling Scene Summaries</span>
                      <span className="settings-modal__field-hint">
                        Send the rolling scene summary plus the latest 10 chats instead of the full transcript.
                      </span>
                    </span>
                    <input
                      id="settings-rolling-summaries"
                      className="settings-modal__toggle-input"
                      type="checkbox"
                      checked={enableRollingSummaries}
                      onChange={(event) => onRollingSummariesToggle(event.target.checked)}
                    />
                  </label>
                </div>
              </section>
            ) : activeSection === 'chat' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Chat</h2>
                  <p className="settings-modal__subheading">
                    Chat appearance settings.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-chat-text-size">
                      Chat Text Size
                    </label>
                    <select
                      id="settings-chat-text-size"
                      className="settings-modal__select"
                      value={chatTextSize}
                      onChange={(event) => onChatTextSizeSelect(event.target.value as ChatTextSize)}
                    >
                      <option value="small">Small (Default)</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                      <option value="extra-large">Extra-Large</option>
                    </select>
                    <p className="settings-modal__field-hint">
                      Adjusts the text size used inside chat bubbles.
                    </p>
                  </div>
                </div>
              </section>
            ) : activeSection === 'remote-ai' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Remote AI</h2>
                  <p className="settings-modal__subheading">
                    Remote AI settings will appear here.
                  </p>
                </div>

                <div className="settings-modal__empty-panel">
                  No remote AI settings yet.
                </div>
              </section>
            ) : activeSection === 'local-ai' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Local AI</h2>
                  <p className="settings-modal__subheading">
                    Configure local AI servers such as LM Studio and text-generation-webui.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-server-select">
                      Provider
                    </label>
                    <select
                      id="settings-server-select"
                      className="settings-modal__select"
                      value={activeServer?.id ?? ''}
                      onChange={(event) => onServerSelect(event.target.value)}
                      disabled={localAiServers.length === 0}
                    >
                      {localAiServers.length === 0 ? (
                        <option value="">No local AI servers configured</option>
                      ) : (
                        localAiServers.map((server) => (
                          <option key={server.id} value={server.id}>
                            {server.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-server-address">
                      Server Address
                    </label>
                    <input
                      id="settings-server-address"
                      className="settings-modal__select"
                      type="text"
                      placeholder="http://localhost:1234/v1"
                      value={serverAddressValue}
                      onChange={(event) => setServerAddressValue(event.target.value)}
                      disabled={!activeServer}
                    />
                    <p className="settings-modal__field-hint">
                      LM Studio uses its native chat API automatically when selected; other servers use OpenAI-compatible endpoints.
                    </p>
                  </div>

                  <div className="settings-modal__field">
                    <div className="settings-modal__field-row">
                      <label className="settings-modal__label" htmlFor="settings-model-list">
                        Models
                      </label>
                      <button
                        type="button"
                        className="settings-modal__refresh-btn"
                        onClick={onBrowseModels}
                        disabled={!activeServer || isBrowsingModels}
                      >
                        {isBrowsingModels ? 'Refreshing...' : 'Browse Models'}
                      </button>
                    </div>
                    <div
                      id="settings-model-list"
                      className="settings-modal__model-list"
                      role="radiogroup"
                      aria-label="Available models"
                    >
                      {modelOptions.length === 0 ? (
                        <p className="settings-modal__empty">
                          No models loaded yet. Browse the active server to fetch its available models.
                        </p>
                      ) : (
                        modelOptions.map((model) => (
                          <ModelOption
                            key={model.id}
                            id={model.slug}
                            name={model.name}
                            description={buildModelDescription(model)}
                            checked={activeModelSlug === model.slug}
                            onSelect={onModelSelect}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-context-budget">
                      Context Budget
                    </label>
                    <input
                      id="settings-context-budget"
                      className="settings-modal__select"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="e.g. 8192"
                      value={contextWindowValue}
                      onChange={(event) => setContextWindowValue(event.target.value)}
                      disabled={!activeModel}
                    />
                    <p className="settings-modal__field-hint">
                      Override the selected model&apos;s total context window in tokens.
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Embedded AI</h2>
                  <p className="settings-modal__subheading">
                    Configure the managed llama.cpp runtime and its local models.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-server-select">
                      Provider
                    </label>
                    <select
                      id="settings-server-select"
                      className="settings-modal__select"
                      value={activeServer?.id ?? ''}
                      onChange={(event) => onServerSelect(event.target.value)}
                      disabled={embeddedAiServers.length === 0}
                    >
                      {embeddedAiServers.length === 0 ? (
                        <option value="">No embedded AI servers configured</option>
                      ) : (
                        embeddedAiServers.map((server) => (
                          <option key={server.id} value={server.id}>
                            {server.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {isEmbeddedServer ? (
                    <>
                      <div className="settings-modal__field">
                        <label className="settings-modal__label" htmlFor="settings-models-directory">
                          Models Directory
                        </label>
                        <div className="settings-modal__inline-input">
                          <input
                            id="settings-models-directory"
                            className="settings-modal__select"
                            type="text"
                            value={modelsDirectoryValue}
                            onChange={(event) => setModelsDirectoryValue(event.target.value)}
                          />
                          <button
                            type="button"
                            className="settings-modal__refresh-btn"
                            onClick={() => {
                              void handleChooseModelsDirectory()
                            }}
                          >
                            Choose
                          </button>
                        </div>
                        <p className="settings-modal__field-hint">
                          Defaults to a `models` folder inside the application directory, not AppData.
                        </p>
                      </div>

                      {binaryCheckResult && !binaryCheckResult.found && (
                        <LlamaBinaryBanner
                          detectedBackend={binaryCheckResult.detectedBackend}
                          estimatedSizeMb={binaryCheckResult.estimatedSizeMb}
                          progress={binaryInstallProgress}
                          onInstall={() => {
                            if (activeServer) void window.api.installLlamaBinary(activeServer.id)
                          }}
                        />
                      )}

                      <div className="settings-modal__field">
                        <label className="settings-modal__label" htmlFor="settings-llama-executable">
                          llama-server Executable
                        </label>
                        <div className="settings-modal__inline-input">
                          <input
                            id="settings-llama-executable"
                            className="settings-modal__select"
                            type="text"
                            value={executablePathValue}
                            onChange={(event) => setExecutablePathValue(event.target.value)}
                            placeholder="Optional if llama-server is already on PATH"
                          />
                          <button
                            type="button"
                            className="settings-modal__refresh-btn"
                            onClick={() => {
                              void handleChooseExecutable()
                            }}
                          >
                            Choose
                          </button>
                        </div>
                      </div>

                      <div className="settings-modal__split-grid">
                        <div className="settings-modal__field">
                          <label className="settings-modal__label" htmlFor="settings-llama-host">
                            Host
                          </label>
                          <input
                            id="settings-llama-host"
                            className="settings-modal__select"
                            type="text"
                            value={hostValue}
                            onChange={(event) => setHostValue(event.target.value)}
                          />
                        </div>
                        <div className="settings-modal__field">
                          <label className="settings-modal__label" htmlFor="settings-llama-port">
                            Port
                          </label>
                          <input
                            id="settings-llama-port"
                            className="settings-modal__select"
                            type="number"
                            min="1"
                            step="1"
                            value={portValue}
                            onChange={(event) => setPortValue(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="settings-modal__field">
                        <label className="settings-modal__label" htmlFor="settings-hf-token">
                          Hugging Face Token
                        </label>
                        <input
                          id="settings-hf-token"
                          className="settings-modal__select"
                          type="password"
                          value={huggingFaceTokenValue}
                          onChange={(event) => setHuggingFaceTokenValue(event.target.value)}
                          placeholder="Optional, only needed for gated/private repos"
                        />
                      </div>

                      <HardwareCard hardwareInfo={hardwareInfo} runtimeStatus={localRuntimeStatus} />
                      <div className="settings-modal__group">
                        <div className="settings-modal__field">
                          <div className="settings-modal__group-title">Hugging Face</div>
                          <label className="settings-modal__label" htmlFor="settings-hf-repo">
                            Repository
                          </label>
                          <div className="settings-modal__inline-input">
                            <input
                              id="settings-hf-repo"
                              className="settings-modal__select"
                              type="text"
                              placeholder="e.g. bartowski/Llama-3.2-3B-Instruct-GGUF or https://huggingface.co/..."
                              value={huggingFaceRepoValue}
                              onChange={(event) => setHuggingFaceRepoValue(event.target.value)}
                            />
                            <button
                              type="button"
                              className="settings-modal__refresh-btn"
                              onClick={() => onBrowseHuggingFaceModels(normalizeHuggingFaceRepoId(huggingFaceRepoValue))}
                              disabled={isBrowsingHuggingFace || normalizeHuggingFaceRepoId(huggingFaceRepoValue).length === 0}
                            >
                              {isBrowsingHuggingFace ? 'Browsing...' : 'Browse Repo'}
                            </button>
                          </div>
                          <p className="settings-modal__field-hint">
                            Paste either `owner/repo` or the full Hugging Face repository URL.
                          </p>
                        </div>

                        {modelDownloadProgress ? (
                          <div className="settings-modal__status">
                            {modelDownloadProgress.status === 'downloading'
                              ? `Downloading ${modelDownloadProgress.fileName}... ${modelDownloadProgress.percent ?? 0}%`
                              : modelDownloadProgress.status === 'completed'
                                ? `Downloaded ${modelDownloadProgress.fileName}.`
                                : modelDownloadProgress.message ?? 'Download update'}
                          </div>
                        ) : null}

                        {huggingFaceFiles.length === 0 ? (
                          <p className="settings-modal__empty">
                            Browse a repository to list GGUF files available for download.
                          </p>
                        ) : (
                          <div className="settings-modal__model-list" role="list" aria-label="Hugging Face GGUF files">
                            {huggingFaceFiles.map((file) => (
                              <div key={file.path} className="settings-modal__download-option" role="listitem">
                                <div className="settings-modal__option-body">
                                  <span className="settings-modal__option-name">{file.name}</span>
                                  <span className="settings-modal__option-description">{file.path}</span>
                                  <span className="settings-modal__option-description">
                                    {formatBytes(file.sizeBytes)}{file.quantization ? ` • ${file.quantization}` : ''}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="settings-modal__refresh-btn"
                                  onClick={() => onDownloadHuggingFaceModel(normalizeHuggingFaceRepoId(huggingFaceRepoValue), file.path)}
                                  disabled={isDownloadingModel}
                                >
                                  {isDownloadingModel ? 'Downloading...' : 'Download'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="settings-modal__field">
                        <div className="settings-modal__field-row">
                          <label className="settings-modal__label" htmlFor="settings-model-list">
                            Local Models
                          </label>
                          <button
                            type="button"
                            className="settings-modal__refresh-btn"
                            onClick={onBrowseModels}
                            disabled={!activeServer || isBrowsingModels}
                          >
                            {isBrowsingModels ? 'Refreshing...' : 'Scan Models'}
                          </button>
                        </div>
                        <div
                          id="settings-model-list"
                          className="settings-modal__model-list"
                          role="radiogroup"
                          aria-label="Available models"
                        >
                          {modelOptions.length === 0 ? (
                            <p className="settings-modal__empty">
                              No local GGUF files found yet. Scan the models directory or download one from Hugging Face.
                            </p>
                          ) : (
                            modelOptions.map((model) => (
                              <ModelOption
                                key={model.id}
                                id={model.slug}
                                name={model.name}
                                description={buildModelDescription(model)}
                                checked={activeModelSlug === model.slug}
                                onSelect={onModelSelect}
                              />
                            ))
                          )}
                        </div>
                      </div>

                      <div className="settings-modal__field">
                        <label className="settings-modal__label" htmlFor="settings-context-budget">
                          Context Budget
                        </label>
                        <input
                          id="settings-context-budget"
                          className="settings-modal__select"
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 8192"
                          value={contextWindowValue}
                          onChange={(event) => setContextWindowValue(event.target.value)}
                          disabled={!activeModel}
                        />
                        <p className="settings-modal__field-hint">
                          Override the selected model&apos;s total context window in tokens.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="settings-modal__empty-panel">
                      No embedded AI server configured.
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="settings-modal__footer">
          <p className="settings-modal__footer-note">
            Settings apply immediately. Save Settings persists the current AI configuration and closes this dialog.
          </p>
          <div className="settings-modal__footer-actions">
            <button type="button" className="settings-modal__footer-btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="settings-modal__footer-btn settings-modal__footer-btn--primary"
              onClick={() => {
                void handleSaveAndClose()
              }}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Props accepted by the ModelOption component. */
interface ModelOptionProps {
  /** Model slug used as the control value. */
  id: string
  /** Display name shown to the user. */
  name: string
  /** Secondary metadata shown under the model name. */
  description: string
  /** Whether the option is the current active model. */
  checked: boolean
  /** Called when the user selects the option. */
  onSelect: (modelSlug: string) => void
}

/**
 * ModelOption
 * Single radio-style option used in the AI model browser.
 */
function ModelOption({ id, name, description, checked, onSelect }: ModelOptionProps) {
  /**
   * Handle selecting this model option.
   */
  function handleSelect(): void {
    onSelect(id)
  }

  return (
    <label className={`settings-modal__option${checked ? ' settings-modal__option--active' : ''}`}>
      <input
        className="settings-modal__option-input"
        type="radio"
        name="model-selection"
        checked={checked}
        onChange={handleSelect}
      />
      <span className="settings-modal__option-body">
        <span className="settings-modal__option-name">{name}</span>
        <span className="settings-modal__option-description">{description}</span>
      </span>
    </label>
  )
}

/** Props accepted by the SettingsSectionTab component. */
interface SettingsSectionTabProps {
  /** Section identifier. */
  id: SettingsSectionId
  /** Heading shown in the left nav. */
  label: string
  /** Supporting copy shown under the heading. */
  description: string
  /** Optional icon shown before the label. */
  icon?: React.ReactNode
  /** Currently active section. */
  activeSection: SettingsSectionId
  /** Called when the tab is selected. */
  onSelect: (sectionId: SettingsSectionId) => void
}

/**
 * SettingsSectionTab
 * Vertical navigation item used by the settings modal.
 */
function SettingsSectionTab({
  id,
  label,
  description,
  icon,
  activeSection,
  onSelect,
}: SettingsSectionTabProps) {
  /**
   * Select this settings section.
   */
  function handleClick(): void {
    onSelect(id)
  }

  return (
    <button
      type="button"
      className={`settings-modal__nav-item${activeSection === id ? ' settings-modal__nav-item--active' : ''}`}
      onClick={handleClick}
    >
      <span className="settings-modal__nav-label-row">
        {icon ? <span className="settings-modal__nav-icon" aria-hidden="true">{icon}</span> : null}
        <span className="settings-modal__nav-label">{label}</span>
      </span>
      <span className="settings-modal__nav-description">{description}</span>
    </button>
  )
}

/** Props accepted by the ThemeOption component. */
interface ThemeOptionProps {
  /** Theme ID used as the control value. */
  id: string
  /** Display name shown to the user. */
  name: string
  /** Secondary metadata shown under the theme name. */
  description: string
  /** Optional preview colors displayed beside the theme metadata. */
  swatches?: [string, string, string]
  /** Whether the option is the current active theme. */
  checked: boolean
  /** Called when the user selects the option. */
  onSelect: (themeId: string) => void
}

/**
 * ThemeOption
 * Single radio-style option used in the theme settings lists.
 */
function ThemeOption({ id, name, description, swatches, checked, onSelect }: ThemeOptionProps) {
  /**
   * Handle selecting this theme option.
   */
  function handleSelect(): void {
    onSelect(id)
  }

  return (
    <label className={`settings-modal__option${checked ? ' settings-modal__option--active' : ''}`}>
      <input
        className="settings-modal__option-input"
        type="radio"
        name="theme-selection"
        checked={checked}
        onChange={handleSelect}
      />
      <span className="settings-modal__option-body">
        <span className="settings-modal__option-name">{name}</span>
        <span className="settings-modal__option-description">{description}</span>
        {swatches ? (
          <span className="settings-modal__theme-preview" aria-hidden="true">
            {swatches.map((color) => (
              <span
                key={color}
                className="settings-modal__theme-swatch"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        ) : null}
      </span>
    </label>
  )
}

/** Props accepted by the HardwareCard component. */
interface HardwareCardProps {
  /** Latest detected hardware inventory. */
  hardwareInfo: HardwareInfo | null
  /** Current managed local runtime status. */
  runtimeStatus: LocalRuntimeStatus | null
}

/**
 * HardwareCard
 * Compact host-hardware summary used by the local llama.cpp settings panel.
 */
function HardwareCard({ hardwareInfo, runtimeStatus }: HardwareCardProps) {
  return (
    <div className="settings-modal__hardware-card">
      <div className="settings-modal__group-title">Hardware</div>
      {hardwareInfo ? (
        <div className="settings-modal__hardware-grid">
          <div className="settings-modal__hardware-item">
            <strong>CPU</strong>
            <span>{hardwareInfo.cpuModel}</span>
          </div>
          <div className="settings-modal__hardware-item">
            <strong>System RAM</strong>
            <span>{formatBytes(hardwareInfo.totalMemoryBytes)}</span>
          </div>
          <div className="settings-modal__hardware-item">
            <strong>Recommended Backend</strong>
            <span>{hardwareInfo.recommendedBackend.toUpperCase()}</span>
          </div>
          <div className="settings-modal__hardware-item">
            <strong>GPU</strong>
            <span>
              {hardwareInfo.gpus.length > 0
                ? hardwareInfo.gpus.map((gpu) => `${gpu.name}${gpu.vramBytes ? ` (${formatBytes(gpu.vramBytes)})` : ''}`).join(', ')
                : 'No GPU detected'}
            </span>
          </div>
          <div className="settings-modal__hardware-item">
            <strong>Runtime</strong>
            <span>
              {runtimeStatus
                ? `${runtimeStatus.state}${runtimeStatus.modelSlug ? ` • ${runtimeStatus.modelSlug}` : ''}`
                : 'Unknown'}
            </span>
          </div>
        </div>
      ) : (
        <p className="settings-modal__empty">
          Hardware detection is unavailable right now.
        </p>
      )}
    </div>
  )
}
