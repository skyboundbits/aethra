/**
 * src/components/NewSceneModal.tsx
 * Modal dialog for scene setup and campaign character selection.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import { MountainSnowIcon, ChessKnightIcon, UsersIcon, CheckIcon } from './icons'
import '../styles/new-scene.css'
import type { CharacterProfile, Scene } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 48

/** Props accepted by the NewSceneModal component. */
interface NewSceneModalProps {
  /** Campaign-scoped characters already available. */
  campaignCharacters: CharacterProfile[]
  /** Existing scenes available as continuity sources. */
  scenes: Scene[]
  /** Status message shown beneath the picker. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while starting the scene and importing characters. */
  isBusy: boolean
  /** Close the modal without creating a scene. */
  onClose: () => void
  /** Start the scene with the selected campaign characters. */
  onStartScene: (
    campaignCharacterIds: string[],
    title: string,
    sceneSetup: string,
    continuitySourceSceneId: string | null,
    openingNotes: string,
  ) => Promise<void>
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
 * Render helper for shared avatar framing.
 *
 * @param avatarImageData - Optional character avatar image.
 * @param avatarCrop - Manual crop framing data.
 * @returns CSS style object when an image exists.
 */
function getAvatarStyle(
  avatarImageData: string | null,
  avatarCrop: CharacterProfile['avatarCrop'],
): React.CSSProperties | undefined {
  if (!avatarImageData) {
    return undefined
  }

  const avatarOffsetScale = MODAL_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
  return {
    backgroundImage: `url("${avatarImageData}")`,
    backgroundPosition: `${avatarCrop.x * avatarOffsetScale}px ${avatarCrop.y * avatarOffsetScale}px`,
    backgroundSize: `${avatarCrop.scale * 100}%`,
  }
}

/**
 * Split characters into player and AI groups for a two-column picker layout.
 *
 * @param characters - Character list to partition.
 * @returns Grouped player and AI lists.
 */
function groupCharactersByController(characters: CharacterProfile[]): {
  player: CharacterProfile[]
  ai: CharacterProfile[]
} {
  return {
    player: characters.filter((character) => character.controlledBy === 'user'),
    ai: characters.filter((character) => character.controlledBy === 'ai'),
  }
}

/**
 * NewSceneModal
 * Two-tab modal for setting up a new scene with campaign characters.
 */
export function NewSceneModal({
  campaignCharacters,
  scenes,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onStartScene,
}: NewSceneModalProps) {
  const sortedCampaignCharacters = useMemo(
    () => [...campaignCharacters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [campaignCharacters],
  )
  const groupedCampaignCharacters = useMemo(
    () => groupCharactersByController(sortedCampaignCharacters),
    [sortedCampaignCharacters],
  )

  const [activeTab, setActiveTab] = useState<'setup' | 'characters'>('setup')
  const [selectedCampaignCharacterIds, setSelectedCampaignCharacterIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [sceneSetup, setSceneSetup] = useState('')
  const [openingNotes, setOpeningNotes] = useState('')
  const [continuitySourceSceneId, setContinuitySourceSceneId] = useState<string>('')

  useEffect(() => {
    setSelectedCampaignCharacterIds([])
    setTitle(`Scene ${scenes.length + 1}`)
    setSceneSetup('')
    setOpeningNotes('')
    setContinuitySourceSceneId('')
  }, [scenes.length])

  const hasSelectedPlayerCharacter = useMemo(() => {
    return sortedCampaignCharacters.some((character) =>
      selectedCampaignCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )
  }, [selectedCampaignCharacterIds, sortedCampaignCharacters])

  const hasSelectedAICharacter = useMemo(() => {
    return sortedCampaignCharacters.some((character) =>
      selectedCampaignCharacterIds.includes(character.id) && character.controlledBy === 'ai',
    )
  }, [selectedCampaignCharacterIds, sortedCampaignCharacters])

  const isSetupTabValid = useMemo(
    () => title.trim().length > 0 && sceneSetup.trim().length > 0,
    [title, sceneSetup],
  )

  const isCharactersTabValid = useMemo(
    () => hasSelectedPlayerCharacter && hasSelectedAICharacter,
    [hasSelectedPlayerCharacter, hasSelectedAICharacter],
  )

  useEffect(() => {
    setSelectedCampaignCharacterIds((currentIds) =>
      currentIds.filter((characterId) => sortedCampaignCharacters.some((character) => character.id === characterId)),
    )
  }, [sortedCampaignCharacters])

  const availableContinuityScenes = useMemo(
    () => scenes.filter((scene) => scene.rollingSummary.trim().length > 0),
    [scenes],
  )
  const selectedContinuityScene = useMemo(
    () => availableContinuityScenes.find((scene) => scene.id === continuitySourceSceneId) ?? null,
    [availableContinuityScenes, continuitySourceSceneId],
  )

  function toggleCampaignCharacter(characterId: string): void {
    setSelectedCampaignCharacterIds((currentIds) => (
      currentIds.includes(characterId)
        ? currentIds.filter((id) => id !== characterId)
        : [...currentIds, characterId]
    ))
  }

  async function handleStartScene(): Promise<void> {
    await onStartScene(
      selectedCampaignCharacterIds,
      title.trim(),
      sceneSetup.trim(),
      continuitySourceSceneId.trim() || null,
      openingNotes.trim(),
    )
  }

  function renderCharacterList(
    characters: CharacterProfile[],
    selectedIds: string[],
    onToggle: (characterId: string) => void,
    ariaLabelPrefix: string,
  ): React.ReactNode {
    if (characters.length === 0) {
      return <p className="new-scene__empty">No characters in this group.</p>
    }

    return (
      <div className="new-scene__list" role="list" aria-label={ariaLabelPrefix}>
        {characters.map((character) => {
          const isSelected = selectedIds.includes(character.id)
          const avatarStyle = getAvatarStyle(character.avatarImageData, character.avatarCrop)

          return (
            <button
              key={character.id}
              type="button"
              className={`new-scene__item${isSelected ? ' new-scene__item--selected' : ''}`}
              onClick={() => onToggle(character.id)}
              aria-label={`${isSelected ? 'Deselect' : 'Select'} ${character.name}`}
              role="listitem"
            >
              <input
                className="new-scene__checkbox"
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div
                className={`new-scene__avatar${avatarStyle ? ' new-scene__avatar--image' : ''}`}
                style={avatarStyle}
                aria-hidden="true"
              >
                {avatarStyle ? null : getCharacterInitials(character.name)}
              </div>
              <div className="new-scene__copy">
                <div className="new-scene__name-row">
                  <span className="new-scene__name">{character.name}</span>
                  <span className={`new-scene__pill${character.controlledBy === 'user' ? ' new-scene__pill--player' : ''}`}>
                    {character.controlledBy === 'user' ? 'Player' : 'AI'}
                  </span>
                </div>
                <div className="new-scene__meta">{character.role || 'No role yet.'}</div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Modal
      title={
        <div className="new-scene__title">
          <MountainSnowIcon className="new-scene__title-icon" aria-hidden="true" />
          <span>New Scene</span>
        </div>
      }
      onClose={onClose}
      className="modal--new-scene"
    >
      <ModalWorkspaceLayout
        nav={(
          <nav className="new-scene__nav" aria-label="New scene tabs">
            <button
              className={`new-scene__tab${activeTab === 'setup' ? ' new-scene__tab--active' : ''}`}
              onClick={() => setActiveTab('setup')}
              disabled={isBusy}
            >
              <ChessKnightIcon className="new-scene__tab-icon" aria-hidden="true" />
              Scene Setup
              {isSetupTabValid && (
                <CheckIcon className="new-scene__tab-check" aria-hidden="true" />
              )}
            </button>
            <button
              className={`new-scene__tab${activeTab === 'characters' ? ' new-scene__tab--active' : ''}`}
              onClick={() => setActiveTab('characters')}
              disabled={isBusy}
            >
              <UsersIcon className="new-scene__tab-icon" aria-hidden="true" />
              <span>Characters</span>
              {isCharactersTabValid && (
                <CheckIcon className="new-scene__tab-check" aria-hidden="true" />
              )}
              {selectedCampaignCharacterIds.length > 0 && !isCharactersTabValid && (
                <span className="new-scene__tab-badge">{selectedCampaignCharacterIds.length}</span>
              )}
            </button>
          </nav>
        )}
        panel={(
          <div className="new-scene__panel">
            {activeTab === 'setup' && (
              <section className="new-scene__section">
                <h2 id="new-scene-setup" className="new-scene__panel-header">Scene Setup</h2>
                <label className="new-scene__field">
                  <span className="new-scene__field-label">Scene Name</span>
                  <input
                    className="new-scene__input"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Arrival at Blackglass Harbor"
                    maxLength={120}
                    disabled={isBusy}
                  />
                </label>

                <label className="new-scene__field">
                  <span className="new-scene__field-label">Scene Setup</span>
                  <textarea
                    className="new-scene__textarea"
                    value={sceneSetup}
                    onChange={(event) => setSceneSetup(event.target.value)}
                    placeholder="Describe where the scene opens, who is present, the current pressure, and what has just happened."
                    rows={5}
                    disabled={isBusy}
                  />
                </label>

                <label className="new-scene__field">
                  <span className="new-scene__field-label">Continue From Previous Scene</span>
                  <select
                    className="new-scene__select"
                    value={continuitySourceSceneId}
                    onChange={(event) => setContinuitySourceSceneId(event.target.value)}
                    disabled={isBusy || availableContinuityScenes.length === 0}
                  >
                    <option value="">No previous-scene continuity</option>
                    {availableContinuityScenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.title}
                      </option>
                    ))}
                  </select>
                  <span className="new-scene__field-hint">
                    {availableContinuityScenes.length > 0
                      ? 'Copies a frozen continuity snapshot from the selected scene summary.'
                      : 'No previous scenes have a rolling summary yet.'}
                  </span>
                </label>

                {selectedContinuityScene ? (
                  <div className="new-scene__summary-preview">
                    <div className="new-scene__field-label">Imported Continuity Preview</div>
                    <p className="new-scene__summary-preview-text">{selectedContinuityScene.rollingSummary}</p>
                  </div>
                ) : null}

                <label className="new-scene__field">
                  <span className="new-scene__field-label">Opening Notes</span>
                  <textarea
                    className="new-scene__textarea"
                    value={openingNotes}
                    onChange={(event) => setOpeningNotes(event.target.value)}
                    placeholder="Optional: player goals, tone, pacing, boundaries, or details the model should keep in mind."
                    rows={3}
                    disabled={isBusy}
                  />
                </label>

                {statusMessage ? (
                  <div className={`new-scene__status new-scene__status--${statusKind ?? 'success'}`}>
                    {statusMessage}
                  </div>
                ) : null}
              </section>
            )}

            {activeTab === 'characters' && (
              <section className="new-scene__section">
                <h2 className="new-scene__panel-header">Select Characters</h2>
                <p className="new-scene__requirement">
                  At least one player-controlled and one AI-controlled character required.
                </p>

                {sortedCampaignCharacters.length === 0 ? (
                  <p className="new-scene__empty">No campaign characters yet.</p>
                ) : (
                  <div className="new-scene__columns">
                    <section className="new-scene__column" aria-labelledby="new-scene-campaign-player">
                      <h3 id="new-scene-campaign-player" className="new-scene__subheading">Player</h3>
                      {renderCharacterList(
                        groupedCampaignCharacters.player,
                        selectedCampaignCharacterIds,
                        toggleCampaignCharacter,
                        'Campaign player characters',
                      )}
                    </section>
                    <section className="new-scene__column" aria-labelledby="new-scene-campaign-ai">
                      <h3 id="new-scene-campaign-ai" className="new-scene__subheading">AI</h3>
                      {renderCharacterList(
                        groupedCampaignCharacters.ai,
                        selectedCampaignCharacterIds,
                        toggleCampaignCharacter,
                        'Campaign AI characters',
                      )}
                    </section>
                  </div>
                )}

                {statusMessage ? (
                  <div className={`new-scene__status new-scene__status--${statusKind ?? 'success'}`}>
                    {statusMessage}
                  </div>
                ) : null}
              </section>
            )}
          </div>
        )}
        footer={(
          <ModalFooter
            actions={(
              <>
                <button type="button" className="characters-modal__footer-btn" onClick={onClose} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                  onClick={() => {
                    void handleStartScene()
                  }}
                  disabled={isBusy || !hasSelectedPlayerCharacter || !hasSelectedAICharacter || title.trim().length === 0 || sceneSetup.trim().length === 0}
                >
                  {isBusy ? 'Starting...' : 'Start Scene'}
                </button>
              </>
            )}
          />
        )}
      />
    </Modal>
  )
}
