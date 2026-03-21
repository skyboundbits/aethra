/**
 * src/components/ModelLoaderModal.tsx
 * Modal dialog for loading a model into text-generation-webui with chosen runtime options.
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { SparklesIcon } from './icons'
import { formatBytes } from '../services/modelFitService'
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
import '../styles/model-loader.css'

import type { BinaryInstallProgress, LocalRuntimeStatus, ModelFitEstimate, ModelPreset, ServerKind } from '../types'

const CONTEXT_WINDOW_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072]
const TEMPERATURE_OPTIONS = ['0.1', '0.3', '0.5', '0.7', '0.9', '1.0', '1.2', '1.5']

/** Props accepted by the ModelLoaderModal component. */
interface ModelLoaderModalProps {
  /** Provider kind for the currently selected server. */
  serverKind: ServerKind | null
  /** Models available for the selected server. */
  models: ModelPreset[]
  /** Currently active model slug, if one is selected. */
  activeModelSlug: string | null
  /** Current heuristic fit guidance for the active local model. */
  fitEstimate: ModelFitEstimate | null
  /** Current managed local runtime state. */
  localRuntimeStatus: LocalRuntimeStatus | null
  /** Optional status text shown above the form. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while a load request is in flight. */
  isBusy: boolean
  /** Close handler for the modal. */
  onClose: () => void
  /** Called when the user requests a model load. */
  onLoadModel: (modelSlug: string, contextWindowTokens: number, temperature: number) => Promise<void>
  /** Current llama-server binary install progress, or null. */
  binaryInstallProgress: BinaryInstallProgress | null
  /** Called when the user requests a binary install from within this modal. */
  onInstallBinary: () => void
  /** Binary check result for the active server — null if not a local llama.cpp server. */
  binaryCheckResult: {
    found: boolean
    detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
    estimatedSizeMb: number
  } | null
}

/**
 * ModelLoaderModal
 * Renders a focused form for selecting a text-generation-webui model and context size.
 */
