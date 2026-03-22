/**
 * src/components/RawMessageModal.tsx
 * Popup modal for inspecting the raw persisted text of a single chat message.
 */

import { Modal } from './Modal'
import { ModalFooter, ModalPopupLayout } from './ModalLayouts'
import '../styles/raw-message-modal.css'

import type { Message } from '../types'

/** Props accepted by the RawMessageModal component. */
interface RawMessageModalProps {
  /** Message whose raw persisted content should be displayed. */
  message: Message
  /** Close handler for the modal. */
  onClose: () => void
}

/**
 * RawMessageModal
 * Renders a compact inspector showing the exact stored message body.
 */
export function RawMessageModal({ message, onClose }: RawMessageModalProps) {
  const speakerLabel = message.characterName?.trim() || message.role

  return (
    <Modal title="Raw Message Content" onClose={onClose} variant="popup" className="modal--raw-message">
      <ModalPopupLayout
        footer={(
          <ModalFooter
            status={(
              <p className="raw-message-modal__hint">
                Showing the stored transcript exactly as saved for {speakerLabel}.
              </p>
            )}
            actions={(
              <button type="button" className="modal-footer__button" onClick={onClose}>
                Close
              </button>
            )}
          />
        )}
      >
        <div className="raw-message-modal">
          <div className="raw-message-modal__meta">
            <span className="raw-message-modal__meta-item">
              <strong>Role:</strong> {message.role}
            </span>
            {message.characterName ? (
              <span className="raw-message-modal__meta-item">
                <strong>Speaker:</strong> {message.characterName}
              </span>
            ) : null}
            <span className="raw-message-modal__meta-item">
              <strong>Time:</strong> {new Date(message.timestamp).toLocaleString()}
            </span>
          </div>
          <pre className="raw-message-modal__content">{message.content}</pre>
        </div>
      </ModalPopupLayout>
    </Modal>
  )
}
