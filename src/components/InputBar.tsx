/**
 * src/components/InputBar.tsx
 * Composer bar fixed to the bottom of the centre chat panel.
 * Provides an auto-resizing textarea and a send button.
 * Submits the message on Enter (Shift+Enter inserts a newline).
 */

import { useEffect, useRef } from 'react'
import '../styles/chat.css'
import type { CharacterProfile } from '../types'

/** Props accepted by the InputBar component. */
interface InputBarProps {
  /** Current value of the text input. */
  value: string
  /** Characters available to write as in the active campaign. */
  characters: CharacterProfile[]
  /** Currently selected composer character ID, or null for no character. */
  selectedCharacterId: string | null
  /** Called whenever the textarea content changes. */
  onChange: (value: string) => void
  /** Called when the selected composer character changes. */
  onSelectCharacter: (characterId: string | null) => void
  /** Called when the user submits a message. */
  onSend: () => void
  /** Changes when the parent wants to restore focus to the composer. */
  focusRequestKey?: number
  /** Disables the input while the AI is generating a response. */
  disabled?: boolean
}

/**
 * InputBar
 * Renders the message composer at the bottom of the chat panel.
 * Auto-resizes the textarea up to its CSS max-height, then scrolls.
 */
export function InputBar({
  value,
  characters,
  selectedCharacterId,
  onChange,
  onSelectCharacter,
  onSend,
  focusRequestKey = 0,
  disabled = false,
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const playerCharacters = characters.filter((character) => character.controlledBy === 'user')

  /**
   * Keep keyboard focus in the composer when it is interactive.
   */
  function focusTextarea(): void {
    textareaRef.current?.focus()
  }

  /**
   * Restore focus after the composer becomes interactive again.
   */
  useEffect(() => {
    if (!disabled) {
      focusTextarea()
    }
  }, [disabled])

  /**
   * Restore focus when parent actions like message deletion dismiss a modal prompt.
   */
  useEffect(() => {
    if (!disabled) {
      requestAnimationFrame(() => {
        focusTextarea()
      })
    }
  }, [disabled, focusRequestKey])

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
    // Reset layout and retain keyboard focus after the parent clears the value.
    requestAnimationFrame(() => {
      autoResize()
      focusTextarea()
    })
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="input-bar">
      <div className="input-bar__character-picker">
        <select
          className="input-bar__character-select app-select"
          value={selectedCharacterId ?? ''}
          onChange={(event) => onSelectCharacter(event.target.value || null)}
          disabled={disabled}
          aria-label="Select character speaker"
        >
          {playerCharacters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        ref={textareaRef}
        className="input-bar__textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Write your message... (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={disabled}
        autoFocus
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
