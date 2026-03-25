/**
 * src/components/CharacterControlTypeModal.tsx
 * Modal for selecting whether an app character will be AI Controlled or Player Controlled
 * when adding it to a campaign.
 */

import { Modal } from './Modal'
import { ModalFooter, ModalPopupLayout } from './ModalLayouts'

/** Props accepted by the CharacterControlTypeModal component. */
interface CharacterControlTypeModalProps {
  /** Character being added to the campaign. */
  character: {
    name: string
    role: string
    avatarImageData: string
    avatarCrop: { x: number; y: number; scale: number }
  }
  /** Called when the user selects a control type. */
  onSelectControlType: (controlType: 'ai' | 'user') => void
  /** Called when the user cancels the operation. */
  onCancel: () => void
}

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 80

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
 * CharacterControlTypeModal
 * Asks the user whether an app character copy will be AI Controlled or Player Controlled.
 */
export function CharacterControlTypeModal({
  character,
  onSelectControlType,
  onCancel,
}: CharacterControlTypeModalProps) {
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
    <Modal title="Add Character to Campaign" onClose={onCancel} variant="popup">
      <ModalPopupLayout
        footer={(
          <ModalFooter
            actions={(
              <>
                <button type="button" className="characters-modal__footer-btn" onClick={onCancel}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                  onClick={() => onSelectControlType('user')}
                >
                  Player Controlled
                </button>
                <button
                  type="button"
                  className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                  onClick={() => onSelectControlType('ai')}
                >
                  AI Controlled
                </button>
              </>
            )}
          />
        )}
      >
        <div className="character-control-type-modal__content">
          <div
            className={`character-control-type-modal__avatar${avatarStyle ? ' character-control-type-modal__avatar--image' : ''}`}
            style={avatarStyle}
            aria-hidden="true"
          >
            {avatarStyle ? null : avatarLabel}
          </div>
          <div className="character-control-type-modal__info">
            <h2 className="character-control-type-modal__name">{character.name}</h2>
            <p className="character-control-type-modal__role">{character.role}</p>
          </div>
          <p className="character-control-type-modal__prompt">
            Who will control {character.name} during this campaign?
          </p>
        </div>
      </ModalPopupLayout>
    </Modal>
  )
}
