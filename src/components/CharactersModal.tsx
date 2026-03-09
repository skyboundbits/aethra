/**
 * src/components/CharactersModal.tsx
 * Modal dialog for browsing and editing campaign characters.
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Modal } from './Modal'
import { UsersRoundIcon } from './icons'
import '../styles/characters.css'

import type { CharacterProfile } from '../types'

const DEFAULT_PRONOUNS_BY_GENDER: Record<CharacterProfile['gender'], CharacterProfile['pronouns']> = {
  male: 'he/him',
  female: 'she/her',
  'non-specific': 'they/them',
}

/** Props accepted by the CharactersModal component. */
interface CharactersModalProps {
  /** Characters available for the active campaign. */
  characters: CharacterProfile[]
  /** Currently selected character ID. */
  activeCharacterId: string | null
  /** Optional status text shown above the details editor. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while a create or save operation is in progress. */
  isBusy: boolean
  /** Close handler for the modal. */
  onClose: () => void
  /** Called when the user selects a character card. */
  onSelectCharacter: (characterId: string) => void
  /** Called when the user creates a new character. */
  onCreateCharacter: () => void
  /** Called when the user saves the edited character. */
  onSaveCharacter: (character: CharacterProfile) => Promise<void>
}

/**
 * CharactersModal
 * Renders a two-column character browser with a card list and detail editor.
 */
