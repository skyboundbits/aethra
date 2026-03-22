/**
 * src/components/DetailsPanel.tsx
 * Right panel component for campaign and session context.
 * Surfaces a compact campaign overview, chat stats, character roster,
 * rolling summary state, and active runtime information.
 */

import '../styles/details.css'
import type { Campaign, CharacterProfile, Session } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const DETAILS_AVATAR_SIZE = 52

/** Props accepted by the DetailsPanel component. */
interface DetailsPanelProps {
  /** The currently loaded campaign, or null when none is open. */
  campaign: Campaign | null
  /** The currently active session, or null when none is selected. */
  activeSession: Session | null
  /** Characters available in the active campaign. */
  characters: CharacterProfile[]
  /** Called when one campaign character is enabled or disabled for this session. */
  onToggleSessionCharacter: (characterId: string) => void
  /** Display name of the active AI server, or null if unavailable. */
  activeServerName: string | null
  /** Display name of the active AI model, or null if unavailable. */
  activeModelName: string | null
}

/**
 * Format a Unix timestamp into a readable local date and time.
 *
 * @param timestamp - Unix timestamp in milliseconds.
 * @returns Human-readable date/time string.
 */
function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Build a stable roster ordering for the right rail.
 * Player-controlled characters are shown before AI-controlled ones.
 *
 * @param characters - Campaign roster.
 * @returns Sorted character list.
 */
