/**
 * src/components/ChatArea.tsx
 * Centre panel component that renders the scrollable message feed.
 * Automatically scrolls to the latest message whenever the message list changes.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import '../styles/chat.css'
import { Trash2Icon } from './icons'
import type { ChatTextSize, Message } from '../types'

/** Props accepted by the ChatArea component. */
interface ChatAreaProps {
  /** Ordered list of messages to display. */
  messages: Message[]
  /** Persisted chat bubble text size preset. */
  textSize: ChatTextSize
  /** Called when the user requests deletion of a message. */
  onDeleteMessage: (id: string) => void
  /** True while message actions should be temporarily blocked. */
  isBusy?: boolean
}

/**
 * ChatArea
 * Renders the scrollable message feed within the centre panel.
 * Shows a welcome/empty state when no messages are present.
 */
export function ChatArea({ messages, textSize, onDeleteMessage, isBusy = false }: ChatAreaProps) {
  // Ref attached to the invisible sentinel div at the end of the feed,
  // used to scroll the latest message into view.
  const bottomRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)

  /**
   * Scroll to the bottom only when new messages are appended.
   * Deletions should not trigger a long smooth-scroll animation.
   */
  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current
    const nextMessageCount = messages.length
    const didAppendMessages = nextMessageCount > previousMessageCount

    previousMessageCountRef.current = nextMessageCount

    if (!didAppendMessages) {
      return
    }

    bottomRef.current?.scrollIntoView({
      behavior: nextMessageCount - previousMessageCount > 1 ? 'auto' : 'smooth',
    })
  }, [messages])

  return (
    <div className="chat-area">
      {messages.length === 0 ? (
        /* ── Empty / welcome state ───────────────────────────────────── */
        <div className="chat-area__empty">
          <div className="chat-area__empty-title">Aethra</div>
          <div className="chat-area__empty-sub">
            Select a session or create a new one to begin your story.
          </div>
        </div>
      ) : (
        /* ── Message list ────────────────────────────────────────────── */
        messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            textSize={textSize}
            onDelete={() => onDeleteMessage(msg.id)}
            isBusy={isBusy}
          />
        ))
      )}

      {/* Invisible anchor for auto-scroll */}
      <div ref={bottomRef} />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Props for a single message bubble. */
interface MessageBubbleProps {
  /** Message content and metadata to render. */
  message: Message
  /** Persisted chat bubble text size preset. */
  textSize: ChatTextSize
  /** Called when the user requests deletion of this message. */
  onDelete: () => void
  /** True while message actions should be temporarily blocked. */
  isBusy: boolean
}

/**
 * Build a short avatar label from a character name.
 * Uses the first letter of up to the first two name parts.
 *
 * @param characterName - Speaker name captured on the message.
 * @returns One or two uppercase initials, or null when unavailable.
 */
function getCharacterInitials(characterName?: string): string | null {
  if (!characterName) {
    return null
  }

  const parts = characterName
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Render inline message content, converting `*italic*` spans into emphasis.
 *
 * @param content - Raw message content to display.
 * @returns Renderable inline nodes for the message bubble.
 */
function renderMessageContent(content: string): ReactNode[] {
  const parts = content.split(/(\*[^*\n]+\*)/g)

  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>
      }

      return part
    })
}

/**
 * MessageBubble
 * Renders a single chat message with appropriate alignment and styling
 * depending on the message role (user / assistant / system).
 */
function MessageBubble({ message, textSize, onDelete, isBusy }: MessageBubbleProps) {
  /** Format a Unix ms timestamp as HH:MM. */
  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const avatarLabel = getCharacterInitials(message.characterName)

  return (
    <div className={`message message--${message.role} message--text-${textSize}`}>
      <div className="message__row">
        {avatarLabel ? (
          <div className="message__avatar" aria-hidden="true">
            {avatarLabel}
          </div>
        ) : null}

        <div className="message__body">
          {message.characterName ? (
            <div className="message__author">{message.characterName}</div>
          ) : null}
          <div className="message__bubble">
            <div className="message__content">{renderMessageContent(message.content)}</div>
            <div className="message__meta">
              <div className="message__time">{formatTime(message.timestamp)}</div>
              <button
                type="button"
                className="message__delete"
                onClick={onDelete}
                aria-label="Delete message"
                title="Delete message"
                disabled={isBusy}
              >
                <Trash2Icon aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
