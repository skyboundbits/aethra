/**
 * src/components/ModelParametersModal.tsx
 * Modal dialog for editing runtime model parameters that apply to future chat requests.
 */

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { SlidersHorizontalIcon } from './icons'
import '../styles/model-parameters.css'

import type { ModelPreset } from '../types'

/** Props accepted by the ModelParametersModal component. */
interface ModelParametersModalProps {
  /** Active model preset whose runtime parameters are being edited. */
  model: ModelPreset | null
  /** Optional status text shown above the form. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while a save request is in flight. */
  isBusy: boolean
  /** Close handler for the modal. */
  onClose: () => void
  /** Called when the user saves the edited runtime parameters. */
  onSaveParameters: (
    modelSlug: string,
    values: {
      contextWindowTokens: number | null
      temperature: number | null
      topP: number | null
      topK: number | null
      repeatPenalty: number | null
      gpuLayers: number | null
      threads: number | null
      batchSize: number | null
      microBatchSize: number | null
      flashAttention: boolean
      maxOutputTokens: number | null
      presencePenalty: number | null
      frequencyPenalty: number | null
    },
  ) => Promise<void>
}

/**
 * ModelParametersModal
 * Focused form for editing the active model's runtime chat parameters.
 */
export function ModelParametersModal({
  model,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onSaveParameters,
}: ModelParametersModalProps) {
  const isLocalModel = model?.localPath !== undefined || model?.serverId === 'llama-cpp-local'
  const [contextWindowValue, setContextWindowValue] = useState('')
  const [temperatureValue, setTemperatureValue] = useState('')
  const [topPValue, setTopPValue] = useState('')
  const [topKValue, setTopKValue] = useState('')
  const [repeatPenaltyValue, setRepeatPenaltyValue] = useState('')
  const [gpuLayersValue, setGpuLayersValue] = useState('')
  const [threadsValue, setThreadsValue] = useState('')
  const [batchSizeValue, setBatchSizeValue] = useState('')
  const [microBatchSizeValue, setMicroBatchSizeValue] = useState('')
  const [flashAttentionEnabled, setFlashAttentionEnabled] = useState(true)
  const [maxOutputTokensValue, setMaxOutputTokensValue] = useState('')
  const [presencePenaltyValue, setPresencePenaltyValue] = useState('')
  const [frequencyPenaltyValue, setFrequencyPenaltyValue] = useState('')

  /**
   * Keep form fields aligned with the selected model preset.
   */
  useEffect(() => {
    setContextWindowValue(model?.contextWindowTokens?.toString() ?? '')
    setTemperatureValue(model?.temperature?.toString() ?? '')
    setTopPValue(model?.topP?.toString() ?? '')
    setTopKValue(model?.topK?.toString() ?? '')
    setRepeatPenaltyValue(model?.repeatPenalty?.toString() ?? '')
    setGpuLayersValue(model?.gpuLayers?.toString() ?? '')
    setThreadsValue(model?.threads?.toString() ?? '')
    setBatchSizeValue(model?.batchSize?.toString() ?? '')
    setMicroBatchSizeValue(model?.microBatchSize?.toString() ?? '')
    setFlashAttentionEnabled(model?.flashAttention ?? true)
    setMaxOutputTokensValue(model?.maxOutputTokens?.toString() ?? '')
    setPresencePenaltyValue(model?.presencePenalty?.toString() ?? '')
    setFrequencyPenaltyValue(model?.frequencyPenalty?.toString() ?? '')
  }, [model])

  /**
   * Convert a text field into an optional numeric value.
   *
   * @param value - Raw input string.
   * @returns Parsed number, or null when left blank.
   */
  function parseOptionalNumber(value: string): number | null {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : Number(trimmed)
  }

  /**
   * Persist the edited runtime parameter values.
   */
  async function handleSubmit(): Promise<void> {
    if (!model) {
      return
    }

    await onSaveParameters(model.slug, {
      contextWindowTokens: parseOptionalNumber(contextWindowValue),
      temperature: parseOptionalNumber(temperatureValue),
      topP: parseOptionalNumber(topPValue),
      topK: parseOptionalNumber(topKValue),
      repeatPenalty: parseOptionalNumber(repeatPenaltyValue),
      gpuLayers: parseOptionalNumber(gpuLayersValue),
      threads: parseOptionalNumber(threadsValue),
      batchSize: parseOptionalNumber(batchSizeValue),
      microBatchSize: parseOptionalNumber(microBatchSizeValue),
      flashAttention: flashAttentionEnabled,
      maxOutputTokens: parseOptionalNumber(maxOutputTokensValue),
      presencePenalty: parseOptionalNumber(presencePenaltyValue),
      frequencyPenalty: parseOptionalNumber(frequencyPenaltyValue),
    })
  }

  return (
    <Modal
      title={(
        <>
          <SlidersHorizontalIcon className="modal__title-icon" aria-hidden="true" />
          <span>Model Parameters</span>
        </>
      )}
      onClose={onClose}
      className="modal--model-parameters"
    >
      <div className="model-parameters">
        {statusMessage ? (
          <div className={`model-parameters__status model-parameters__status--${statusKind ?? 'success'}`}>
            {statusMessage}
          </div>
        ) : null}

        {model ? (
          <>
            <div className="model-parameters__intro">
              These settings are saved per model for <strong>{model.name}</strong>. Leave a field blank to keep the model or server default. Local llama.cpp load settings are reused the next time the model is started.
            </div>

            <div className="model-parameters__grid">
              <ParameterField
                id="model-parameters-context"
                label="Context Length"
                rangeDescription="whole numbers of 1 or more."
                impactDescription="higher values let the model remember more chat history, scene details, and character notes, but can increase memory use and may slow local replies."
                value={contextWindowValue}
                onChange={setContextWindowValue}
                min="1"
                step="1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-temperature"
                label="Temperature"
                rangeDescription="0 to 5."
                impactDescription="lower values make replies steadier and more literal; higher values make the roleplay more surprising, emotional, and improvisational, but can also cause inconsistency."
                value={temperatureValue}
                onChange={setTemperatureValue}
                min="0"
                max="5"
                step="0.1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-top-p"
                label="Top P"
                rangeDescription="0 to 1."
                impactDescription="lower values keep the model focused on safer word choices; higher values allow more varied phrasing and narrative turns. It overlaps with temperature, so large changes to both can make behavior harder to predict."
                value={topPValue}
                onChange={setTopPValue}
                min="0"
                max="1"
                step="0.01"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-top-k"
                label="Top K"
                rangeDescription="whole numbers of 0 or more."
                impactDescription="lower values narrow the model to a smaller shortlist of next-word options, which tends to make dialogue tighter and more conservative; higher values allow more unusual wording and turns. `0` usually means no explicit cap."
                value={topKValue}
                onChange={setTopKValue}
                min="0"
                step="1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-repeat-penalty"
                label="Repeat Penalty"
                rangeDescription="0 to 5."
                impactDescription="increasing this reduces repeated phrases, echoed narration, and looped mannerisms; pushing it too high can make a character avoid natural callbacks or consistent speech patterns."
                value={repeatPenaltyValue}
                onChange={setRepeatPenaltyValue}
                min="0"
                max="5"
                step="0.05"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-max-output"
                label="Max Output Tokens"
                rangeDescription="whole numbers of 1 or more."
                impactDescription="lower values force shorter replies and quicker turn-taking; higher values allow longer monologues, scene descriptions, and more complete actions before the response stops."
                value={maxOutputTokensValue}
                onChange={setMaxOutputTokensValue}
                min="1"
                step="1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-presence-penalty"
                label="Presence Penalty"
                rangeDescription="-2 to 2. Supported by OpenAI-style servers."
                impactDescription="higher values push the model to introduce fresher ideas, actions, or topics instead of revisiting the same ground; lower values make it more willing to stay on recurring themes and motifs."
                value={presencePenaltyValue}
                onChange={setPresencePenaltyValue}
                min="-2"
                max="2"
                step="0.1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-frequency-penalty"
                label="Frequency Penalty"
                rangeDescription="-2 to 2. Supported by OpenAI-style servers."
                impactDescription="higher values discourage repeated words and phrasing inside a reply, which can help with repetitive narration; lower values let the model reuse wording more freely, which can sometimes help maintain a deliberate voice."
                value={frequencyPenaltyValue}
                onChange={setFrequencyPenaltyValue}
                min="-2"
                max="2"
                step="0.1"
                disabled={isBusy}
              />
              {isLocalModel ? (
                <>
                  <ParameterField
                    id="model-parameters-gpu-layers"
                    label="GPU Layers"
                    rangeDescription="whole numbers of 0 or more. `999` means try to offload as much as possible."
                    impactDescription="this does not directly change writing style, but more GPU offload can make local roleplay faster and can let larger context settings feel usable on capable hardware."
                    value={gpuLayersValue}
                    onChange={setGpuLayersValue}
                    min="0"
                    step="1"
                    disabled={isBusy}
                  />
                  <ParameterField
                    id="model-parameters-threads"
                    label="Threads"
                    rangeDescription="whole numbers of 1 or more."
                    impactDescription="this changes local performance rather than tone. More threads can improve prompt processing speed on some systems, but overly high values can reduce responsiveness if they saturate the CPU."
                    value={threadsValue}
                    onChange={setThreadsValue}
                    min="1"
                    step="1"
                    disabled={isBusy}
                  />
                  <ParameterField
                    id="model-parameters-batch-size"
                    label="Batch Size"
                    rangeDescription="whole numbers of 1 or more."
                    impactDescription="this mainly affects how efficiently the local model ingests prompts and long history. Larger values can improve throughput on strong hardware, but may increase VRAM or RAM pressure."
                    value={batchSizeValue}
                    onChange={setBatchSizeValue}
                    min="1"
                    step="1"
                    disabled={isBusy}
                  />
                  <ParameterField
                    id="model-parameters-micro-batch-size"
                    label="Micro-Batch Size"
                    rangeDescription="whole numbers of 1 or more."
                    impactDescription="this is a memory-tuning control for local inference. Smaller values can improve stability on limited hardware; larger values can improve speed if your system has headroom."
                    value={microBatchSizeValue}
                    onChange={setMicroBatchSizeValue}
                    min="1"
                    step="1"
                    disabled={isBusy}
                  />
                  <div className="model-parameters__field">
                    <label className="model-parameters__label" htmlFor="model-parameters-flash-attn">
                      Flash Attention
                    </label>
                    <label className="model-parameters__checkbox">
                      <input
                        id="model-parameters-flash-attn"
                        type="checkbox"
                        checked={flashAttentionEnabled}
                        onChange={(event) => setFlashAttentionEnabled(event.target.checked)}
                        disabled={isBusy}
                      />
                      <span>Enable flash attention for this local model</span>
                    </label>
                    <p className="model-parameters__field-hint"><strong>Accepted values:</strong> On or Off.</p>
                    <p className="model-parameters__field-hint">
                      <strong>Roleplay impact:</strong> this usually changes local speed and memory efficiency rather than the character voice itself. Disable it if your GPU or backend has compatibility issues.
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            <div className="model-parameters__footer">
              <p className="model-parameters__hint">
                Changes are saved to the active model preset and are used on the next response stream.
              </p>
              <div className="model-parameters__actions">
                <button type="button" className="model-parameters__button" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="model-parameters__button model-parameters__button--primary"
                  onClick={() => {
                    void handleSubmit()
                  }}
                  disabled={isBusy}
                >
                  {isBusy ? 'Saving...' : 'Save Parameters'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="model-parameters__empty">
            Select a model first, then open this dialog to adjust runtime parameters.
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Props accepted by the ParameterField component. */
interface ParameterFieldProps {
  /** Input id and label target. */
  id: string
  /** Field label shown above the input. */
  label: string
  /** Accepted value range shown below the input. */
  rangeDescription: string
  /** Roleplay-focused explanation shown below the range. */
  impactDescription: string
  /** Controlled input value. */
  value: string
  /** Called when the field value changes. */
  onChange: (value: string) => void
  /** Optional numeric input minimum. */
  min?: string
  /** Optional numeric input maximum. */
  max?: string
  /** Optional numeric input step. */
  step?: string
  /** Whether the field is disabled. */
  disabled: boolean
}

/**
 * ParameterField
 * Shared numeric input row used by the runtime parameter modal.
 */
function ParameterField({
  id,
  label,
  rangeDescription,
  impactDescription,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: ParameterFieldProps) {
  return (
    <div className="model-parameters__field">
      <label className="model-parameters__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="model-parameters__input"
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
      <p className="model-parameters__field-hint"><strong>Accepted values:</strong> {rangeDescription}</p>
      <p className="model-parameters__field-hint"><strong>Roleplay impact:</strong> {impactDescription}</p>
    </div>
  )
}
