/**
 * src/components/SettingsModal.tsx
 * Modal dialog for app-level settings, including AI provider/model selection,
 * theme selection, and theme import.
 */

import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { BUILT_IN_THEMES } from '../services/themeService'
import '../styles/settings.css'

import type { AvailableModel, ModelPreset, ServerProfile, ThemeDefinition } from '../types'

type SettingsSectionId = 'interface' | 'ai'

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
  /** True while the app is refreshing the remote model list. */
  isBrowsingModels: boolean
  /** Currently active theme ID. */
  activeThemeId: string
  /** Imported custom themes available to select. */
  customThemes: ThemeDefinition[]
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
  /** Called when the user refreshes the model list for the active server. */
  onBrowseModels: () => void
  /** Called when the user saves a manually edited server address. */
  onSaveServerAddress: (serverId: string, baseUrl: string) => Promise<void>
  /** Called when the user selects a theme. */
  onThemeSelect: (themeId: string) => void
  /** Called when the user imports a theme JSON file. */
  onImportTheme: (file: File) => void
}

/**
 * SettingsModal
 * Renders theme settings for built-in and user-imported themes.
 */
export function SettingsModal({
  servers,
  models,
  activeServerId,
  activeModelSlug,
  availableModels,
  isBrowsingModels,
  activeThemeId,
  customThemes,
  statusMessage,
  statusKind,
  onClose,
  onServerSelect,
  onModelSelect,
  onBrowseModels,
  onSaveServerAddress,
  onThemeSelect,
  onImportTheme,
}: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('interface')
  const [serverAddressValue, setServerAddressValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const activeServer = servers.find((server) => server.id === activeServerId) ?? servers[0] ?? null
  const visibleModels = activeServer
    ? models.filter((model) => model.serverId === activeServer.id)
    : []
  const modelOptions = availableModels.length > 0 ? availableModels : visibleModels

  /**
   * Keep the manual address field synced with the selected server profile.
   */
  useEffect(() => {
    setServerAddressValue(activeServer?.baseUrl ?? '')
  }, [activeServer?.baseUrl, activeServer?.id])

  /**
   * Open the hidden file input for theme import.
   */
  function handlePickFile(): void {
    fileInputRef.current?.click()
  }

  /**
   * Handle file selection from the hidden theme import input.
   *
   * @param e - File input change event.
   */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return

    onImportTheme(file)
    e.target.value = ''
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
   * Close the modal from the footer action row.
   * Settings are already persisted as fields change.
   */
  async function handleSaveAndClose(): Promise<void> {
    if (activeSection === 'ai' && activeServer) {
      setIsSaving(true)
      try {
        await onSaveServerAddress(activeServer.id, serverAddressValue)
      } finally {
        setIsSaving(false)
      }
    }

    onClose()
  }

  return (
    <Modal title="Settings" onClose={onClose} className="modal--settings">
      <div className="settings-modal">
        <div className="settings-modal__body">
          <nav className="settings-modal__nav" aria-label="Settings sections">
            <SettingsSectionTab
              id="interface"
              label="Interface"
              description="Themes and appearance"
              activeSection={activeSection}
              onSelect={handleSectionSelect}
            />
            <SettingsSectionTab
              id="ai"
              label="AI"
              description="Local server and model"
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
                          swatches={undefined}
                          checked={activeThemeId === theme.id}
                          onSelect={onThemeSelect}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="settings-modal__section">
                <div>
                  <h2 className="settings-modal__heading">AI</h2>
                  <p className="settings-modal__subheading">
                    Choose the local server and default model used for new completions.
                  </p>
                </div>

                <div className="settings-modal__field-grid">
                  <div className="settings-modal__field">
                    <label className="settings-modal__label" htmlFor="settings-server-select">
                      Server
                    </label>
                    <select
                      id="settings-server-select"
                      className="settings-modal__select"
                      value={activeServer?.id ?? ''}
                      onChange={(event) => onServerSelect(event.target.value)}
                      disabled={servers.length === 0}
                    >
                      {servers.length === 0 ? (
                        <option value="">No servers configured</option>
                      ) : (
                        servers.map((server) => (
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
                      Enter the full OpenAI-compatible base URL for the selected server.
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
                            description={model.slug}
                            checked={activeModelSlug === model.slug}
                            onSelect={onModelSelect}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="settings-modal__footer">
          <p className="settings-modal__footer-note">
            Theme, server, and model selections apply immediately. Save Settings stores the server address and closes this dialog.
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

interface SettingsSectionTabProps {
  /** Section identifier. */
  id: SettingsSectionId
  /** Heading shown in the left nav. */
  label: string
  /** Supporting copy shown under the heading. */
  description: string
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
      <span className="settings-modal__nav-label">{label}</span>
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
