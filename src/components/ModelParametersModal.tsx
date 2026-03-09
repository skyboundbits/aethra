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
      temperature: number | null
      topP: number | null
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
  const [temperatureValue, setTemperatureValue] = useState('')
  const [topPValue, setTopPValue] = useState('')
  const [maxOutputTokensValue, setMaxOutputTokensValue] = useState('')
  const [presencePenaltyValue, setPresencePenaltyValue] = useState('')
  const [frequencyPenaltyValue, setFrequencyPenaltyValue] = useState('')

  /**
   * Keep form fields aligned with the selected model preset.
   */
  useEffect(() => {
    setTemperatureValue(model?.temperature?.toString() ?? '')
    setTopPValue(model?.topP?.toString() ?? '')
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
      temperature: parseOptionalNumber(temperatureValue),
      topP: parseOptionalNumber(topPValue),
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
              These settings apply to future chat requests for <strong>{model.name}</strong> and do not reload the model.
            </div>

            <div className="model-parameters__grid">
              <ParameterField
                id="model-parameters-temperature"
                label="Temperature"
                hint="Sampling randomness. Leave blank to use the server default."
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
                hint="Nucleus sampling cutoff from 0 to 1."
                value={topPValue}
                onChange={setTopPValue}
                min="0"
                max="1"
                step="0.01"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-max-output"
                label="Max Output Tokens"
                hint="Caps the number of tokens generated per reply."
                value={maxOutputTokensValue}
                onChange={setMaxOutputTokensValue}
                min="1"
                step="1"
                disabled={isBusy}
              />
              <ParameterField
                id="model-parameters-presence-penalty"
                label="Presence Penalty"
                hint="Encourages introducing new topics. Supported by OpenAI-style servers."
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
                hint="Reduces repeated tokens and phrases. Supported by OpenAI-style servers."
                value={frequencyPenaltyValue}
                onChange={setFrequencyPenaltyValue}
                min="-2"
                max="2"
                step="0.1"
                disabled={isBusy}
              />
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
  /** Helper text shown below the input. */
  hint: string
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
  hint,
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
      <p className="model-parameters__field-hint">{hint}</p>
    </div>
  )
}
