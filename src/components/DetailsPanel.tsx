/**
 * src/components/DetailsPanel.tsx
 * Right panel component focused on the active session character list.
 */

import '../styles/details.css'
import type { CharacterProfile, Session } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const DETAILS_AVATAR_SIZE = 32

/** Props accepted by the DetailsPanel component. */
interface DetailsPanelProps {
  /** The currently active session, or null when none is selected. */
  activeSession: Session | null
  /** Characters currently enabled for the active session. */
  activeCharacters: CharacterProfile[]
  /** Total campaign characters available in the active campaign. */
  totalCharacterCount: number
  /** Called when the user wants to manage session characters. */
  onOpenSessionCharacters: () => void
}

/**
 * Extract the unique speaking names that appear in the active session.
 *
 * @param session - Active session, if one exists.
 * @returns Ordered unique speaker names.
 */
function getActiveSpeakerNames(session: Session | null): string[] {
  if (!session) {
    return []
  }

  const seen = new Set<string>()
  const speakerNames: string[] = []

  session.messages.forEach((message) => {
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
 * Renders the right-hand panel for active session characters only.
 */
export function DetailsPanel({
  activeSession,
  activeCharacters,
  totalCharacterCount,
  onOpenSessionCharacters,
}: DetailsPanelProps) {
  const activeSpeakerNames = getActiveSpeakerNames(activeSession)

  return (
    <aside className="panel panel--details">
      <div className="details__header">
        <div>
          <div className="details__eyebrow">Session</div>
          <div className="details__title">Characters</div>
        </div>
      </div>

      <div className="details__body">
        <div className="details__card">
          <div className="details__card-header">
            <div className="details__card-label">Active Cast</div>
            <button
              type="button"
              className="details__manage-button"
              onClick={onOpenSessionCharacters}
              disabled={!activeSession}
            >
              Manage
            </button>
          </div>
          {!activeSession ? (
            <div className="details__card-placeholder">Select a session to review its active cast.</div>
          ) : activeCharacters.length > 0 ? (
            <div className="details__stack">
              <div className="details__active-cast-list" role="list" aria-label="Active session characters">
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
                  Seen in this session: {activeSpeakerNames.join(', ')}
                </div>
              ) : (
                <div className="details__meta">No named speakers have appeared in this session yet.</div>
              )}
            </div>
          ) : (
            <div className="details__card-placeholder">No characters are active for this session.</div>
          )}
        </div>
      </div>
    </aside>
  )
}
