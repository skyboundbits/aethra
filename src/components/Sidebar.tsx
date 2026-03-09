/**
 * src/components/Sidebar.tsx
 * Left panel component that renders the list of roleplay sessions.
 * Allows the user to switch between sessions and create new ones.
 */

import '../styles/sidebar.css'
import { Trash2Icon } from './icons'
import type { Session } from '../types'

/** Props accepted by the Sidebar component. */
interface SidebarProps {
  /** Display name of the currently loaded campaign. */
  campaignName: string
  /** Display name of the selected model, or null if unavailable. */
  activeModelName: string | null
  /** Number of tokens used by the last completed response, or an estimated prompt size. */
  usedTokens: number
  /** Whether the used token count came from the API server. */
  usedTokensIsExact: boolean
  /** Total context window tokens for the selected model, or null when unavailable. */
  totalContextTokens: number | null
  /** Remaining context tokens, or null when unavailable. */
  remainingTokens: number | null
  /** Whether the remaining token count is based on exact API usage. */
  remainingTokensIsExact: boolean
  /** All available sessions. */
  sessions: Session[]
  /** ID of the currently active session, or null if none selected. */
  activeSessionId: string | null
  /** Called when the user clicks a session item. */
  onSelectSession: (id: string) => void
  /** Called when the user requests deletion of a session. */
  onDeleteSession: (id: string) => void
  /** Called when the user clicks the "New Session" button. */
  onNewSession: () => void
  /** True while session actions should be temporarily blocked. */
  isBusy?: boolean
}

/**
 * Sidebar
 * Renders the session list panel with a header, new-session button, and
 * scrollable list of session items.
 */
export function Sidebar({
  campaignName,
  activeModelName,
  usedTokens,
  usedTokensIsExact,
  totalContextTokens,
  remainingTokens,
  remainingTokensIsExact,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  isBusy = false,
}: SidebarProps) {
  return (
    <aside className="panel panel--sidebar">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="sidebar__header">
        <div className="sidebar__heading">
          <span className="sidebar__eyebrow">Campaign</span>
          <span className="sidebar__title">{campaignName}</span>
        </div>
        <button
          className="sidebar__new-btn"
          onClick={onNewSession}
          title="New session"
          aria-label="Create new session"
        >
          +
        </button>
      </div>

      {/* ── Session list ─────────────────────────────────────────────── */}
      <div className="sidebar__list" role="list">
        {sessions.length === 0 ? (
          <p className="sidebar__empty">No sessions yet. Click + to start.</p>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => onSelectSession(session.id)}
              onDelete={() => onDeleteSession(session.id)}
              isBusy={isBusy}
            />
          ))
        )}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__footer-eyebrow">Context Budget</div>
        <div className="sidebar__footer-model">{activeModelName ?? 'No model selected'}</div>
        <div className="sidebar__footer-stats">
          <span>{usedTokensIsExact ? 'Used' : 'Used (est.)'}</span>
          <strong>{usedTokens.toLocaleString()} tokens</strong>
        </div>
        <div className="sidebar__footer-stats">
          <span>Total context</span>
          <strong>{totalContextTokens === null ? 'Unknown' : `${totalContextTokens.toLocaleString()} tokens`}</strong>
        </div>
        <div className="sidebar__footer-stats">
          <span>{remainingTokensIsExact ? 'Remaining' : 'Remaining (est.)'}</span>
          <strong>{remainingTokens === null ? 'Unknown' : `${remainingTokens.toLocaleString()} tokens`}</strong>
        </div>
      </div>
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Props for the individual session list item. */
interface SessionItemProps {
  session: Session
  isActive: boolean
  onClick: () => void
  onDelete: () => void
  isBusy: boolean
}

/**
 * SessionItem
 * Renders a single clickable entry in the session list.
 * Displays the session title and a human-readable relative timestamp.
 */
function SessionItem({ session, isActive, onClick, onDelete, isBusy }: SessionItemProps) {
  /** Format a Unix ms timestamp as a short relative string (e.g. "2h ago"). */
  function formatRelativeTime(ts: number): string {
    const diffMs = Date.now() - ts
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  return (
    <div
      role="listitem"
      className={`session-item${isActive ? ' session-item--active' : ''}`}
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="session-item__content">
        <div className="session-item__title">{session.title}</div>
        <div className="session-item__meta">
          {formatRelativeTime(session.updatedAt)}
        </div>
      </div>
      <button
        type="button"
        className="session-item__delete"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        aria-label={`Delete ${session.title}`}
        title="Delete chat"
        disabled={isBusy}
      >
        <Trash2Icon aria-hidden="true" />
      </button>
    </div>
  )
}
