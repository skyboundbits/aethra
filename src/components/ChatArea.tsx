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
  /** Ordered list of messages to display. */
  messages: Message[]
  /** Characters available in the active campaign. */
  characters: CharacterProfile[]
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
export function ChatArea({ messages, characters, textSize, onDeleteMessage, isBusy = false }: ChatAreaProps) {
  // Ref attached to the invisible sentinel div at the end of the feed,
  // used to scroll the latest message into view.
  const bottomRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)
  const previousLastMessageSnapshotRef = useRef<string | null>(null)
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  )
  const charactersByName = useMemo(
    () => new Map(
      characters.map((character) => [character.name.trim().toLocaleLowerCase(), character]),
    ),
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
        messages.map((msg) => {
          const matchedCharacter =
            (msg.characterId ? charactersById.get(msg.characterId) : undefined) ??
            (msg.characterName
              ? charactersByName.get(msg.characterName.trim().toLocaleLowerCase())
              : undefined) ??
            null

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
  const avatarImageData = message.characterAvatarImageData ?? character?.avatarImageData
  const avatarCrop = message.characterAvatarCrop ?? character?.avatarCrop
  const avatarStyle = avatarImageData && avatarCrop
    ? {
      backgroundImage: `url("${avatarImageData}")`,
      backgroundPosition: `${avatarCrop.x * avatarOffsetScale}px ${avatarCrop.y * avatarOffsetScale}px`,
      backgroundSize: `${avatarCrop.scale * 100}%`,
    }
    : undefined

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
            <div className="message__content">{renderMessageContent(message.content)}</div>
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