function sortCharacters(characters: CharacterProfile[]): CharacterProfile[] {
  return [...characters].sort((first, second) => {
    if (first.controlledBy !== second.controlledBy) {
      return first.controlledBy === 'user' ? -1 : 1
    }

    return first.name.localeCompare(second.name)
  })
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
 * Determine whether a character has already appeared in the active session.
 *
 * @param session - Active session, if any.
 * @param character - Campaign character to inspect.
 * @returns True when the character appears in the transcript.
 */
function hasCharacterAppearedInSession(session: Session | null, character: CharacterProfile): boolean {
  if (!session) {
    return false
  }

  const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
  return session.messages.some((message) => (
    message.characterId === character.id ||
    message.characterName?.trim().toLocaleLowerCase() === normalizedCharacterName
  ))
}

/**
 * DetailsPanel
 * Renders the right-hand panel that will surface contextual information
 * about the active roleplay session and campaign.
 */
export function DetailsPanel({
  campaign,
  activeSession,
  characters,
  onToggleSessionCharacter,
  activeServerName,
  activeModelName,
}: DetailsPanelProps) {
  const sortedCharacters = sortCharacters(characters)
  const playerCharacters = sortedCharacters.filter((character) => character.controlledBy === 'user')
  const aiCharacters = sortedCharacters.filter((character) => character.controlledBy === 'ai')
  const disabledCharacterIds = new Set(activeSession?.disabledCharacterIds ?? [])
  const activeSpeakerNames = getActiveSpeakerNames(activeSession)
  const sessionMessageCount = activeSession?.messages.length ?? 0
  const userMessageCount = activeSession?.messages.filter((message) => message.role === 'user').length ?? 0
  const assistantMessageCount = activeSession?.messages.filter((message) => message.role === 'assistant').length ?? 0
  const rollingSummary = activeSession?.rollingSummary.trim() ?? ''
  const summaryExcerpt = rollingSummary.length > 0
    ? rollingSummary.slice(0, 280) + (rollingSummary.length > 280 ? '...' : '')
    : null

  return (
    <aside className="panel panel--details">
      <div className="details__header">
        <div>
          <div className="details__eyebrow">Workspace</div>
          <div className="details__title">{campaign?.name ?? 'Details'}</div>
        </div>
        {activeSession ? (
          <div className="details__header-badge">Live Session</div>
        ) : null}
      </div>

      <div className="details__body">
        <div className="details__card">
          <div className="details__card-label">Campaign</div>
          <div className="details__stack">
            <div className="details__headline">{campaign?.name ?? 'No campaign loaded'}</div>
            <div className="details__meta">
              {campaign
                ? `${campaign.sessions.length} ${campaign.sessions.length === 1 ? 'session' : 'sessions'}`
                : 'Open or create a campaign to begin.'}
            </div>
            <div className="details__card-copy">
              {campaign?.description || 'No campaign description yet.'}
            </div>
          </div>
        </div>

        <div className="details__card">
          <div className="details__card-label">Session</div>
          {activeSession ? (
            <div className="details__stack">
              <div className="details__headline">{activeSession.title}</div>
              <div className="details__stats">
                <div className="details__stat">
                  <span className="details__stat-label">Messages</span>
                  <strong>{sessionMessageCount}</strong>
                </div>
                <div className="details__stat">
                  <span className="details__stat-label">Player Turns</span>
                  <strong>{userMessageCount}</strong>
                </div>
                <div className="details__stat">
                  <span className="details__stat-label">AI Turns</span>
                  <strong>{assistantMessageCount}</strong>
                </div>
              </div>
              <div className="details__meta-list">
                <div>Created {formatDateTime(activeSession.createdAt)}</div>
                <div>Updated {formatDateTime(activeSession.updatedAt)}</div>
              </div>
            </div>
          ) : (
            <div className="details__card-placeholder">Select a session to inspect its state.</div>
          )}
        </div>

        <div className="details__card">
          <div className="details__card-label">Active Cast</div>
          {!activeSession ? (
            <div className="details__card-placeholder">Select a session to manage its cast.</div>
          ) : sortedCharacters.length > 0 ? (
            <div className="details__stack">
              <div className="details__cast-list" role="list" aria-label="Session characters">
                {sortedCharacters.map((character) => {
                  const avatarLabel = getCharacterInitials(character.name)
                  const avatarOffsetScale = DETAILS_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                  const avatarStyle = character.avatarImageData
                    ? {
                      backgroundImage: `url("${character.avatarImageData}")`,
                      backgroundPosition: `${character.avatarCrop.x * avatarOffsetScale}px ${character.avatarCrop.y * avatarOffsetScale}px`,
                      backgroundSize: `${character.avatarCrop.scale * 100}%`,
                    }
                    : undefined
                  const isEnabled = !disabledCharacterIds.has(character.id)
                  const hasAppeared = hasCharacterAppearedInSession(activeSession, character)

                  return (
                    <label
                      key={character.id}
                      className={`details__cast-item${isEnabled ? '' : ' details__cast-item--disabled'}`}
                      role="listitem"
                    >
                      <div
                        className={`details__cast-avatar${avatarStyle ? ' details__cast-avatar--image' : ''}`}
                        style={avatarStyle}
                        aria-hidden="true"
                      >
                        {avatarStyle ? null : avatarLabel}
                      </div>
                      <div className="details__cast-copy">
                        <div className="details__cast-name-row">
                          <span className="details__headline">{character.name}</span>
                          <span className={`details__pill${character.controlledBy === 'user' ? ' details__pill--player' : ''}`}>
                            {character.controlledBy === 'user' ? 'Player' : 'AI'}
                          </span>
                        </div>
                        <div className="details__meta">
                          {isEnabled ? 'Enabled for this session' : 'Disabled for this session'}
                        </div>
                        {hasAppeared ? (
                          <div className="details__warning">
                            Already appears in this chat. Disabling may affect session flow.
                          </div>
                        ) : null}
                      </div>
                      <span className="details__toggle">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => onToggleSessionCharacter(character.id)}
                          aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${character.name} for this session`}
                        />
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="details__meta-list">
                <div>{playerCharacters.length} player-controlled</div>
                <div>{aiCharacters.length} AI-controlled</div>
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
            <div className="details__card-placeholder">No campaign characters yet.</div>
          )}
        </div>

        <div className="details__card">
          <div className="details__card-label">Continuity</div>
          {summaryExcerpt ? (
            <div className="details__stack">
              <div className="details__meta">
                Rolling summary covers {activeSession?.summarizedMessageCount ?? 0} archived messages.
              </div>
              <div className="details__card-copy">{summaryExcerpt}</div>
            </div>
          ) : (
            <div className="details__card-placeholder">
              {activeSession
                ? 'No rolling summary has been generated for this session yet.'
                : 'Open a session to inspect continuity state.'}
            </div>
          )}
        </div>

        <div className="details__card">
          <div className="details__card-label">Runtime</div>
          <div className="details__meta-list">
            <div>
              <span className="details__stat-label">Model</span>
              <strong>{activeModelName ?? 'Not configured'}</strong>
            </div>
            <div>
              <span className="details__stat-label">Server</span>
              <strong>{activeServerName ?? 'Not configured'}</strong>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
