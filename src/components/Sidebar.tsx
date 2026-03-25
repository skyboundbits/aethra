/**
 * src/components/Sidebar.tsx
 * Left panel component that renders the list of roleplay scenes.
 * Allows the user to switch between scenes and create new ones.
 */

import '../styles/sidebar.css'
import { Trash2Icon } from './icons'
import type { Scene } from '../types'

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
  /** All available scenes. */
  scenes: Scene[]
  /** ID of the currently active scene, or null if none selected. */
  activeSceneId: string | null
  /** Active scene summary text, or null when no scene is selected. */
  activeSceneSummary: string | null
  /** Called when the user clicks a scene item. */
  onSelectScene: (id: string) => void
  /** Called when the user requests deletion of a scene. */
  onDeleteScene: (id: string) => void
  /** Called when the user clicks the "New Scene" button. */
  onNewScene: () => void
  /** True while scene actions should be temporarily blocked. */
  isBusy?: boolean
}

/**
 * Sidebar
 * Renders the scene list panel with a header and scrollable list of
 * scene items, including a top-level new-scene action.
 */
export function Sidebar({
  campaignName,
  activeModelName,
  usedTokens,
  usedTokensIsExact,
  totalContextTokens,
  remainingTokens,
  remainingTokensIsExact,
  scenes,
  activeSceneId,
  onSelectScene,
  onDeleteScene,
  onNewScene,
  isBusy = false,
}: SidebarProps) {
  return (
    <aside className="panel panel--sidebar">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="sidebar__header">
        <div className="sidebar__heading">
          <span className="sidebar__eyebrow">Campaign</span>
          <span className="sidebar__title" title={campaignName}>{campaignName}</span>
        </div>
      </div>

      {/* ── Scene list ─────────────────────────────────────────────── */}
      <div className="sidebar__list" role="list">
        <button
          type="button"
          className="sidebar__new-scene-button"
          onClick={onNewScene}
          aria-label="Create new scene"
        >
          New Scene
        </button>
        {scenes.length === 0 ? (
          <p className="sidebar__empty">No scenes yet. Click New Scene to start.</p>
        ) : (
          <div className="sidebar__scene-list">
            {scenes.map((scene) => (
              <SceneItem
                key={scene.id}
                scene={scene}
                isActive={scene.id === activeSceneId}
                onClick={() => onSelectScene(scene.id)}
                onDelete={() => onDeleteScene(scene.id)}
                isBusy={isBusy}
              />
            ))}
          </div>
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

/** Props for the individual scene list item. */
interface SceneItemProps {
  scene: Scene
  isActive: boolean
  onClick: () => void
  onDelete: () => void
  isBusy: boolean
}

/**
 * SceneItem
 * Renders a single clickable entry in the scene list.
 * Displays the scene title and a human-readable relative timestamp.
 */
function SceneItem({ scene, isActive, onClick, onDelete, isBusy }: SceneItemProps) {
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
      className={`scene-item${isActive ? ' scene-item--active' : ''}`}
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="scene-item__content">
        <div className="scene-item__title">{scene.title}</div>
        <div className="scene-item__meta">
          {formatRelativeTime(scene.updatedAt)}
        </div>
      </div>
      <button
        type="button"
        className="scene-item__delete"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        aria-label={`Delete ${scene.title}`}
        title="Delete chat"
        disabled={isBusy}
      >
        <Trash2Icon aria-hidden="true" />
      </button>
    </div>
  )
}
