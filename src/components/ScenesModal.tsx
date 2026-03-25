/**
 * src/components/ScenesModal.tsx
 * Placeholder workspace modal for the future scene-management surface.
 */

import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import '../styles/workspace-placeholder.css'

interface ScenesModalProps {
  /** Called when the user closes the modal. */
  onClose: () => void
}

/**
 * ScenesModal
 * Temporary two-column modal scaffold for scene tools and scene library management.
 */
export function ScenesModal({ onClose }: ScenesModalProps) {
  return (
    <Modal title="Scenes" onClose={onClose} variant="workspace" className="modal--workspace-placeholder">
      <ModalWorkspaceLayout
        nav={(
          <div className="workspace-placeholder__nav" aria-label="Scenes sections">
            <button type="button" className="workspace-placeholder__nav-item workspace-placeholder__nav-item--active">
              <span className="workspace-placeholder__nav-label">Scene Library</span>
              <span className="workspace-placeholder__nav-description">Browse and organize saved scenes.</span>
            </button>
            <button type="button" className="workspace-placeholder__nav-item">
              <span className="workspace-placeholder__nav-label">Active Scene</span>
              <span className="workspace-placeholder__nav-description">Inspect the scene currently loaded into the scene.</span>
            </button>
          </div>
        )}
        panel={(
          <section className="workspace-placeholder__panel">
            <div className="workspace-placeholder__section-header">
              <div>
                <p className="workspace-placeholder__eyebrow">Scenes</p>
                <h2 className="workspace-placeholder__title">Scene tools are not wired yet</h2>
              </div>
            </div>
            <p className="workspace-placeholder__copy">
              This placeholder reserves the future dual-column scene workspace. It will eventually handle scene creation,
              saved scene browsing, and scene scene context.
            </p>
            <div className="workspace-placeholder__note">
              Placeholder modal only. No scene data is stored from here yet.
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
