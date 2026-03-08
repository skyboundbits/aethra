/**
 * src/components/SettingsModal.tsx
 * Modal dialog for app-level settings, including theme selection and import.
 */

import { useRef } from 'react'
import { Modal } from './Modal'
import { BUILT_IN_THEMES } from '../services/themeService'
import '../styles/settings.css'

import type { ThemeDefinition } from '../types'

/** Props accepted by the SettingsModal component. */
interface SettingsModalProps {
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
  activeThemeId,
  customThemes,
  statusMessage,
  statusKind,
  onClose,
  onThemeSelect,
  onImportTheme,
}: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-modal">
        <section className="settings-modal__section">
          <div className="settings-modal__heading-row">
            <div>
              <h2 className="settings-modal__heading">Themes</h2>
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

          {statusMessage ? (
            <div className={`settings-modal__status settings-modal__status--${statusKind ?? 'success'}`}>
              {statusMessage}
            </div>
          ) : null}

          <div className="settings-modal__group">
            <div className="settings-modal__group-title">Built-in</div>
            <div className="settings-modal__theme-list" role="radiogroup" aria-label="Built-in themes">
              {BUILT_IN_THEMES.map((theme) => (
                <ThemeOption
                  key={theme.id}
                  id={theme.id}
                  name={theme.name}
                  description={theme.mode === 'light' ? 'Light built-in theme' : 'Default built-in theme'}
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
      </div>
    </Modal>
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
  /** Whether the option is the current active theme. */
  checked: boolean
  /** Called when the user selects the option. */
  onSelect: (themeId: string) => void
}

/**
 * ThemeOption
 * Single radio-style option used in the theme settings lists.
 */
function ThemeOption({ id, name, description, checked, onSelect }: ThemeOptionProps) {
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
      </span>
    </label>
  )
}
