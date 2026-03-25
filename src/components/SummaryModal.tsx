/**
 * src/components/SummaryModal.tsx
 * Modal dialog for viewing and rebuilding the active scene's rolling summary.
 * Rebuilding always generates a relationship-focused narrative summary alongside it.
 */

import { Modal } from './Modal'
import { ModalFormLayout, ModalFooter } from './ModalLayouts'
import '../styles/summary-modal.css'

/** Props accepted by the SummaryModal component. */
interface SummaryModalProps {
  /** The current rolling summary text, or empty string if none exists. */
  summary: string
  /** Pass 1 relationship-focused prose summary, or null if never generated. */
  relationshipNarrativeSummary: string | null
  /** True while a summary rebuild is in progress. */
  isRebuilding: boolean
  /** True while a relationship refresh is in progress. */
  isRefreshingRelationships: boolean
  /** Status message shown after a rebuild attempt. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** Close the modal. */
  onClose: () => void
  /** Trigger a summary rebuild (always includes relationship narrative generation). */
  onRebuild: () => void
}

/**
 * SummaryModal
 * Displays rolling scene summary and relationship narrative.
 * Rebuilding always generates both summaries together.
 */
export function SummaryModal({
  summary,
  relationshipNarrativeSummary,
  isRebuilding,
  isRefreshingRelationships,
  statusMessage,
  statusKind,
  onClose,
  onRebuild,
}: SummaryModalProps) {
  const isProcessing = isRebuilding || isRefreshingRelationships

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

            {/* Scene Summary Section */}
            <div className="summary-modal__section">
              <h3 className="summary-modal__section-heading">Scene Summary</h3>
              {summary.trim().length > 0 ? (
                <p className="summary-modal__text">{summary}</p>
              ) : (
                <p className="summary-modal__empty">No rolling summary has been generated for this scene yet.</p>
              )}
            </div>

            {/* Relationship Summary Section */}
            <div className="summary-modal__section">
              <h3 className="summary-modal__section-heading">Relationship Summary</h3>
              {relationshipNarrativeSummary?.trim() ? (
                <p className="summary-modal__text">{relationshipNarrativeSummary}</p>
              ) : (
                <p className="summary-modal__empty">
                  No relationship summary yet — rebuild the summary to generate it.
                </p>
              )}
            </div>
          </div>
        )}
        footer={(
          <ModalFooter
            actions={(
              <button
                type="button"
                className="modal-footer__button"
                onClick={() => onRebuild()}
                disabled={isProcessing}
              >
                {isRebuilding ? 'Rebuilding Summary...' : isRefreshingRelationships ? 'Refreshing Relationships...' : 'Rebuild Summary'}
              </button>
            )}
          />
        )}
      />
    </Modal>
  )
}
