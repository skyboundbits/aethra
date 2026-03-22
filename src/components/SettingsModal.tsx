/**
 * src/components/SettingsModal.tsx
 * Modal dialog for app-level settings, including remote AI providers,
 * local llama.cpp configuration, model browsing, and theme selection.
 */

import { useEffect, useState } from 'react'
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import { Modal } from './Modal'
import { MessageCircleMoreIcon, PaletteIcon, SettingsIcon, SparkleIcon, SparklesIcon, WandSparklesIcon, SwordsIcon, ListMinusIcon, ChessKnightIcon } from './icons'
import {
  DEFAULT_CAMPAIGN_BASE_PROMPT,
  DEFAULT_CHAT_FORMATTING_RULES,
  DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
} from '../prompts/campaignPrompts'
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
} from '../types'

type SettingsSectionId =
  | 'interface'
  | 'prompts'
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
  'modern-slate': 'Clean contemporary charcoal theme',
  'steel-grey': 'Neutral monochrome workstation theme',
  'royal-purple': 'Regal violet and plum theme',
  'deep-sapphire': 'Rich sapphire and navy theme',
  'aurora-teal': 'Glowing teal and ice theme',
  dawn: 'Warm light theme',
  'paper-mint': 'Fresh mint and paper light theme',
  'sky-glass': 'Bright airy blue light theme',
  'rose-porcelain': 'Soft blush porcelain light theme',
  linen: 'Soft neutral light theme',
}

interface ThemePreviewPalette {
  appBg: string
  panelBg: string
  surfaceBg: string
  accent: string
  textPrimary: string
  textSecondary: string
  userMessage: string
}

const BUILT_IN_THEME_PREVIEWS: Record<string, ThemePreviewPalette> = {
  default: {
    appBg: '#0d0f14',
    panelBg: '#13161e',
    surfaceBg: '#1b1f2b',
    accent: '#5b7cf6',
    textPrimary: '#e2e6f0',
    textSecondary: '#7a82a0',
    userMessage: '#1e2d5a',
  },
  'midnight-blue': {
    appBg: '#08111e',
    panelBg: '#101b2d',
    surfaceBg: '#17253c',
    accent: '#3f87ff',
    textPrimary: '#edf5ff',
    textSecondary: '#9cb5d6',
    userMessage: '#183968',
  },
  'ember-red': {
    appBg: '#180b0d',
    panelBg: '#241114',
    surfaceBg: '#32171b',
    accent: '#d7485a',
    textPrimary: '#fff0f2',
    textSecondary: '#d5a2aa',
    userMessage: '#51232e',
  },
  'verdant-green': {
    appBg: '#09130f',
    panelBg: '#101d18',
    surfaceBg: '#172821',
    accent: '#42b883',
    textPrimary: '#edf9f2',
    textSecondary: '#9fc6b1',
    userMessage: '#1d3a31',
  },
  'amber-orange': {
    appBg: '#15100a',
    panelBg: '#221810',
    surfaceBg: '#302117',
    accent: '#e28a2f',
    textPrimary: '#fff5e9',
    textSecondary: '#d6b08b',
    userMessage: '#4b3118',
  },
  graphite: {
    appBg: '#101112',
    panelBg: '#17191b',
    surfaceBg: '#202326',
    accent: '#8da2b8',
    textPrimary: '#f2f4f6',
    textSecondary: '#a4aeb9',
    userMessage: '#24303f',
  },
  'modern-slate': {
    appBg: '#0f1722',
    panelBg: '#151f2c',
    surfaceBg: '#1c2838',
    accent: '#4cc9f0',
    textPrimary: '#edf6ff',
    textSecondary: '#93a8bf',
    userMessage: '#1f3a52',
  },
  'steel-grey': {
    appBg: '#111315',
    panelBg: '#181b1f',
    surfaceBg: '#23272c',
    accent: '#9aa4b2',
    textPrimary: '#f3f5f7',
    textSecondary: '#9ea8b3',
    userMessage: '#2d3742',
  },
  'royal-purple': {
    appBg: '#140d1e',
    panelBg: '#1d132b',
    surfaceBg: '#2a1d3d',
    accent: '#9d6bff',
    textPrimary: '#f5eeff',
    textSecondary: '#bca6df',
    userMessage: '#352452',
  },
  'deep-sapphire': {
    appBg: '#07131f',
    panelBg: '#0d1d31',
    surfaceBg: '#132943',
    accent: '#3b82f6',
    textPrimary: '#edf5ff',
    textSecondary: '#9cb7da',
    userMessage: '#173965',
  },
  'aurora-teal': {
    appBg: '#071615',
    panelBg: '#0d2220',
    surfaceBg: '#14302d',
    accent: '#38d6c4',
    textPrimary: '#ebfffb',
    textSecondary: '#97c9c1',
    userMessage: '#1a3d43',
  },
  dawn: {
    appBg: '#efe9df',
    panelBg: '#fbf7f2',
    surfaceBg: '#f2ebe2',
    accent: '#b65a3a',
    textPrimary: '#2c241d',
    textSecondary: '#6e5a4a',
    userMessage: '#c9d8f7',
  },
  'paper-mint': {
    appBg: '#edf6f1',
    panelBg: '#fbfffc',
    surfaceBg: '#f1f8f4',
    accent: '#3ca37c',
    textPrimary: '#21332c',
    textSecondary: '#5f7c71',
    userMessage: '#dcefe7',
  },
  'sky-glass': {
    appBg: '#edf4fb',
    panelBg: '#fbfdff',
    surfaceBg: '#f2f7fc',
    accent: '#4a8fdc',
    textPrimary: '#1f2f42',
    textSecondary: '#607892',
    userMessage: '#dce9f8',
  },
  'rose-porcelain': {
    appBg: '#f8efef',
    panelBg: '#fffafa',
    surfaceBg: '#fbf2f2',
    accent: '#c06b8d',
    textPrimary: '#3a2830',
    textSecondary: '#816470',
    userMessage: '#f1dde6',
  },
  linen: {
    appBg: '#f4f0e8',
    panelBg: '#fffdf8',
    surfaceBg: '#f6f1e7',
    accent: '#4f7a9d',
    textPrimary: '#2d261f',
    textSecondary: '#6d6153',
    userMessage: '#dfe7f2',
  },
}

