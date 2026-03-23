/**
 * src/components/SessionCharactersModal.tsx
 * Modal dialog for enabling and disabling campaign characters per session.
 */

import { Modal } from './Modal'
import '../styles/session-characters.css'
import type { CharacterProfile, Session } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 48

/** Props accepted by the SessionCharactersModal component. */
interface SessionCharactersModalProps {
  /** Active session whose cast is being managed. */
  activeSession: Session | null
  /** Campaign characters available for the current session. */
  characters: CharacterProfile[]
  /** Called when one character is enabled or disabled for the session. */
  onToggleCharacter: (characterId: string) => void
  /** Called when the modal should close. */
  onClose: () => void
}

/**
 * Sort characters into a stable player-first list for the modal.
 *
 * @param characters - Campaign character roster.
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
 * Build initials for characters that do not have an avatar image.
 *
 * @param characterName - Name to abbreviate.
 * @returns One or two uppercase initials.
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
 * Determine whether a character already appears in the active session.
 *
 * @param session - Session being managed.
 * @param character - Campaign character to inspect.
 * @returns True when the character has appeared in chat history.
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
 * Resolve the currently enabled character IDs for a session.
 *
 * @param session - Session being managed.
 * @param characters - Campaign character roster.
 * @returns Stable set of character IDs currently active in that session.
 */
function getEnabledCharacterIds(session: Session | null, characters: CharacterProfile[]): Set<string> {
  if (!session) {
    return new Set()
  }

  if (Array.isArray(session.activeCharacterIds)) {
    return new Set(session.activeCharacterIds.filter((characterId) => characterId.trim().length > 0))
  }

  const disabledCharacterIds = new Set((session.disabledCharacterIds ?? []).filter((characterId) => characterId.trim().length > 0))
  return new Set(
    characters
      .map((character) => character.id)
      .filter((characterId) => !disabledCharacterIds.has(characterId)),
  )
}

/**
 * SessionCharactersModal
 * Lists all campaign characters with avatar previews and per-session toggles.
 */
export function SessionCharactersModal({
  activeSession,
  characters,
  onToggleCharacter,
  onClose,
}: SessionCharactersModalProps) {
  const sortedCharacters = sortCharacters(characters)
  const enabledCharacterIds = getEnabledCharacterIds(activeSession, characters)

  return (
    <Modal title="Session Characters" onClose={onClose} className="modal--session-characters">
      {!activeSession ? (
        <p className="session-characters__empty">Select a session to manage its active cast.</p>
      ) : sortedCharacters.length === 0 ? (
        <p className="session-characters__empty">No campaign characters are available yet.</p>
      ) : (
        <div className="session-characters">
          <p className="session-characters__intro">
            Enable the campaign characters that should participate in this session.
          </p>
          <div className="session-characters__list" role="list" aria-label="Campaign characters">
            {sortedCharacters.map((character) => {
              const isEnabled = enabledCharacterIds.has(character.id)
              const hasAppeared = hasCharacterAppearedInSession(activeSession, character)
              const avatarLabel = getCharacterInitials(character.name)
              const avatarOffsetScale = MODAL_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
              const avatarStyle = character.avatarImageData
                ? {
                  backgroundImage: `url("${character.avatarImageData}")`,
                  backgroundPosition: `${character.avatarCrop.x * avatarOffsetScale}px ${character.avatarCrop.y * avatarOffsetScale}px`,
                  backgroundSize: `${character.avatarCrop.scale * 100}%`,
                }
                : undefined

              return (
                <label
                  key={character.id}
                  className={`session-characters__item${isEnabled ? '' : ' session-characters__item--disabled'}`}
                  role="listitem"
                >
                  <div
                    className={`session-characters__avatar${avatarStyle ? ' session-characters__avatar--image' : ''}`}
                    style={avatarStyle}
                    aria-hidden="true"
                  >
                    {avatarStyle ? null : avatarLabel}
                  </div>
                  <div className="session-characters__copy">
                    <div className="session-characters__name-row">
                      <span className="session-characters__name">{character.name}</span>
                      <span className={`session-characters__pill${character.controlledBy === 'user' ? ' session-characters__pill--player' : ''}`}>
                        {character.controlledBy === 'user' ? 'Player' : 'AI'}
                      </span>
                    </div>
                    <div className="session-characters__meta">
                      {isEnabled ? 'Active in this session' : 'Inactive in this session'}
                    </div>
                    {hasAppeared ? (
                      <div className="session-characters__warning">
                        Already appears in this chat. Turning them off may affect session flow.
                      </div>
                    ) : null}
                  </div>
                  <span className="session-characters__toggle">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => onToggleCharacter(character.id)}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${character.name} for this session`}
                    />
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
