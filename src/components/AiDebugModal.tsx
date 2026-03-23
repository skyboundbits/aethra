/**
 * src/components/AiDebugModal.tsx
 * Modal dialog for inspecting recent AI server request and response events.
 */

import { useState } from 'react'

import { Modal } from './Modal'
import { ModalFooter, ModalPopupLayout } from './ModalLayouts'
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
 * Determine whether a debug entry should be visually elevated as a failure.
 *
 * @param entry - Candidate log entry.
 * @returns True when the payload reports a context-fit failure.
 */
function isContextFitFailure(entry: AiDebugEntry): boolean {
  if (entry.direction === 'error') {
    return true
  }

  if (typeof entry.payload !== 'object' || entry.payload === null || Array.isArray(entry.payload)) {
    return false
  }

  const fit = (entry.payload as Record<string, unknown>).fitsInContext
  return fit === false
}

/**
 * Normalize escaped newline sequences in captured content for readable display.
 *
 * @param value - Raw content string extracted from a payload.
 * @returns Content with escaped newlines converted into real line breaks.
 */
function normalizeEscapedContent(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
}

/**
 * Recursively collect all string-valued `content` properties from a payload.
 *
 * @param payload - Unknown structured payload captured in the debug log.
 * @returns Ordered list of normalized content strings.
 */
function collectContentLines(payload: unknown): string[] {
  if (typeof payload === 'string') {
    return []
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((value) => collectContentLines(value))
  }

  if (typeof payload !== 'object' || payload === null) {
    return []
  }

  const record = payload as Record<string, unknown>
  const lines: string[] = []

  if (typeof record.content === 'string' && record.content.length > 0) {
    lines.push(normalizeEscapedContent(record.content))
  }

  Object.entries(record).forEach(([key, value]) => {
    if (key === 'content') {
      return
    }

    lines.push(...collectContentLines(value))
  })

  return lines
}

/**
 * AiDebugModal
 * Renders a live inspector for recent AI transport events.
 */
export function AiDebugModal({ entries, onClose, onClear }: AiDebugModalProps) {
  const [contentOnlyEntryIds, setContentOnlyEntryIds] = useState<string[]>([])

  /**
   * Toggle content-only formatting for a single debug entry.
   *
   * @param entryId - Stable debug entry identifier.
   */
  function toggleContentOnly(entryId: string): void {
    setContentOnlyEntryIds((prev) => (
      prev.includes(entryId)
        ? prev.filter((id) => id !== entryId)
        : [...prev, entryId]
    ))
  }

  return (
    <Modal title="AI Debug Log" onClose={onClose} variant="popup" className="modal--ai-debug">
      <ModalPopupLayout
        footer={(
          <ModalFooter
            status={(
              <p className="ai-debug__hint">
                Captures recent request, response, and error events exchanged with the AI server.
              </p>
            )}
            actions={(
              <>
                <button type="button" className="modal-footer__button" onClick={onClose}>
                  Close
                </button>
                <button type="button" className="modal-footer__button" onClick={onClear}>
                  Clear Log
                </button>
              </>
            )}
          />
        )}
      >
        <div className="ai-debug">
          <div className="ai-debug__list" role="list">
            {entries.length === 0 ? (
              <p className="ai-debug__empty">No AI traffic captured yet.</p>
            ) : (
              [...entries].reverse().map((entry) => {
                const contentLines = collectContentLines(entry.payload)
                const hasContent = contentLines.length > 0
                const isContentOnly = hasContent && contentOnlyEntryIds.includes(entry.id)

                return (
                  <section
                    key={entry.id}
                    className={[
                      'ai-debug__entry',
                      `ai-debug__entry--${entry.direction}`,
                      isContextFitFailure(entry) ? 'ai-debug__entry--fit-failure' : '',
                    ].filter(Boolean).join(' ')}
                    role="listitem"
                  >
                    <div className="ai-debug__entry-header">
                      <div className="ai-debug__entry-title">
                        <span className="ai-debug__entry-label">{entry.label}</span>
                        <span className="ai-debug__entry-meta">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {hasContent ? (
                        <button
                          type="button"
                          className={`ai-debug__entry-toggle${isContentOnly ? ' ai-debug__entry-toggle--active' : ''}`}
                          onClick={() => {
                            toggleContentOnly(entry.id)
                          }}
                        >
                          {isContentOnly ? 'Show JSON' : 'Show Content'}
                        </button>
                      ) : null}
                    </div>
                    {isContentOnly ? (
                      <div className="ai-debug__content-only">
                        {contentLines.map((line, index) => (
                          <p key={`${entry.id}-content-${index}`} className="ai-debug__content-line">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <pre className="ai-debug__payload">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    )}
                  </section>
                )
              })
            )}
          </div>
        </div>
      </ModalPopupLayout>
    </Modal>
  )
}
