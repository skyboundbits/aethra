/**
 * src/components/AiDebugModal.tsx
 * Modal dialog for inspecting recent AI server request and response events.
 */

import { Modal } from './Modal'
import '../styles/ai-debug.css'

import type { AiDebugEntry } from '../types'

/** Props accepted by the AiDebugModal component. */
interface AiDebugModalProps {
  /** Most recent captured AI debug entries. */
  entries: AiDebugEntry[]
  /** Close handler for the modal. */
  onClose: () => void
  /** Clear handler for the debug log. */
  onClear: () => void
}

/**
 * AiDebugModal
 * Renders a live inspector for recent AI transport events.
 */
export function AiDebugModal({ entries, onClose, onClear }: AiDebugModalProps) {
  return (
    <Modal title="AI Debug Log" onClose={onClose} className="modal--ai-debug">
      <div className="ai-debug">
        <div className="ai-debug__toolbar">
          <p className="ai-debug__hint">
            Captures recent request, response, and error events exchanged with the AI server.
          </p>
          <button type="button" className="ai-debug__clear-btn" onClick={onClear}>
            Clear Log
          </button>
        </div>

        <div className="ai-debug__list" role="list">
          {entries.length === 0 ? (
            <p className="ai-debug__empty">No AI traffic captured yet.</p>
          ) : (
            [...entries].reverse().map((entry) => (
              <section key={entry.id} className={`ai-debug__entry ai-debug__entry--${entry.direction}`} role="listitem">
                <div className="ai-debug__entry-header">
                  <span className="ai-debug__entry-label">{entry.label}</span>
                  <span className="ai-debug__entry-meta">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <pre className="ai-debug__payload">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              </section>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
