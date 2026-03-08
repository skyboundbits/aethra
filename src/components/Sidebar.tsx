/**
 * src/components/Sidebar.tsx
 * Left panel component that renders the list of roleplay sessions.
 * Allows the user to switch between sessions and create new ones.
 */

import '../styles/sidebar.css'
import type { Session } from '../types'

/** Props accepted by the Sidebar component. */
interface SidebarProps {
  /** Display name of the currently loaded campaign. */
  campaignName: string
  /** All available sessions. */
  sessions: Session[]
  /** ID of the currently active session, or null if none selected. */
  activeSessionId: string | null
  /** Called when the user clicks a session item. */
  onSelectSession: (id: string) => void
  /** Called when the user clicks the "New Session" button. */
  onNewSession: () => void
}

/**
 * Sidebar
 * Renders the session list panel with a header, new-session button, and
 * scrollable list of session items.
 */
export function Sidebar({
  campaignName,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
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
            />
          ))
        )}
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
}

/**
 * SessionItem
 * Renders a single clickable entry in the session list.
 * Displays the session title and a human-readable relative timestamp.
 */
function SessionItem({ session, isActive, onClick }: SessionItemProps) {
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
      <div className="session-item__title">{session.title}</div>
      <div className="session-item__meta">
        {formatRelativeTime(session.updatedAt)}
      </div>
    </div>
  )
}
