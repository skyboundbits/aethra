/**
 * src/components/DetailsPanel.tsx
 * Right panel component focused on the active scene character list.
 */

import '../styles/details.css'
import type { CharacterProfile, Scene } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const DETAILS_AVATAR_SIZE = 32

/** Props accepted by the DetailsPanel component. */
interface DetailsPanelProps {
  /** The currently active scene, or null when none is selected. */
  activeSession: Scene | null
  /** Active scene summary text, or null when no scene is selected. */
  activeSessionSummary: string | null
  /** Characters currently enabled for the active scene. */
  activeCharacters: CharacterProfile[]
  /** Total campaign characters available in the active campaign. */
  totalCharacterCount: number
  /** Called when the user wants to inspect the current summary. */
  onOpenSummary: () => void
  /** Called when the user wants to manage scene characters. */
  onOpenSessionCharacters: () => void
  /** Called when user triggers a relationship refresh. */
  onRefreshRelationships: () => void
  /** True while a refresh LLM call is in progress. */
  isRefreshingRelationships: boolean
  /** Inline error message to show below the button; null when none. */
  refreshRelationshipsError: string | null
}

/**
 * Extract the unique speaking names that appear in the active scene.
 *
 * @param scene - Active scene, if one exists.
 * @returns Ordered unique speaker names.
 */
function getActiveSpeakerNames(scene: Scene | null): string[] {
  if (!scene) {
    return []
  }

  const seen = new Set<string>()
  const speakerNames: string[] = []

  scene.messages.forEach((message) => {
    const speakerName = message.characterName?.trim()
    if (!speakerName || seen.has(speakerName)) {
      return
    }

    seen.add(speakerName)
    speakerNames.push(speakerName)
  })

  return speakerNames
}

/**
 * Build a short avatar label from a character name.
 *
 * @param characterName - Character name to abbreviate.
 * @returns One or two uppercase initials, or null when unavailable.
 */
function getCharacterInitials(characterName: string): string | null {
  const parts = characterName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return null
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * DetailsPanel
 * Renders the right-hand panel for active scene characters only.
 */
export function DetailsPanel({
  activeSession,
  activeSessionSummary,
  activeCharacters,
  totalCharacterCount,
  onOpenSummary,
  onOpenSessionCharacters,
  onRefreshRelationships,
  isRefreshingRelationships,
  refreshRelationshipsError,
}: DetailsPanelProps) {
  const activeSpeakerNames = getActiveSpeakerNames(activeSession)

  return (
    <aside className="panel panel--details">
      <div className="details__header">
        <div className="details__heading">
          <div className="details__eyebrow">Scene</div>
          <div
            className="details__title"
            title={activeSession?.title ?? 'No scene loaded'}
          >
            {activeSession?.title ?? 'No scene loaded'}
          </div>
        </div>
      </div>

      <div className="details__body">
        <button
          type="button"
          className="details__action-button details__action-button--full-width details__summary-button"
          onClick={onOpenSummary}
          disabled={!activeSession}
        >
          {activeSessionSummary?.trim() ? 'View Current Summary' : 'View Summary'}
        </button>
        <div className="details__card">
          <div className="details__card-header">
            <div className="details__card-label">Active Cast</div>
            <button
              type="button"
              className="details__action-button"
              onClick={onOpenSessionCharacters}
              disabled={!activeSession}
            >
              Manage
            </button>
          </div>
          {!activeSession ? (
            <div className="details__card-placeholder">Select a scene to review its active cast.</div>
          ) : activeCharacters.length > 0 ? (
            <div className="details__stack">
              <div className="details__active-cast-list" role="list" aria-label="Active scene characters">
                {activeCharacters.map((character) => {
                  const avatarLabel = getCharacterInitials(character.name)
                  const avatarOffsetScale = DETAILS_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                  const avatarStyle = character.avatarImageData
                    ? {
                      backgroundImage: `url("${character.avatarImageData}")`,
                      backgroundPosition: `${character.avatarCrop.x * avatarOffsetScale}px ${character.avatarCrop.y * avatarOffsetScale}px`,
                      backgroundSize: `${character.avatarCrop.scale * 100}%`,
                    }
                    : undefined

                  return (
                    <div key={character.id} className="details__active-cast-item" role="listitem">
                      <div
                        className={`details__active-cast-avatar${avatarStyle ? ' details__active-cast-avatar--image' : ''}`}
                        style={avatarStyle}
                        aria-hidden="true"
                      >
                        {avatarStyle ? null : avatarLabel}
                      </div>
                      <span className="details__active-cast-name">{character.name}</span>
                    </div>
                  )
                })}
              </div>
              <div className="details__meta">
                {activeCharacters.length} active of {totalCharacterCount} campaign characters
              </div>
              {activeSpeakerNames.length > 0 ? (
                <div className="details__meta">
                  Seen in this scene: {activeSpeakerNames.join(', ')}
                </div>
              ) : (
                <div className="details__meta">No named speakers have appeared in this scene yet.</div>
              )}
              {activeCharacters.length >= 2 && (
                <div className="details__relationships">
                  <button
                    className="details__action-button details__action-button--full-width"
                    onClick={onRefreshRelationships}
                    disabled={isRefreshingRelationships}
                    type="button"
                  >
                    {isRefreshingRelationships ? 'Refreshing…' : 'Refresh Relationships'}
                  </button>
                  {refreshRelationshipsError && (
                    <p className="details__refresh-error">{refreshRelationshipsError}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="details__card-placeholder">No characters are active for this scene.</div>
          )}
        </div>
      </div>
    </aside>
  )
}