export function ModelLoaderModal({
  serverKind,
  models,
  activeModelSlug,
  fitEstimate,
  localRuntimeStatus,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onLoadModel,
  binaryInstallProgress,
  onInstallBinary,
  binaryCheckResult,
}: ModelLoaderModalProps) {
  const isLocalProvider = serverKind === 'llama.cpp'
  const [selectedModelSlug, setSelectedModelSlug] = useState(activeModelSlug ?? models[0]?.slug ?? '')
  const [selectedContextWindow, setSelectedContextWindow] = useState('8192')
  const [selectedTemperature, setSelectedTemperature] = useState('0.7')
  const [showBinaryBanner, setShowBinaryBanner] = useState(false)

  /**
   * Keep the model field synced with the current server/model selection.
   */
  useEffect(() => {
    setSelectedModelSlug(activeModelSlug ?? models[0]?.slug ?? '')
  }, [activeModelSlug, models])

  /**
   * Keep the context field aligned with the current model, falling back to a sane default.
   */
  useEffect(() => {
    const activeModel = models.find((model) => model.slug === (activeModelSlug ?? selectedModelSlug))
    setSelectedContextWindow((activeModel?.contextWindowTokens ?? 8192).toString())
  }, [activeModelSlug, models, selectedModelSlug])

  /**
   * Keep the temperature field aligned with the current model, falling back to
   * the default chat sampling temperature.
   */
  useEffect(() => {
    const activeModel = models.find((model) => model.slug === (activeModelSlug ?? selectedModelSlug))
    setSelectedTemperature((activeModel?.temperature ?? 0.7).toString())
  }, [activeModelSlug, models, selectedModelSlug])

  /**
   * Submit the model load request.
   * Intercepts the "Could not find llama-server" error to show the binary install banner
   * instead of propagating it to the outer error handler.
   */
  const handleLoad = useCallback(async (): Promise<void> => {
    setShowBinaryBanner(false)
    const normalizedContextWindow = Number(selectedContextWindow)
    const normalizedTemperature = Number(selectedTemperature)
    try {
      await onLoadModel(selectedModelSlug, normalizedContextWindow, normalizedTemperature)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Could not find llama-server')) {
        setShowBinaryBanner(true)
        return
      }
      throw err
    }
  }, [onLoadModel, selectedModelSlug, selectedContextWindow, selectedTemperature])

  /**
   * Auto-retry the load once a binary install completes successfully.
   */
  useEffect(() => {
    if (binaryInstallProgress?.status !== 'complete') return
    if (!showBinaryBanner) return
    setShowBinaryBanner(false)
    void handleLoad()
  }, [binaryInstallProgress?.status, showBinaryBanner, handleLoad])

  return (
    <Modal
      title={(
        <>
          <SparklesIcon className="modal__title-icon" aria-hidden="true" />
          <span>Load Model</span>
        </>
      )}
      onClose={onClose}
      className="modal--model-loader"
    >
      <div className="model-loader">
        {statusMessage ? (
          <div className={`model-loader__status model-loader__status--${statusKind ?? 'success'}`}>
            {statusMessage}
          </div>
        ) : null}

        {models.length === 0 ? (
          <div className="model-loader__empty">
            No models are available yet. Use Browse Models in Settings first.
          </div>
        ) : (
          <>
            <div className="model-loader__intro">
              {isLocalProvider
                ? 'Pick a local GGUF model to start in llama.cpp. Saved per-model load settings are reused when the runtime starts.'
                : 'Pick a text-generation-webui model to load into memory and choose the context size to request.'}
            </div>

            {isLocalProvider && localRuntimeStatus ? (
              <div className={`model-loader__runtime${localRuntimeStatus.state === 'error' ? ' model-loader__runtime--error' : ''}`}>
                Runtime: {localRuntimeStatus.state}{localRuntimeStatus.modelSlug ? ` • ${localRuntimeStatus.modelSlug}` : ''}
                {localRuntimeStatus.state === 'error' && localRuntimeStatus.lastError ? (
                  <span className="model-loader__runtime-error"> — {localRuntimeStatus.lastError}</span>
                ) : null}
              </div>
            ) : null}

            <div className="model-loader__field">
              <label className="model-loader__label" htmlFor="model-loader-model">
                Model
              </label>
              <select
                id="model-loader-model"
                className="model-loader__input"
                value={selectedModelSlug}
                onChange={(event) => setSelectedModelSlug(event.target.value)}
                disabled={isBusy}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.slug}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="model-loader__field">
              <label className="model-loader__label" htmlFor="model-loader-context">
                Context Length
              </label>
              <select
                id="model-loader-context"
                className="model-loader__input"
                value={selectedContextWindow}
                onChange={(event) => setSelectedContextWindow(event.target.value)}
                disabled={isBusy}
              >
                {Array.from(new Set([
                  ...CONTEXT_WINDOW_OPTIONS,
                  ...models
                    .map((model) => model.contextWindowTokens)
                    .filter((value): value is number => typeof value === 'number' && value > 0),
                ]))
                  .sort((left, right) => left - right)
                  .map((value) => (
                    <option key={value} value={value.toString()}>
                      {value >= 1024 ? `${value.toLocaleString()} tokens` : value.toString()}
                    </option>
                  ))}
              </select>
            </div>

            <div className="model-loader__field">
              <label className="model-loader__label" htmlFor="model-loader-temperature">
                Temperature
              </label>
              <select
                id="model-loader-temperature"
                className="model-loader__input"
                value={selectedTemperature}
                onChange={(event) => setSelectedTemperature(event.target.value)}
                disabled={isBusy}
              >
                {Array.from(new Set([
                  ...TEMPERATURE_OPTIONS,
                  ...models
                    .map((model) => model.temperature)
                    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
                    .map((value) => value.toString()),
                ]))
                  .sort((left, right) => Number(left) - Number(right))
                  .map((value) => (
                    <option key={value} value={value}>
                      {Number(value).toFixed(1)}
                    </option>
                  ))}
              </select>
            </div>

            {isLocalProvider && fitEstimate ? (
              <div className={`model-loader__fit model-loader__fit--${fitEstimate.level}`}>
                <strong>GPU Fit Estimate</strong>
                <span>{fitEstimate.message}</span>
                {fitEstimate.estimatedVramBytes !== null || fitEstimate.availableVramBytes !== null ? (
                  <span>
                    Est. VRAM: {formatBytes(fitEstimate.estimatedVramBytes)} / Available: {formatBytes(fitEstimate.availableVramBytes)}
                  </span>
                ) : null}
              </div>
            ) : null}

            {showBinaryBanner && binaryCheckResult ? (
              <LlamaBinaryBanner
                detectedBackend={binaryCheckResult.detectedBackend}
                estimatedSizeMb={binaryCheckResult.estimatedSizeMb}
                progress={binaryInstallProgress}
                onInstall={onInstallBinary}
              />
            ) : null}

            <div className="model-loader__footer">
              <p className="model-loader__hint">
                {isLocalProvider
                  ? 'The selected context length and saved local parameters are used when starting llama.cpp. Temperature still applies to future chat completions.'
                  : 'The selected context length is sent during model load, and the saved temperature is used for future chat completions.'}
              </p>
              <div className="model-loader__actions">
                <button type="button" className="model-loader__button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="model-loader__button model-loader__button--primary"
                  onClick={() => {
                    void handleLoad()
                  }}
                  disabled={
                    isBusy ||
                    selectedModelSlug.length === 0 ||
                    (showBinaryBanner &&
                      binaryInstallProgress != null &&
                      (binaryInstallProgress.status === 'detecting' ||
                        binaryInstallProgress.status === 'downloading' ||
                        binaryInstallProgress.status === 'extracting'))
                  }
                >
                  {isBusy ? 'Loading...' : 'Load Model'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
