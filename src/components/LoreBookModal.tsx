/**
 * src/components/LoreBookModal.tsx
 * Placeholder workspace modal for the future lore-book management surface.
 */

import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import '../styles/workspace-placeholder.css'

interface LoreBookModalProps {
  /** Called when the user closes the modal. */
  onClose: () => void
}

/**
 * LoreBookModal
 * Temporary two-column modal scaffold for lore entries, indexing, and lookup tools.
 */
export function LoreBookModal({ onClose }: LoreBookModalProps) {
  return (
    <Modal title="Lore Book" onClose={onClose} variant="workspace" className="modal--workspace-placeholder">
      <ModalWorkspaceLayout
        nav={(
          <div className="workspace-placeholder__nav" aria-label="Lore book sections">
            <button type="button" className="workspace-placeholder__nav-item workspace-placeholder__nav-item--active">
              <span className="workspace-placeholder__nav-label">Entries</span>
              <span className="workspace-placeholder__nav-description">Browse world facts, notes, and references.</span>
            </button>
            <button type="button" className="workspace-placeholder__nav-item">
              <span className="workspace-placeholder__nav-label">Categories</span>
              <span className="workspace-placeholder__nav-description">Group lore into reusable sections and filters.</span>
            </button>
          </div>
        )}
        panel={(
          <section className="workspace-placeholder__panel">
            <div className="workspace-placeholder__section-header">
              <div>
                <p className="workspace-placeholder__eyebrow">Lore Book</p>
                <h2 className="workspace-placeholder__title">Lore tools are not wired yet</h2>
              </div>
            </div>
            <p className="workspace-placeholder__copy">
              This placeholder reserves the future lore-book workspace. It will eventually hold searchable entries,
              categories, and prompt-context controls for world information.
            </p>
            <div className="workspace-placeholder__note">
              Placeholder modal only. No lore entries can be edited here yet.
            </div>
          </section>
        )}
        footer={(
          <ModalFooter
            status={<p className="workspace-placeholder__status">Placeholder modal</p>}
            actions={<button type="button" className="modal-footer__button" onClick={onClose}>Close</button>}
          />
        )}
      />
    </Modal>
  )
}
