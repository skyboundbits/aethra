/**
 * src/components/CharactersModal.tsx
 * Modal dialog for browsing and editing campaign characters.
 */

import { useEffect, useState } from 'react'
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
  }, [activeCharacter])

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
