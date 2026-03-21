/**
 * src/components/LlamaBinaryBanner.tsx
 * Shared banner component displayed when the llama-server binary is missing.
 * Shows a prompt to auto-download, live progress during install, and error/retry
 * state on failure. Used in SettingsModal and ModelLoaderModal.
 */

import React from 'react'
import type { BinaryInstallProgress } from '../types'
import '../styles/binary-install.css'

/** Props for LlamaBinaryBanner. */
interface LlamaBinaryBannerProps {
  /** Detected backend display name (e.g. 'CUDA', 'Metal'). */
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  /** Estimated download size in MB. */
  estimatedSizeMb: number
  /** Current install progress from the main process, or null if not installing. */
  progress: BinaryInstallProgress | null
  /** Called when the user clicks Download or Retry. */
  onInstall: () => void
}

/**
 * Banner shown when llama-server binary is absent or being installed.
 * Renders prompt, progress bar, or error state depending on progress.status.
 */
export function LlamaBinaryBanner({
  detectedBackend,
  estimatedSizeMb,
  progress,
  onInstall,
}: LlamaBinaryBannerProps): React.ReactElement {
  const isInstalling =
    progress !== null &&
    (progress.status === 'detecting' ||
      progress.status === 'downloading' ||
      progress.status === 'extracting')

  const isError = progress?.status === 'error'
  const percent = progress?.percent ?? null

  if (isInstalling) {
    let label: string
    if (progress.status === 'extracting') {
      label = 'Extracting…'
    } else if (progress.status === 'detecting') {
      label = 'Detecting platform…'
    } else {
      const backend = progress.backend ?? detectedBackend
      label = `Downloading llama-server (${backend})…${percent != null ? `  ${percent}%` : ''}`
    }

    return (
      <div className="binary-banner">
        <div className="binary-banner__message">{label}</div>
        <div className="binary-install-progress">
          <div
            className="binary-install-progress__bar"
            style={{ width: percent != null ? `${percent}%` : '0%' }}
          />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="binary-banner binary-banner--error">
        <div className="binary-banner__header">
          <span className="binary-banner__title">Download failed</span>
        </div>
        <div className="binary-banner__message binary-banner__message--error">
          {progress.message}
        </div>
        <div className="binary-banner__actions">
          <button className="model-loader__button model-loader__button--primary" onClick={onInstall}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Default: prompt state
  return (
    <div className="binary-banner">
      <div className="binary-banner__header">
        <span className="binary-banner__title">llama-server not found</span>
      </div>
      <div className="binary-banner__subtitle">
        Auto-download the {detectedBackend} build? (~{estimatedSizeMb} MB)
      </div>
      <div className="binary-banner__actions">
        <button className="model-loader__button model-loader__button--primary" onClick={onInstall}>
          Download llama-server
        </button>
      </div>
    </div>
  )
}
