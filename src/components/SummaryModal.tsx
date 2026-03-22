/**
 * src/components/SummaryModal.tsx
 * Modal dialog for viewing and rebuilding the active session's rolling summary.
 */

import { Modal } from './Modal'
import { ModalFormLayout, ModalFooter } from './ModalLayouts'
import '../styles/summary-modal.css'

/** Props accepted by the SummaryModal component. */
interface SummaryModalProps {
  /** The current rolling summary text, or empty string if none exists. */
  summary: string
  /** True while a summary rebuild is in progress. */
  isRebuilding: boolean
  /** Status message shown after a rebuild attempt. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** Close the modal. */
  onClose: () => void
  /** Trigger a summary rebuild. */
  onRebuild: () => void
}

/**
 * SummaryModal
 * Displays the rolling session summary and provides a rebuild action in the footer.
 */
export function SummaryModal({
  summary,
  isRebuilding,
  statusMessage,
  statusKind,
  onClose,
  onRebuild,
}: SummaryModalProps) {
  return (
    <Modal title="Current Summary" onClose={onClose}>
      <ModalFormLayout
        body={(
          <div className="summary-modal__body">
            {statusMessage ? (
              <div className={`summary-modal__status summary-modal__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : null}
            {summary.trim().length > 0 ? (
              <p className="summary-modal__text">{summary}</p>
            ) : (
              <p className="summary-modal__empty">No rolling summary has been generated for this session yet.</p>
            )}
          </div>
        )}
        footer={(
          <ModalFooter
            actions={(
              <button
                type="button"
                className="modal-footer__button"
                onClick={onRebuild}
                disabled={isRebuilding}
              >
                {isRebuilding ? 'Rebuilding Summary...' : 'Rebuild Summary'}
              </button>
            )}
          />
        )}
      />
    </Modal>
  )
}
