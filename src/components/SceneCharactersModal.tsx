/**
 * src/components/SceneCharactersModal.tsx
 * Modal dialog for enabling and disabling campaign characters per scene.
 */

import { Modal } from './Modal'
import '../styles/scene-characters.css'
import type { CharacterProfile, Scene } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 48

/** Props accepted by the SceneCharactersModal component. */
interface SceneCharactersModalProps {
  /** Active scene whose cast is being managed. */
  activeScene: Scene | null
  /** Campaign characters available for the current scene. */
  characters: CharacterProfile[]
  /** Called when one character is enabled or disabled for the scene. */
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
 * Determine whether a character already appears in the active scene.
 *
 * @param scene - Scene being managed.
 * @param character - Campaign character to inspect.
 * @returns True when the character has appeared in chat history.
 */
function hasCharacterAppearedInScene(scene: Scene | null, character: CharacterProfile): boolean {
  if (!scene) {
    return false
  }

  const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
  return scene.messages.some((message) => (
    message.characterId === character.id ||
    message.characterName?.trim().toLocaleLowerCase() === normalizedCharacterName
  ))
}

/**
 * Resolve the currently enabled character IDs for a scene.
 *
 * @param scene - Scene being managed.
 * @param characters - Campaign character roster.
 * @returns Stable set of character IDs currently active in that scene.
 */
function getEnabledCharacterIds(scene: Scene | null, characters: CharacterProfile[]): Set<string> {
  if (!scene) {
    return new Set()
  }

  if (Array.isArray(scene.activeCharacterIds)) {
    return new Set(scene.activeCharacterIds.filter((characterId) => characterId.trim().length > 0))
  }

  const disabledCharacterIds = new Set((scene.disabledCharacterIds ?? []).filter((characterId) => characterId.trim().length > 0))
  return new Set(
    characters
      .map((character) => character.id)
      .filter((characterId) => !disabledCharacterIds.has(characterId)),
  )
}

/**
 * SceneCharactersModal
 * Lists all campaign characters with avatar previews and per-scene toggles.
 */
export function SceneCharactersModal({
  activeScene,
  characters,
  onToggleCharacter,
  onClose,
}: SceneCharactersModalProps) {
  const sortedCharacters = sortCharacters(characters)
  const enabledCharacterIds = getEnabledCharacterIds(activeScene, characters)

  return (
    <Modal title="Scene Characters" onClose={onClose} className="modal--scene-characters">
      {!activeScene ? (
        <p className="scene-characters__empty">Select a scene to manage its active cast.</p>
      ) : sortedCharacters.length === 0 ? (
        <p className="scene-characters__empty">No campaign characters are available yet.</p>
      ) : (
        <div className="scene-characters">
          <p className="scene-characters__intro">
            Enable the campaign characters that should participate in this scene.
          </p>
          <div className="scene-characters__list" role="list" aria-label="Campaign characters">
            {sortedCharacters.map((character) => {
              const isEnabled = enabledCharacterIds.has(character.id)
              const hasAppeared = hasCharacterAppearedInScene(activeScene, character)
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
                  className={`scene-characters__item${isEnabled ? '' : ' scene-characters__item--disabled'}`}
                  role="listitem"
                >
                  <div
                    className={`scene-characters__avatar${avatarStyle ? ' scene-characters__avatar--image' : ''}`}
                    style={avatarStyle}
                    aria-hidden="true"
                  >
                    {avatarStyle ? null : avatarLabel}
                  </div>
                  <div className="scene-characters__copy">
                    <div className="scene-characters__name-row">
                      <span className="scene-characters__name">{character.name}</span>
                      <span className={`scene-characters__pill${character.controlledBy === 'user' ? ' scene-characters__pill--player' : ''}`}>
                        {character.controlledBy === 'user' ? 'Player' : 'AI'}
                      </span>
                    </div>
                    <div className="scene-characters__meta">
                      {isEnabled ? 'Active in this scene' : 'Inactive in this scene'}
                    </div>
                    {hasAppeared ? (
                      <div className="scene-characters__warning">
                        Already appears in this chat. Turning them off may affect scene flow.
                      </div>
                    ) : null}
                  </div>
                  <span className="scene-characters__toggle">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => onToggleCharacter(character.id)}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${character.name} for this scene`}
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
