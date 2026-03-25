/**
 * src/components/NewSceneModal.tsx
 * Modal dialog for choosing which campaign and global characters join a new scene.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalFormLayout } from './ModalLayouts'
import '../styles/new-scene.css'
import type { CharacterProfile, ReusableCharacter, Scene } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 48

/** Props accepted by the NewSceneModal component. */
interface NewSceneModalProps {
  /** Campaign-scoped characters already available. */
  campaignCharacters: CharacterProfile[]
  /** Existing scenes available as continuity sources. */
  scenes: Scene[]
  /** Reusable global characters available for import. */
  reusableCharacters: ReusableCharacter[]
  /** Status message shown beneath the picker. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while starting the scene and importing characters. */
  isBusy: boolean
  /** Close the modal without creating a scene. */
  onClose: () => void
  /** Start the scene with the selected campaign and global characters. */
  onStartScene: (
    campaignCharacterIds: string[],
    reusableCharacterIds: string[],
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
  avatarCrop: CharacterProfile['avatarCrop'] | ReusableCharacter['avatarCrop'],
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
function groupCharactersByController<T extends CharacterProfile | ReusableCharacter>(characters: T[]): {
  player: T[]
  ai: T[]
} {
  return {
    player: characters.filter((character) => character.controlledBy === 'user'),
    ai: characters.filter((character) => character.controlledBy === 'ai'),
  }
}

/**
 * NewSceneModal
 * Lets the user pick an initial cast from campaign characters and the reusable library.
 */
export function NewSceneModal({
  campaignCharacters,
  scenes,
  reusableCharacters,
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
  const sortedReusableCharacters = useMemo(
    () => [...reusableCharacters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [reusableCharacters],
  )
  const groupedCampaignCharacters = useMemo(
    () => groupCharactersByController(sortedCampaignCharacters),
    [sortedCampaignCharacters],
  )
  const groupedReusableCharacters = useMemo(
    () => groupCharactersByController(sortedReusableCharacters),
    [sortedReusableCharacters],
  )

  const [selectedCampaignCharacterIds, setSelectedCampaignCharacterIds] = useState<string[]>([])
  const [selectedReusableCharacterIds, setSelectedReusableCharacterIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [sceneSetup, setSceneSetup] = useState('')
  const [openingNotes, setOpeningNotes] = useState('')
  const [continuitySourceSceneId, setContinuitySourceSceneId] = useState<string>('')

  useEffect(() => {
    setSelectedCampaignCharacterIds([])
    setSelectedReusableCharacterIds([])
    setTitle(`Scene ${scenes.length + 1}`)
    setSceneSetup('')
    setOpeningNotes('')
    setContinuitySourceSceneId('')
  }, [scenes.length])

  const hasSelectedPlayerCharacter = useMemo(() => {
    const selectedCampaignPlayers = sortedCampaignCharacters.some((character) =>
      selectedCampaignCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )
    const selectedReusablePlayers = sortedReusableCharacters.some((character) =>
      selectedReusableCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )

    return selectedCampaignPlayers || selectedReusablePlayers
  }, [selectedCampaignCharacterIds, selectedReusableCharacterIds, sortedCampaignCharacters, sortedReusableCharacters])

  useEffect(() => {
    setSelectedCampaignCharacterIds((currentIds) =>
      currentIds.filter((characterId) => sortedCampaignCharacters.some((character) => character.id === characterId)),
    )
  }, [sortedCampaignCharacters])

  useEffect(() => {
    setSelectedReusableCharacterIds((currentIds) =>
      currentIds.filter((characterId) => sortedReusableCharacters.some((character) => character.id === characterId)),
    )
  }, [sortedReusableCharacters])

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

  function toggleReusableCharacter(characterId: string): void {
    setSelectedReusableCharacterIds((currentIds) => (
      currentIds.includes(characterId)
        ? currentIds.filter((id) => id !== characterId)
        : [...currentIds, characterId]
    ))
  }

  async function handleStartScene(): Promise<void> {
    await onStartScene(
      selectedCampaignCharacterIds,
      selectedReusableCharacterIds,
      title.trim(),
      sceneSetup.trim(),
      continuitySourceSceneId.trim() || null,
      openingNotes.trim(),
    )
  }

  function renderCharacterList<T extends CharacterProfile | ReusableCharacter>(
    characters: T[],
    selectedIds: string[],
    onToggle: (characterId: string) => void,
    ariaLabelPrefix: string,
    showImportPill: boolean,
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
            <div
              key={character.id}
              className={`new-scene__item${isSelected ? ' new-scene__item--selected' : ''}`}
              role="listitem"
            >
              <input
                className="new-scene__checkbox"
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(character.id)}
                aria-label={`${showImportPill ? 'Import' : 'Include'} ${character.name} in the new scene`}
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
                  {showImportPill ? (
                    <span className="new-scene__pill new-scene__pill--import">Import on start</span>
                  ) : null}
                </div>
                <div className="new-scene__meta">{character.role || 'No role yet.'}</div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Modal title="New Scene" onClose={onClose} className="modal--new-scene">
      <ModalFormLayout
        body={(
          <div className="new-scene">
            <p className="new-scene__intro">
              Choose which characters should participate in this scene. Selected global characters will be imported into the campaign before the scene starts.
            </p>
            <p className="new-scene__requirement">
              At least one selected character must be player-controlled.
            </p>

            <section className="new-scene__section" aria-labelledby="new-scene-campaign-characters">
              <div className="new-scene__section-header">
                <h2 id="new-scene-campaign-characters" className="new-scene__heading">Campaign Characters</h2>
                <span className="new-scene__count">
                  {selectedCampaignCharacterIds.length} selected
                </span>
              </div>
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
                      false,
                    )}
                  </section>
                  <section className="new-scene__column" aria-labelledby="new-scene-campaign-ai">
                    <h3 id="new-scene-campaign-ai" className="new-scene__subheading">AI</h3>
                    {renderCharacterList(
                      groupedCampaignCharacters.ai,
                      selectedCampaignCharacterIds,
                      toggleCampaignCharacter,
                      'Campaign AI characters',
                      false,
                    )}
                  </section>
                </div>
              )}
            </section>

            <section className="new-scene__section" aria-labelledby="new-scene-global-characters">
              <div className="new-scene__section-header">
                <h2 id="new-scene-global-characters" className="new-scene__heading">Global Characters</h2>
                <span className="new-scene__count">
                  {selectedReusableCharacterIds.length} selected
                </span>
              </div>
              {sortedReusableCharacters.length === 0 ? (
                <p className="new-scene__empty">No global characters available.</p>
              ) : (
                <div className="new-scene__columns">
                  <section className="new-scene__column" aria-labelledby="new-scene-global-player">
                    <h3 id="new-scene-global-player" className="new-scene__subheading">Player</h3>
                    {renderCharacterList(
                      groupedReusableCharacters.player,
                      selectedReusableCharacterIds,
                      toggleReusableCharacter,
                      'Global player characters',
                      true,
                    )}
                  </section>
                  <section className="new-scene__column" aria-labelledby="new-scene-global-ai">
                    <h3 id="new-scene-global-ai" className="new-scene__subheading">AI</h3>
                    {renderCharacterList(
                      groupedReusableCharacters.ai,
                      selectedReusableCharacterIds,
                      toggleReusableCharacter,
                      'Global AI characters',
                      true,
                    )}
                  </section>
                </div>
              )}
            </section>

            <section className="new-scene__section" aria-labelledby="new-scene-setup">
              <div className="new-scene__section-header">
                <h2 id="new-scene-setup" className="new-scene__heading">Scene Setup</h2>
              </div>

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
            </section>

            {statusMessage ? (
              <div className={`new-scene__status new-scene__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : null}
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
                  disabled={isBusy || !hasSelectedPlayerCharacter || title.trim().length === 0 || sceneSetup.trim().length === 0}
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
