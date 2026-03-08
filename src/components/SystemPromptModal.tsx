/**
 * src/components/SystemPromptModal.tsx
 * Modal dialog used to edit the system prompt sent with each chat request.
 */

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import '../styles/system-prompt.css'

/** Props accepted by the SystemPromptModal component. */
interface SystemPromptModalProps {
  /** Current persisted system prompt value. */
  value: string
  /** Close handler for the modal. */
  onClose: () => void
  /** Save handler for the modal. */
  onSave: (value: string) => void
}

/**
 * SystemPromptModal
 * Renders a textarea for editing the prompt that is prepended to every chat.
 */
export function SystemPromptModal({ value, onClose, onSave }: SystemPromptModalProps) {
  const [draftValue, setDraftValue] = useState(value)

  /**
   * Keep the local draft aligned when the persisted value changes.
   */
  useEffect(() => {
    setDraftValue(value)
  }, [value])

  /**
   * Save the current draft if it contains non-whitespace content.
   */
  function handleSave(): void {
    const normalizedValue = draftValue.trim()
    if (!normalizedValue) return
    onSave(normalizedValue)
  }

  return (
    <Modal title="System Prompt" onClose={onClose} className="modal--system-prompt">
      <div className="system-prompt-modal">
        <p className="system-prompt-modal__copy">
          This prompt is sent as a system message before every chat request.
        </p>

        <textarea
          className="system-prompt-modal__textarea"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          rows={10}
          autoFocus
          aria-label="System prompt"
        />

        <div className="system-prompt-modal__actions">
          <button className="system-prompt-modal__button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="system-prompt-modal__button system-prompt-modal__button--primary"
            onClick={handleSave}
            disabled={!draftValue.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
