/**
 * src/components/Modal.tsx
 * Reusable modal dialog with a title bar and close button.
 *
 * Usage:
 *   <Modal title="My Dialog" onClose={() => setOpen(false)}>
 *     <p>Any content here.</p>
 *   </Modal>
 *
 * The modal renders into a portal attached to document.body so it
 * sits above all panel z-indices without inheriting their stacking context.
 * Pressing Escape or the close button closes it.
 */

import { useEffect, useCallback } from 'react'
import { createPortal }           from 'react-dom'
import '../styles/modal.css'

interface ModalProps {
  /** Heading text shown in the title bar. */
  title: React.ReactNode
  /** Called when the user requests the modal to close. */
  onClose: () => void
  /** Optional extra class name applied to the dialog card. */
  className?: string
  /** Shared layout variant used to size the modal shell. */
  variant?: 'workspace' | 'form' | 'popup'
  /** Content rendered inside the scrollable body area. */
  children: React.ReactNode
}

/**
 * Modal
 * Floating dialog card with a backdrop, title bar, close button, and
 * a scrollable content body.
 */
export function Modal({ title, onClose, className, variant = 'form', children }: ModalProps) {
  /** Close on Escape key. */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  /** Save focus origin and restore it when the modal unmounts. */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => {
      previouslyFocused?.focus()
    }
  }, [])

  /** Keep clicks inside the card isolated from the overlay container. */
  function handleCardClick(e: React.MouseEvent) {
    e.stopPropagation()
  }

  return createPortal(
    <div className="modal-overlay">
      <div
        className={`modal modal--${variant}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={handleCardClick}
      >

        {/* Title bar */}
        <div className="modal__titlebar">
          <span id="modal-title" className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        {/* Body */}
        <div className="modal__content">
          {children}
        </div>

      </div>
    </div>,
    document.body,
  )
}