const ASSISTANT_REVEAL_DELAY_DEFAULT_MS = 1500
const ASSISTANT_REVEAL_DELAY_MAX_SECONDS = 10

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
  /** Whether hidden chat markup markers should be shown in the transcript. */
  showChatMarkup: boolean
  /** Minimum delay before assistant text starts rendering, in milliseconds. */
  assistantResponseRevealDelayMs: number
  /** Base campaign roleplay instruction template. */
  campaignBasePrompt: string
  /** Chat formatting rules appended to the campaign prompt. */
  formattingRules: string
  /** Rolling summary system instruction template. */
  rollingSummarySystemPrompt: string
  /** Whether prompts should use rolling summaries plus a recent chat window. */
  enableRollingSummaries: boolean
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
  /** Called when the user toggles raw chat markup visibility. */
  onShowChatMarkupToggle: (enabled: boolean) => void
  /** Called when the user changes the assistant response reveal delay. */
  onAssistantResponseRevealDelayChange: (delayMs: number) => void
  /** Called when the user toggles rolling summaries for campaign prompts. */
  onRollingSummariesToggle: (enabled: boolean) => void
  /** Called when the user saves edited prompt templates. */
  onSavePromptTemplates: (prompts: {
    campaignBasePrompt: string
    formattingRules: string
    rollingSummarySystemPrompt: string
  }) => Promise<void>
  /** Called when the modal should publish a footer status update. */
  onSetStatus: (kind: 'error' | 'success', message: string) => void
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
  showChatMarkup,
  assistantResponseRevealDelayMs,
  campaignBasePrompt,
  formattingRules,
  rollingSummarySystemPrompt,
  enableRollingSummaries,
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
  onShowChatMarkupToggle,
  onAssistantResponseRevealDelayChange,
  onRollingSummariesToggle,
  onSavePromptTemplates,
  onSetStatus,
}: SettingsModalProps) {
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
  const [campaignBasePromptValue, setCampaignBasePromptValue] = useState(campaignBasePrompt)
  const [formattingRulesValue, setFormattingRulesValue] = useState(formattingRules)
  const [rollingSummarySystemPromptValue, setRollingSummarySystemPromptValue] = useState(rollingSummarySystemPrompt)
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
  const assistantRevealDelaySeconds = assistantResponseRevealDelayMs / 1000

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
   * Keep editable prompt fields aligned with the latest persisted values.
   */
  useEffect(() => {
    setCampaignBasePromptValue(campaignBasePrompt)
  }, [campaignBasePrompt])

  /**
   * Keep the formatting-rules editor aligned with persisted settings.
   */
  useEffect(() => {
    setFormattingRulesValue(formattingRules)
  }, [formattingRules])

  /**
   * Keep the rolling-summary prompt editor aligned with persisted settings.
   */
  useEffect(() => {
    setRollingSummarySystemPromptValue(rollingSummarySystemPrompt)
  }, [rollingSummarySystemPrompt])

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
   * Persist the currently visible AI settings without closing the modal.
   */
  async function handleSaveSettings(): Promise<void> {
    try {
      if (activeSection === 'prompts') {
        setIsSaving(true)
        try {
          await onSavePromptTemplates({
            campaignBasePrompt: campaignBasePromptValue,
            rollingSummarySystemPrompt: rollingSummarySystemPromptValue,
          })
        } finally {
          setIsSaving(false)
        }
      }

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

      onSetStatus('success', 'Settings saved.')
    } catch {
      // Parent callbacks publish the relevant error status.
    }
  }

  /**
   * Persist both prompt templates using the current editor values.
   */
  async function handlePromptTemplatesSave(): Promise<void> {
    setIsSaving(true)
    try {
      await onSavePromptTemplates({
        campaignBasePrompt: campaignBasePromptValue,
        formattingRules: formattingRulesValue,
        rollingSummarySystemPrompt: rollingSummarySystemPromptValue,
      })
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Restore one prompt editor to its bundled default and save immediately.
   *
   * @param promptId - Template to restore.
   */
  async function handlePromptReset(
    promptId: 'campaignBasePrompt' | 'formattingRules' | 'rollingSummarySystemPrompt',
  ): Promise<void> {
    const nextPrompts = {
      campaignBasePrompt:
        promptId === 'campaignBasePrompt' ? DEFAULT_CAMPAIGN_BASE_PROMPT : campaignBasePromptValue,
      formattingRules:
        promptId === 'formattingRules' ? DEFAULT_CHAT_FORMATTING_RULES : formattingRulesValue,
      rollingSummarySystemPrompt:
        promptId === 'rollingSummarySystemPrompt'
          ? DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT
          : rollingSummarySystemPromptValue,
    }

    setCampaignBasePromptValue(nextPrompts.campaignBasePrompt)
    setFormattingRulesValue(nextPrompts.formattingRules)
    setRollingSummarySystemPromptValue(nextPrompts.rollingSummarySystemPrompt)
    setIsSaving(true)
    try {
      await onSavePromptTemplates(nextPrompts)
    } finally {
      setIsSaving(false)
    }
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
      variant="workspace"
    >
      <ModalWorkspaceLayout
        nav={(
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
              id="prompts"
              label="Prompts"
              description="Editable campaign templates"
              icon={<ListMinusIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="campaign"
              label="Campaign"
              description="Campaign-wide settings"
              icon={<SwordsIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="session"
              label="Session"
              description="Per-session behavior"
              icon={<ChessKnightIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="chat"
              label="Chat"
              description="Reserved for chat settings"
              icon={<MessageCircleMoreIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="remote-ai"
              label="Remote AI"
              description="Cloud and hosted providers"
              icon={<WandSparklesIcon />}
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="local-ai"
              label="Local AI"
              description="LM Studio and local servers"
              icon={<SparkleIcon />}
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
        )}
        panel={(
          <div className="settings-modal__panel">
            {activeSection === 'interface' ? (
              <section className="settings-modal__section">
                <div className="settings-modal__heading-row">
                  <div>
                    <h2 className="settings-modal__heading">Interface</h2>
                    <p className="settings-modal__subheading">
                      Configure the application look and feel.
                    </p>
                  </div>
                </div>

                <div className="settings-modal__group">
                  <div className="settings-modal__group-title">Theme</div>
                  <div className="settings-modal__theme-list" role="radiogroup" aria-label="Built-in themes">
                    {BUILT_IN_THEMES.map((theme) => (
                      <ThemeOption
                        key={theme.id}
                        id={theme.id}
                        name={theme.name}
                        description={BUILT_IN_THEME_DESCRIPTIONS[theme.id] ?? 'Built-in theme'}
                        preview={BUILT_IN_THEME_PREVIEWS[theme.id]}
                        checked={activeThemeId === theme.id}
                        onSelect={onThemeSelect}
                      />
                    ))}
                  </div>
                </div>

              </section>
            ) : activeSection === 'prompts' ? (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">Prompts</h2>
                  <p className="settings-modal__subheading">
                    Edit the built-in campaign and rolling-summary prompt templates.
                  </p>
                </div>

                  <div className="settings-modal__field-grid">
                  <PromptTemplateEditor
                    id="settings-campaign-base-prompt"
                    label="Campaign Base Prompt"
                    hint="Sent before campaign context and character metadata for every chat reply."
                    value={campaignBasePromptValue}
                    defaultValue={DEFAULT_CAMPAIGN_BASE_PROMPT}
                    disabled={isSaving}
                    onChange={setCampaignBasePromptValue}
                    onReset={() => {
                      void handlePromptReset('campaignBasePrompt')
                    }}
                  />
                  <PromptTemplateEditor
                    id="settings-rolling-summary-prompt"
                    label="Rolling Summary Prompt"
                    hint="Used when generating or rebuilding the rolling continuity summary."
                    value={rollingSummarySystemPromptValue}
                    defaultValue={DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT}
                    disabled={isSaving}
                    onChange={setRollingSummarySystemPromptValue}
                    onReset={() => {
                      void handlePromptReset('rollingSummarySystemPrompt')
                    }}
                  />
                </div>

                <div className="settings-modal__prompt-actions">
                  <button
                    type="button"
                    className="modal-footer__button modal-footer__button--primary"
                    onClick={() => {
                      void handlePromptTemplatesSave()
                    }}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save Prompts'}
                  </button>
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
                    Chat appearance and output formatting settings.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <label className="settings-modal__toggle" htmlFor="settings-chat-show-markup">
                    <span className="settings-modal__toggle-body">
                      <span className="settings-modal__label">Show Chat Markup</span>
                      <span className="settings-modal__field-hint">
                        Reveal inline formatting markers from AI output and highlight the normally hidden parts.
                      </span>
                    </span>
                    <input
                      id="settings-chat-show-markup"
                      className="settings-modal__toggle-input"
                      type="checkbox"
                      checked={showChatMarkup}
                      onChange={(event) => onShowChatMarkupToggle(event.target.checked)}
                    />
                  </label>
                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-chat-text-size">
                      Chat Text Size
                    </label>
                    <select
                      id="settings-chat-text-size"
                      className="settings-modal__select app-select"
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
                  <div className="settings-modal__field">
                    <PromptTemplateEditor
                      id="settings-formatting-rules"
                      label="Formatting Rules"
                      hint="Appended to the campaign prompt last, so these rules can override the default chat output format."
                      value={formattingRulesValue}
                      defaultValue={DEFAULT_CHAT_FORMATTING_RULES}
                      disabled={isSaving}
                      onChange={setFormattingRulesValue}
                      onReset={() => {
                        void handlePromptReset('formattingRules')
                      }}
                    />
                  </div>
                  <div className="settings-modal__field">
                    <div className="settings-modal__field-row">
                      <label className="settings-modal__label" htmlFor="settings-assistant-reveal-delay">
                        Response Reveal Delay
                      </label>
                      <span className="settings-modal__value-pill">
                        {assistantRevealDelaySeconds.toFixed(1)}s
                      </span>
                    </div>
                    <div className="settings-modal__slider-row">
                      <input
                        id="settings-assistant-reveal-delay"
                        className="settings-modal__slider"
                        type="range"
                        min="0"
                        max={ASSISTANT_REVEAL_DELAY_MAX_SECONDS.toString()}
                        step="0.1"
                        value={assistantRevealDelaySeconds.toString()}
                        onChange={(event) => {
                          onAssistantResponseRevealDelayChange(Math.round(Number(event.target.value) * 1000))
                        }}
                      />
                      <button
                        type="button"
                        className="settings-modal__refresh-btn"
                        onClick={() => onAssistantResponseRevealDelayChange(ASSISTANT_REVEAL_DELAY_DEFAULT_MS)}
                        disabled={assistantResponseRevealDelayMs === ASSISTANT_REVEAL_DELAY_DEFAULT_MS}
                      >
                        Reset
                      </button>
                    </div>
                    <p className="settings-modal__field-hint">
                      Holds the typing indicator for at least this long before assistant text begins to appear.
                    </p>
                  </div>
                </div>
                <div className="settings-modal__prompt-actions">
                  <button
                    type="button"
                    className="modal-footer__button modal-footer__button--primary"
                    onClick={() => {
                      void handlePromptTemplatesSave()
                    }}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save Chat Settings'}
                  </button>
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
                      className="settings-modal__select app-select"
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
                      className="settings-modal__select app-select"
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
        )}
        footer={(
          <ModalFooter
            status={
              statusMessage ? (
                <p className={`settings-modal__status settings-modal__status--${statusKind ?? 'success'}`}>
                  {statusMessage}
                </p>
              ) : undefined
            }
            actions={(
              <>
                <button type="button" className="modal-footer__button" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="modal-footer__button modal-footer__button--primary"
                  onClick={() => {
                    void handleSaveSettings()
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
              </>
            )}
          />
        )}
      />
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
  /** Optional miniature palette used to render a theme preview card. */
  preview?: ThemePreviewPalette
  /** Whether the option is the current active theme. */
  checked: boolean
  /** Called when the user selects the option. */
  onSelect: (themeId: string) => void
}

/**
 * ThemeOption
 * Single radio-style option used in the theme settings lists.
 */
function ThemeOption({ id, name, description, preview, checked, onSelect }: ThemeOptionProps) {
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
        {preview ? (
          <span
            className="settings-modal__theme-card"
            aria-hidden="true"
            style={
              {
                '--theme-preview-app-bg': preview.appBg,
                '--theme-preview-panel-bg': preview.panelBg,
                '--theme-preview-surface-bg': preview.surfaceBg,
                '--theme-preview-accent': preview.accent,
                '--theme-preview-text-primary': preview.textPrimary,
                '--theme-preview-text-secondary': preview.textSecondary,
                '--theme-preview-user-message': preview.userMessage,
              } as React.CSSProperties
            }
          >
            <span className="settings-modal__theme-card-sidebar">
              <span className="settings-modal__theme-card-pill settings-modal__theme-card-pill--accent" />
              <span className="settings-modal__theme-card-pill" />
              <span className="settings-modal__theme-card-pill settings-modal__theme-card-pill--muted" />
            </span>
            <span className="settings-modal__theme-card-main">
              <span className="settings-modal__theme-card-header">
                <span className="settings-modal__theme-card-title" />
                <span className="settings-modal__theme-card-dot" />
              </span>
              <span className="settings-modal__theme-card-message" />
              <span className="settings-modal__theme-card-message settings-modal__theme-card-message--user" />
              <span className="settings-modal__theme-card-composer" />
            </span>
          </span>
        ) : null}
      </span>
    </label>
  )
}

/** Props accepted by the PromptTemplateEditor component. */
interface PromptTemplateEditorProps {
  /** Stable field id used for the textarea and label. */
  id: string
  /** Human-readable prompt name. */
  label: string
  /** Supporting hint shown below the editor. */
  hint: string
  /** Current editable prompt value. */
  value: string
  /** Bundled default prompt value used for reset-state comparison. */
  defaultValue: string
  /** Disable actions while a save is in flight. */
  disabled: boolean
  /** Called when the prompt text changes. */
  onChange: (value: string) => void
  /** Called when the user restores the bundled default. */
  onReset: () => void
}

/**
 * PromptTemplateEditor
 * Multiline prompt editor with a one-click reset back to the bundled default.
 */
function PromptTemplateEditor({
  id,
  label,
  hint,
  value,
  defaultValue,
  disabled,
  onChange,
  onReset,
}: PromptTemplateEditorProps) {
  const isDefaultValue = value === defaultValue

  return (
    <div className="settings-modal__prompt-editor">
      <div className="settings-modal__field-row">
        <label className="settings-modal__label" htmlFor={id}>
          {label}
        </label>
        <button
          type="button"
          className="settings-modal__refresh-btn"
          onClick={onReset}
          disabled={disabled || isDefaultValue}
        >
          Reset to Default
        </button>
      </div>
      <textarea
        id={id}
        className="settings-modal__textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={14}
        disabled={disabled}
        spellCheck={false}
      />
      <p className="settings-modal__field-hint">{hint}</p>
    </div>
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
