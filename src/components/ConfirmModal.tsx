/**
 * src/components/ConfirmModal.tsx
 * Reusable confirmation dialog built on Modal + ModalPopupLayout + ModalFooter.
 * Replaces native window.confirm() calls to avoid Electron focus-loss issues.
 */

import { Modal } from './Modal'
import { ModalFooter, ModalPopupLayout } from './ModalLayouts'

/** Props accepted by the ConfirmModal component. */
interface ConfirmModalProps {
  /** Dialog heading. */
  title: string
  /** Primary message shown in the body. */
  message: string
  /** Optional warning text shown beneath the message in a distinct style. */
  warning?: string
  /** Label for the confirm action button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string
  /** Called when the user confirms. */
  onConfirm: () => void
  /** Called when the user cancels or closes the dialog. */
  onCancel: () => void
}

/**
 * ConfirmModal
 * A small confirmation dialog with optional warning text and configurable button labels.
 */
export function ConfirmModal({
  title,
  message,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel} variant="popup">
      <ModalPopupLayout
        footer={(
          <ModalFooter
            actions={(
              <>
                <button type="button" className="characters-modal__footer-btn" onClick={onCancel}>
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </button>
              </>
            )}
          />
        )}
      >
        <p className="confirm-modal__message">{message}</p>
        {warning ? <p className="confirm-modal__warning">{warning}</p> : null}
      </ModalPopupLayout>
    </Modal>
  )
}
