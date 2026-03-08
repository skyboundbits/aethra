/**
 * src/components/ChatArea.tsx
 * Centre panel component that renders the scrollable message feed.
 * Automatically scrolls to the latest message whenever the message list changes.
 */

import { useEffect, useRef } from 'react'
import '../styles/chat.css'
import type { Message } from '../types'

/** Props accepted by the ChatArea component. */
interface ChatAreaProps {
  /** Ordered list of messages to display. */
  messages: Message[]
}

/**
 * ChatArea
 * Renders the scrollable message feed within the centre panel.
 * Shows a welcome/empty state when no messages are present.
 */
export function ChatArea({ messages }: ChatAreaProps) {
  // Ref attached to the invisible sentinel div at the end of the feed,
  // used to scroll the latest message into view.
  const bottomRef = useRef<HTMLDivElement>(null)

  /** Scroll to the bottom of the feed whenever messages change. */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}

      {/* Invisible anchor for auto-scroll */}
      <div ref={bottomRef} />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Props for a single message bubble. */
interface MessageBubbleProps {
  message: Message
}

/**
 * MessageBubble
 * Renders a single chat message with appropriate alignment and styling
 * depending on the message role (user / assistant / system).
 */
function MessageBubble({ message }: MessageBubbleProps) {
  /** Format a Unix ms timestamp as HH:MM. */
  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className={`message message--${message.role}`}>
      <div className="message__bubble">{message.content}</div>
      <div className="message__time">{formatTime(message.timestamp)}</div>
    </div>
  )
}
