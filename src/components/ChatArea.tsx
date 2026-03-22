/**
 * src/components/ChatArea.tsx
 * Centre panel component that renders the scrollable message feed.
 * Automatically scrolls to the latest message whenever the message list changes.
 */

import { memo, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import '../styles/chat.css'
import { Trash2Icon } from './icons'
import type { ChatTextSize, CharacterProfile, Message } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const CHAT_AVATAR_SIZE = 128

/** Props accepted by the ChatArea component. */
interface ChatAreaProps {
  /** Stable ID of the session currently shown in the chat panel. */
  activeSessionId: string | null
  /** Ordered list of messages to display. */
  messages: Message[]
  /** Characters available in the active campaign. */
  characters: CharacterProfile[]
  /** Persisted chat bubble text size preset. */
  textSize: ChatTextSize
  /** Called when the user requests deletion of a message. */
  onDeleteMessage: (id: string) => void
  /** Called after a newly selected transcript has been positioned and can be revealed. */
  onReady?: () => void
  /** True while a different session transcript is being swapped in. */
  isLoading?: boolean
  /** True while message actions should be temporarily blocked. */
  isBusy?: boolean
}

/**
 * ChatArea
 * Renders the scrollable message feed within the centre panel.
 * Shows a welcome/empty state when no messages are present.
 */
export function ChatArea({
  activeSessionId,
  messages,
  characters,
  textSize,
  onDeleteMessage,
  onReady,
  isLoading = false,
  isBusy = false,
}: ChatAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Ref attached to the invisible sentinel div at the end of the feed,
  // used to scroll the latest message into view.
  const bottomRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)
  const previousLastMessageSnapshotRef = useRef<string | null>(null)
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  )

  /**
   * Keep the latest message in view when new messages arrive or when an
   * in-progress assistant response updates the final bubble in place.
   */
  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current
    const nextMessageCount = messages.length
    const didAppendMessages = nextMessageCount > previousMessageCount
    const lastMessage = messages.at(-1)
    const lastMessageSnapshot = lastMessage
      ? `${lastMessage.id}:${lastMessage.role}:${lastMessage.content}`
      : null
    const didUpdateLastMessage =
      lastMessageSnapshot !== null && lastMessageSnapshot !== previousLastMessageSnapshotRef.current

    previousMessageCountRef.current = nextMessageCount
    previousLastMessageSnapshotRef.current = lastMessageSnapshot

    if (!didAppendMessages && !(isBusy && didUpdateLastMessage)) {
      return
    }

    bottomRef.current?.scrollIntoView({
      behavior: didAppendMessages && nextMessageCount - previousMessageCount > 1 ? 'auto' : 'smooth',
    })
  }, [isBusy, messages])

  /**
   * Jump to the latest message when the user switches to a different session.
   */
  useEffect(() => {
    if (activeSessionId === null) {
      return
    }

    let cancelled = false
    const frameId = window.requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) {
        return
      }

      container.scrollTop = container.scrollHeight

      if (!isLoading) {
        return
      }

      window.requestAnimationFrame(() => {
        if (!cancelled) {
          onReady?.()
        }
      })
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [activeSessionId, isLoading, onReady])

  return (
    <div
      ref={containerRef}
      className={`chat-area${isLoading ? ' chat-area--loading' : ''}`}
      aria-busy={isLoading ? 'true' : undefined}
    >
      <div className={`chat-area__content${isLoading ? ' chat-area__content--hidden' : ''}`}>
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
          messages.map((msg) => {
            const matchedCharacter = msg.characterId
              ? (charactersById.get(msg.characterId) ?? null)
              : null

            return (
              <MemoizedMessageBubble
                key={msg.id}
                message={msg}
                character={matchedCharacter}
                textSize={textSize}
                messageId={msg.id}
                onDeleteMessage={onDeleteMessage}
                isBusy={isBusy}
              />
            )
          })
        )}

        {/* Invisible anchor for auto-scroll */}
        <div ref={bottomRef} />
      </div>

      {isLoading ? (
        <div className="chat-area__loading" aria-live="polite">
          <div className="chat-area__loading-label">Loading chat...</div>
          <div className="chat-area__loading-list" aria-hidden="true">
            {LOADING_ROWS.map((row, index) => (
              <LoadingRow
                key={`${row.alignment}-${index}`}
                alignment={row.alignment}
                widths={row.widths}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

type LoadingBubbleAlignment = 'assistant' | 'user'

const LOADING_ROWS: Array<{
  alignment: LoadingBubbleAlignment
  widths: string[]
}> = [
  { alignment: 'assistant', widths: ['78%', '56%', '41%'] },
  { alignment: 'user', widths: ['64%', '47%'] },
  { alignment: 'assistant', widths: ['72%', '62%', '34%'] },
  { alignment: 'assistant', widths: ['59%', '44%'] },
  { alignment: 'user', widths: ['69%', '52%', '28%'] },
]

interface LoadingRowProps {
  /** Which side of the feed to align the placeholder content on. */
  alignment: LoadingBubbleAlignment
  /** Width presets for each skeleton text line. */
  widths: string[]
}

/**
 * Render a generic message skeleton with an avatar stub and varied text lines.
 *
 * @param alignment - Which side of the transcript the row should sit on.
 * @param widths - Visual widths for each placeholder line.
 * @returns Loading row markup.
 */
function LoadingRow({ alignment, widths }: LoadingRowProps) {
  return (
    <div className={`chat-area__loading-row chat-area__loading-row--${alignment}`}>
      <div className="chat-area__loading-avatar" aria-hidden="true" />
      <div className={`chat-area__loading-bubble chat-area__loading-bubble--${alignment}`}>
        {widths.map((width, index) => (
          <div
            key={`${alignment}-${width}-${index}`}
            className="chat-area__loading-line"
            style={{ width }}
          />
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Props for a single message bubble. */
interface MessageBubbleProps {
  /** Message content and metadata to render. */
  message: Message
  /** Stable ID used when dispatching a delete request. */
  messageId: string
  /** Character profile associated with the message, if any. */
  character: CharacterProfile | null
  /** Persisted chat bubble text size preset. */
  textSize: ChatTextSize
  /** Called when the user requests deletion of this message. */
  onDeleteMessage: (id: string) => void
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
 * Remove bracketed tags from message text for on-screen display while keeping
 * the stored transcript content unchanged.
 *
 * @param content - Raw persisted message content.
 * @returns Message content with bracketed tags removed for display.
 */
function getDisplayContent(content: string): string {
  return content
    .replace(/\[[^\]\r\n]*\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim()
}

/**
 * Render inline message content, converting `*italic*` spans into emphasis.
 *
 * @param content - Raw message content to display.
 * @returns Renderable inline nodes for the message bubble.
 */
function renderMessageContent(content: string): ReactNode[] {
  const parts = getDisplayContent(content).split(/(\*[^*\n]+\*)/g)

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
 * Render the animated assistant typing indicator used while the response body
 * is still empty but the request remains in flight.
 *
 * @returns Typing-indicator markup.
 */
function renderTypingIndicator(): ReactNode {
  return (
    <span className="message__typing" aria-label="Assistant is typing">
      <span className="message__typing-dot" aria-hidden="true" />
      <span className="message__typing-dot" aria-hidden="true" />
      <span className="message__typing-dot" aria-hidden="true" />
    </span>
  )
}

/**
 * MessageBubble
 * Renders a single chat message with appropriate alignment and styling
 * depending on the message role (user / assistant / system).
 */
function MessageBubble({ message, messageId, character, textSize, onDeleteMessage, isBusy }: MessageBubbleProps) {
  /** Format a Unix ms timestamp as HH:MM. */
  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const avatarLabel = getCharacterInitials(message.characterName)
  const avatarOffsetScale = CHAT_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
  const avatarImageData = character?.avatarImageData
  const avatarCrop = character?.avatarCrop
  const avatarStyle = avatarImageData && avatarCrop
    ? {
      backgroundImage: `url("${avatarImageData}")`,
      backgroundPosition: `${avatarCrop.x * avatarOffsetScale}px ${avatarCrop.y * avatarOffsetScale}px`,
      backgroundSize: `${avatarCrop.scale * 100}%`,
    }
    : undefined
  const isTypingPlaceholder =
    message.role === 'assistant' && isBusy && message.content.trim().length === 0

  return (
    <div className={`message message--${message.role} message--text-${textSize}`}>
      <div className="message__row">
        {avatarLabel || avatarStyle ? (
          <div
            className={`message__avatar${avatarStyle ? ' message__avatar--image' : ''}`}
            style={avatarStyle}
            aria-hidden="true"
          >
            {avatarStyle ? null : avatarLabel}
          </div>
        ) : null}

        <div className="message__body">
          <div className="message__bubble">
            {message.characterName ? (
              <div className="message__header">
                <div className="message__author">{message.characterName}</div>
              </div>
            ) : null}
            <div className={`message__content${isTypingPlaceholder ? ' message__content--typing' : ''}`}>
              {isTypingPlaceholder ? renderTypingIndicator() : renderMessageContent(message.content)}
            </div>
            <div className="message__meta">
              <div className="message__time">{formatTime(message.timestamp)}</div>
              <button
                type="button"
                className="message__delete"
                onClick={() => onDeleteMessage(messageId)}
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

/**
 * Memoized chat bubble to avoid repainting older messages while only the
 * currently streamed assistant bubble changes.
 */
const MemoizedMessageBubble = memo(
  MessageBubble,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.character === nextProps.character &&
    prevProps.textSize === nextProps.textSize &&
    prevProps.isBusy === nextProps.isBusy &&
    prevProps.messageId === nextProps.messageId,
)
