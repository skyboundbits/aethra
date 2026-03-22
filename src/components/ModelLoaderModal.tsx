/**
 * src/components/ModelLoaderModal.tsx
 * Modal dialog for loading a model into text-generation-webui with chosen runtime options.
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalFormLayout } from './ModalLayouts'
import { SparklesIcon } from './icons'
import { formatBytes } from '../services/modelFitService'
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
import '../styles/model-loader.css'

import type { BinaryInstallProgress, LocalRuntimeStatus, ModelFitEstimate, ModelPreset, ServerKind, ServerProfile } from '../types'

const CONTEXT_WINDOW_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072]
const TEMPERATURE_OPTIONS = ['0.1', '0.3', '0.5', '0.7', '0.9', '1.0', '1.2', '1.5']

/** Props accepted by the ModelLoaderModal component. */
interface ModelLoaderModalProps {
  /** Compatible model sources shown in the dropdown. */
  servers: ServerProfile[]
  /** Currently selected source/server id. */
  selectedServerId: string | null
  /** Called when the user switches the model source. */
  onSelectServer: (serverId: string) => void
  /** Provider kind for the currently selected server. */
  serverKind: ServerKind | null
  /** Models available for the selected source. */
  models: ModelPreset[]
  /** Currently selected model slug for the chosen source, if any. */
  currentModelSlug: string | null
  /** True when the chosen source already has a model selected or running. */
  hasLoadedModel: boolean
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
  servers,
  selectedServerId,
  onSelectServer,
  serverKind,
  models,
  currentModelSlug,
  hasLoadedModel,
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
  const isLmStudioProvider = serverKind === 'lmstudio'
  const [selectedModelSlug, setSelectedModelSlug] = useState(currentModelSlug ?? models[0]?.slug ?? '')
  const [selectedContextWindow, setSelectedContextWindow] = useState('8192')
  const [selectedTemperature, setSelectedTemperature] = useState('0.7')
  const [showBinaryBanner, setShowBinaryBanner] = useState(false)

  /**
   * Return a concise human-readable source label for a configured server.
   *
   * @param server - Source/server option displayed in the selector.
   * @returns Dropdown label combining category and server name.
   */
  function getSourceLabel(server: ServerProfile): string {
    switch (server.kind) {
      case 'lmstudio':
        return `Local • ${server.name}`
      case 'text-generation-webui':
        return `Remote • ${server.name}`
      case 'llama.cpp':
        return `Embedded • ${server.name}`
      default:
        return server.name
    }
  }

  /**
   * Return the main action label for the selected provider.
   *
   * @returns Provider-specific call-to-action text.
   */
  function getPrimaryActionLabel(): string {
    if (isBusy) {
      return isLmStudioProvider ? 'Selecting...' : 'Loading...'
    }

    return isLmStudioProvider ? 'Use Model' : 'Load Model'
  }

  /**
   * Keep the model field synced with the current server/model selection.
   */
  useEffect(() => {
    setSelectedModelSlug(currentModelSlug ?? models[0]?.slug ?? '')
  }, [currentModelSlug, models])

  /**
   * Keep the context field aligned with the current model, falling back to a sane default.
   */
  useEffect(() => {
    const activeModel = models.find((model) => model.slug === (currentModelSlug ?? selectedModelSlug))
    setSelectedContextWindow((activeModel?.contextWindowTokens ?? 8192).toString())
  }, [currentModelSlug, models, selectedModelSlug])

  /**
   * Keep the temperature field aligned with the current model, falling back to
   * the default chat sampling temperature.
   */
  useEffect(() => {
    const activeModel = models.find((model) => model.slug === (currentModelSlug ?? selectedModelSlug))
    setSelectedTemperature((activeModel?.temperature ?? 0.7).toString())
  }, [currentModelSlug, models, selectedModelSlug])

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

  /**
   * Reset any inline llama.cpp install banner when the source changes.
   */
  useEffect(() => {
    setShowBinaryBanner(false)
  }, [selectedServerId])

  return (
    <Modal
      title={(
        <>
          <SparklesIcon className="modal__title-icon" aria-hidden="true" />
          <span>Load Model</span>
        </>
      )}
      onClose={onClose}
      variant="form"
      className="modal--model-loader"
    >
      <ModalFormLayout
        body={(
          <div className="model-loader">
            {statusMessage ? (
              <div className={`model-loader__status model-loader__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : null}

            {servers.length === 0 ? (
              <div className="model-loader__empty">
                No compatible model sources are configured yet.
              </div>
            ) : (
              <>
                <div className="model-loader__field">
                  <label className="model-loader__label" htmlFor="model-loader-source">
                    Model Source
                  </label>
                  <select
                    id="model-loader-source"
                    className="model-loader__input"
                    value={selectedServerId ?? ''}
                    onChange={(event) => onSelectServer(event.target.value)}
                    disabled={isBusy}
                  >
                    {servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {getSourceLabel(server)}
                      </option>
                    ))}
                  </select>
                </div>

                {models.length === 0 ? (
                  <div className="model-loader__empty">
                    No models are available for this source yet. Use Browse Models in Settings first.
                  </div>
                ) : (
                  <>
                <div className="model-loader__intro">
                  {isLmStudioProvider
                    ? 'Pick a model exposed by LM Studio. Aethra will switch to it here, but loading still happens inside LM Studio.'
                    : isLocalProvider
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
                  </>
                )}
              </>
            )}
          </div>
        )}
        footer={(
          <ModalFooter
            actions={(
              <>
                <button type="button" className="modal-footer__button" onClick={onClose}>
                  {hasLoadedModel ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="button"
                  className="modal-footer__button modal-footer__button--primary"
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
                  {getPrimaryActionLabel()}
                </button>
              </>
            )}
          />
        )}
      />
    </Modal>
  )
}
