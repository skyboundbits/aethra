/**
 * src/components/InputBar.tsx
 * Composer bar fixed to the bottom of the centre chat panel.
 * Provides an auto-resizing textarea and a send button.
 * Submits the message on Enter (Shift+Enter inserts a newline).
 */

import { useRef } from 'react'
import '../styles/chat.css'

/** Props accepted by the InputBar component. */
interface InputBarProps {
  /** Current value of the text input. */
  value: string
  /** Called whenever the textarea content changes. */
  onChange: (value: string) => void
  /** Called when the user submits a message. */
  onSend: () => void
  /** Disables the input while the AI is generating a response. */
  disabled?: boolean
}

/**
 * InputBar
 * Renders the message composer at the bottom of the chat panel.
 * Auto-resizes the textarea up to its CSS max-height, then scrolls.
 */
export function InputBar({ value, onChange, onSend, disabled = false }: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * Auto-resize the textarea to fit its content.
   * Temporarily collapse height to 'auto' so scrollHeight is recalculated
   * correctly when the user deletes text.
   */
  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  /**
   * Handle textarea change events.
   * Updates controlled value and triggers auto-resize.
   */
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
    autoResize()
  }

  /**
   * Handle keyboard shortcuts in the textarea.
   * Enter alone → submit; Shift+Enter → newline (default behaviour).
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()  // prevent bare newline
      handleSend()
    }
  }

  /**
   * Attempt to send the current message.
   * Guards against empty/whitespace-only input and disabled state.
   */
  function handleSend() {
    if (disabled || !value.trim()) return
    onSend()
    // Reset textarea height after message is cleared by the parent
    requestAnimationFrame(() => autoResize())
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="input-bar">
      <textarea
        ref={textareaRef}
        className="input-bar__textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Write your message… (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={disabled}
        aria-label="Message input"
      />
      <button
        className="input-bar__send-btn"
        onClick={handleSend}
        disabled={!canSend}
        aria-label="Send message"
        title="Send (Enter)"
      >
        ↑
      </button>
    </div>
  )
}