export function CharactersModal({
  characters,
  activeCharacterId,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onSelectCharacter,
  onCreateCharacter,
  onSaveCharacter,
}: CharactersModalProps) {
  const activeCharacter = characters.find((character) => character.id === activeCharacterId) ?? null
  const [draft, setDraft] = useState<CharacterProfile | null>(activeCharacter)
  const [isDraggingAvatar, setIsDraggingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const avatarDragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  /**
   * Clamp avatar zoom to a safe range for the preview and chat bubble.
   *
   * @param scale - Requested zoom level.
   * @returns Sanitized zoom value.
   */
  function clampAvatarScale(scale: number): number {
    return Math.min(3, Math.max(1, Number(scale.toFixed(2))))
  }

  /**
   * Update one field on the active character draft.
   *
   * @param field - Character field to replace.
   * @param value - New field value.
   */
  function updateDraftField<K extends keyof CharacterProfile>(field: K, value: CharacterProfile[K]): void {
    setDraft((currentDraft) => (currentDraft ? { ...currentDraft, [field]: value } : currentDraft))
  }

  /**
   * Apply a new gender and reset pronouns to the matching default.
   *
   * @param gender - Newly selected gender option.
   */
  function handleGenderChange(gender: CharacterProfile['gender']): void {
    setDraft((currentDraft) => (
      currentDraft
        ? {
          ...currentDraft,
          gender,
          pronouns: DEFAULT_PRONOUNS_BY_GENDER[gender],
        }
        : currentDraft
    ))
  }

  /**
   * Keep the editor draft in sync with the current character selection.
   */
  useEffect(() => {
    setDraft(activeCharacter)
    avatarDragStateRef.current = null
    setIsDraggingAvatar(false)
  }, [activeCharacter])

  /**
   * Stop any active avatar drag interaction when the component unmounts.
   */
  useEffect(() => () => {
    avatarDragStateRef.current = null
  }, [])

  /**
   * Load an uploaded image file into the character draft as a data URL.
   *
   * @param file - Chosen image file.
   */
  function handleAvatarFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      if (!result) {
        return
      }

      setDraft((currentDraft) => (
        currentDraft
          ? {
            ...currentDraft,
            avatarImageData: result,
            avatarCrop: { x: 0, y: 0, scale: 1 },
          }
          : currentDraft
      ))
    }
    reader.readAsDataURL(file)
  }

  /**
   * Begin dragging the avatar image within the circular crop frame.
   *
   * @param event - Pointer event originating from the crop surface.
   */
  function handleAvatarPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draft?.avatarImageData) {
      return
    }

    avatarDragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: draft.avatarCrop.x,
      originY: draft.avatarCrop.y,
    }
    setIsDraggingAvatar(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * Update the avatar crop offset as the pointer moves.
   *
   * @param event - Pointer move event from the crop surface.
   */
  function handleAvatarPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draft || !avatarDragStateRef.current) {
      return
    }

    const dragState = avatarDragStateRef.current
    updateDraftField('avatarCrop', {
      ...draft.avatarCrop,
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    })
  }

  /**
   * End the active avatar drag interaction.
   *
   * @param event - Pointer event from the crop surface.
   */
  function handleAvatarPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    avatarDragStateRef.current = null
    setIsDraggingAvatar(false)
  }

  /**
   * Remove the current avatar image and reset its crop state.
   */
  function handleAvatarRemove(): void {
    setDraft((currentDraft) => (
      currentDraft
        ? {
          ...currentDraft,
          avatarImageData: null,
          avatarCrop: { x: 0, y: 0, scale: 1 },
        }
        : currentDraft
    ))

    if (avatarInputRef.current) {
      avatarInputRef.current.value = ''
    }
  }

  /**
   * Adjust avatar zoom with the mouse wheel while hovering the crop area.
   *
   * @param event - Wheel event emitted by the crop surface.
   */
  function handleAvatarWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!draft?.avatarImageData) {
      return
    }

    event.preventDefault()

    const direction = event.deltaY < 0 ? 0.08 : -0.08
    updateDraftField('avatarCrop', {
      ...draft.avatarCrop,
      scale: clampAvatarScale(draft.avatarCrop.scale + direction),
    })
  }

  /**
   * Save the current draft and keep the modal open.
   */
  async function handleSave(): Promise<void> {
    if (!draft) {
      return
    }

    await onSaveCharacter({
      ...draft,
      name: draft.name.trim(),
      role: draft.role.trim(),
    })
  }

  const avatarPreviewStyle = draft?.avatarImageData
    ? {
      backgroundImage: `url("${draft.avatarImageData}")`,
      backgroundPosition: `${draft.avatarCrop.x}px ${draft.avatarCrop.y}px`,
      backgroundSize: `${draft.avatarCrop.scale * 100}%`,
    }
    : undefined

  return (
    <Modal
      title={(
        <>
          <UsersRoundIcon className="modal__title-icon" aria-hidden="true" />
          <span>Characters</span>
        </>
      )}
      onClose={onClose}
      className="modal--settings"
    >
      <div className="characters-modal">
        <div className="characters-modal__body">
          <aside className="characters-modal__nav" aria-label="Characters list">
            <div className="characters-modal__list">
              {characters.length === 0 ? (
                <p className="characters-modal__empty">No characters yet. Create one to start building your roster.</p>
              ) : (
                characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`characters-modal__card${activeCharacterId === character.id ? ' characters-modal__card--active' : ''}`}
                    onClick={() => onSelectCharacter(character.id)}
                  >
                    <span className="characters-modal__card-name">{character.name}</span>
                    <span className="characters-modal__card-summary">
                      {character.role || 'No role yet.'}
                    </span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              className="characters-modal__create-btn"
              onClick={onCreateCharacter}
              disabled={isBusy}
            >
              {isBusy ? 'Working...' : 'Create Character'}
            </button>
          </aside>

          <section className="characters-modal__panel">
            {statusMessage ? (
              <div className={`characters-modal__status characters-modal__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : null}

            {draft ? (
              <div className="characters-modal__editor">
                <div>
                  <h2 className="characters-modal__heading">{draft.name || 'New Character'}</h2>
                  <p className="characters-modal__subheading">
                    {draft.folderName
                      ? <>Stored in <code>characters/{draft.folderName}</code></>
                      : <>Folder will be created in <code>characters/</code> when you save.</>}
                  </p>
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-avatar-upload">
                    Avatar
                  </label>
                  <div className="characters-modal__avatar-editor">
                    <div
                      className={`characters-modal__avatar-cropper${draft.avatarImageData ? ' characters-modal__avatar-cropper--ready' : ''}${isDraggingAvatar ? ' characters-modal__avatar-cropper--dragging' : ''}`}
                      onPointerDown={handleAvatarPointerDown}
                      onPointerMove={handleAvatarPointerMove}
                      onPointerUp={handleAvatarPointerUp}
                      onPointerCancel={handleAvatarPointerUp}
                      onWheel={handleAvatarWheel}
                    >
                      <div className="characters-modal__avatar-viewport">
                        {draft.avatarImageData ? (
                          <div className="characters-modal__avatar-preview" style={avatarPreviewStyle} />
                        ) : (
                          <div className="characters-modal__avatar-empty">
                            Upload an image, then drag it to frame the chat avatar.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="characters-modal__avatar-controls">
                      <input
                        ref={avatarInputRef}
                        id="character-avatar-upload"
                        className="characters-modal__avatar-upload"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) {
                            handleAvatarFile(file)
                          }
                        }}
                      />
                      <label className="characters-modal__footer-btn" htmlFor="character-avatar-upload">
                        Upload Image
                      </label>
                      <label className="characters-modal__label" htmlFor="character-avatar-zoom">
                        Zoom
                      </label>
                      <input
                        id="character-avatar-zoom"
                        className="characters-modal__avatar-slider"
                        type="range"
                        min="1"
                        max="3"
                        step="0.01"
                        value={draft.avatarCrop.scale}
                        onChange={(event) => updateDraftField('avatarCrop', {
                          ...draft.avatarCrop,
                          scale: clampAvatarScale(Number(event.target.value)),
                        })}
                        disabled={!draft.avatarImageData}
                      />
                      <button
                        type="button"
                        className="characters-modal__footer-btn"
                        onClick={handleAvatarRemove}
                        disabled={!draft.avatarImageData}
                      >
                        Remove Image
                      </button>
                      <p className="characters-modal__avatar-help">
                        Drag inside the circle to position the face. Use the mouse wheel or zoom slider to scale it. The same crop is used in chat.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-name">
                    Name
                  </label>
                  <input
                    id="character-name"
                    className="characters-modal__input"
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraftField('name', event.target.value)}
                    placeholder="Character name"
                  />
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-role">
                    Role
                  </label>
                  <input
                    id="character-role"
                    className="characters-modal__input"
                    type="text"
                    value={draft.role}
                    onChange={(event) => updateDraftField('role', event.target.value)}
                    placeholder="Imperial officer"
                  />
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-controlled-by">
                    Controlled By
                  </label>
                  <select
                    id="character-controlled-by"
                    className="characters-modal__input"
                    value={draft.controlledBy}
                    onChange={(event) => updateDraftField('controlledBy', event.target.value as CharacterProfile['controlledBy'])}
                  >
                    <option value="ai">AI</option>
                    <option value="user">Player</option>
                  </select>
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-gender">
                    Gender
                  </label>
                  <select
                    id="character-gender"
                    className="characters-modal__input"
                    value={draft.gender}
                    onChange={(event) => handleGenderChange(event.target.value as CharacterProfile['gender'])}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-specific">Non Specific</option>
                  </select>
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-pronouns">
                    Pronouns
                  </label>
                  <select
                    id="character-pronouns"
                    className="characters-modal__input"
                    value={draft.pronouns}
                    onChange={(event) => updateDraftField('pronouns', event.target.value as CharacterProfile['pronouns'])}
                  >
                    <option value="he/him">He/Him</option>
                    <option value="she/her">She/Her</option>
                    <option value="they/them">They/Them</option>
                  </select>
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-description">
                    Description
                  </label>
                  <textarea
                    id="character-description"
                    className="characters-modal__textarea characters-modal__textarea--compact"
                    value={draft.description}
                    onChange={(event) => updateDraftField('description', event.target.value)}
                    placeholder="A stern military officer with greying hair and a scar across his cheek."
                  />
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-personality">
                    Personality
                  </label>
                  <textarea
                    id="character-personality"
                    className="characters-modal__textarea characters-modal__textarea--compact"
                    value={draft.personality}
                    onChange={(event) => updateDraftField('personality', event.target.value)}
                    placeholder="Disciplined, suspicious of outsiders, loyal to the empire."
                  />
                </div>

                <div className="characters-modal__field">
                  <label className="characters-modal__label" htmlFor="character-speaking-style">
                    Speaking Style
                  </label>
                  <textarea
                    id="character-speaking-style"
                    className="characters-modal__textarea characters-modal__textarea--compact"
                    value={draft.speakingStyle}
                    onChange={(event) => updateDraftField('speakingStyle', event.target.value)}
                    placeholder="Formal and blunt."
                  />
                </div>

                <div className="characters-modal__field characters-modal__field--grow">
                  <label className="characters-modal__label" htmlFor="character-goals">
                    Goals
                  </label>
                  <textarea
                    id="character-goals"
                    className="characters-modal__textarea"
                    value={draft.goals}
                    onChange={(event) => updateDraftField('goals', event.target.value)}
                    placeholder="Maintain order in the city and investigate smuggling."
                  />
                </div>
              </div>
            ) : (
              <div className="characters-modal__blank">
                Select a character on the left, or create a new one.
              </div>
            )}
          </section>
        </div>

        <div className="characters-modal__footer">
          <p className="characters-modal__footer-note">
            Character folders are stored inside the active campaign under <code>characters/</code>.
          </p>
          <div className="characters-modal__footer-actions">
            <button type="button" className="characters-modal__footer-btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="characters-modal__footer-btn characters-modal__footer-btn--primary"
              onClick={() => {
                void handleSave()
              }}
              disabled={!draft || isBusy}
            >
              {isBusy ? 'Saving...' : 'Save Character'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
