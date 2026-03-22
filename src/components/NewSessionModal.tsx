/**
 * src/components/NewSessionModal.tsx
 * Modal dialog for choosing which campaign and global characters join a new session.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalFormLayout } from './ModalLayouts'
import '../styles/new-session.css'
import type { CharacterProfile, ReusableCharacter } from '../types'

const CHARACTER_EDITOR_AVATAR_SIZE = 220
const MODAL_AVATAR_SIZE = 48

/** Props accepted by the NewSessionModal component. */
interface NewSessionModalProps {
  /** Campaign-scoped characters already available. */
  campaignCharacters: CharacterProfile[]
  /** Reusable global characters available for import. */
  reusableCharacters: ReusableCharacter[]
  /** Status message shown beneath the picker. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while starting the session and importing characters. */
  isBusy: boolean
  /** Close the modal without creating a session. */
  onClose: () => void
  /** Start the session with the selected campaign and global characters. */
  onStartSession: (campaignCharacterIds: string[], reusableCharacterIds: string[]) => Promise<void>
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
 * NewSessionModal
 * Lets the user pick an initial cast from campaign characters and the reusable library.
 */
export function NewSessionModal({
  campaignCharacters,
  reusableCharacters,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onStartSession,
}: NewSessionModalProps) {
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

  async function handleStartSession(): Promise<void> {
    await onStartSession(selectedCampaignCharacterIds, selectedReusableCharacterIds)
  }

  function renderCharacterList<T extends CharacterProfile | ReusableCharacter>(
    characters: T[],
    selectedIds: string[],
    onToggle: (characterId: string) => void,
    ariaLabelPrefix: string,
    showImportPill: boolean,
  ): React.ReactNode {
    if (characters.length === 0) {
      return <p className="new-session__empty">No characters in this group.</p>
    }

    return (
      <div className="new-session__list" role="list" aria-label={ariaLabelPrefix}>
        {characters.map((character) => {
          const isSelected = selectedIds.includes(character.id)
          const avatarStyle = getAvatarStyle(character.avatarImageData, character.avatarCrop)

          return (
            <label
              key={character.id}
              className={`new-session__item${isSelected ? ' new-session__item--selected' : ''}`}
              role="listitem"
            >
              <input
                className="new-session__checkbox"
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(character.id)}
                aria-label={`${showImportPill ? 'Import' : 'Include'} ${character.name} in the new session`}
              />
              <div
                className={`new-session__avatar${avatarStyle ? ' new-session__avatar--image' : ''}`}
                style={avatarStyle}
                aria-hidden="true"
              >
                {avatarStyle ? null : getCharacterInitials(character.name)}
              </div>
              <div className="new-session__copy">
                <div className="new-session__name-row">
                  <span className="new-session__name">{character.name}</span>
                  <span className={`new-session__pill${character.controlledBy === 'user' ? ' new-session__pill--player' : ''}`}>
                    {character.controlledBy === 'user' ? 'Player' : 'AI'}
                  </span>
                  {showImportPill ? (
                    <span className="new-session__pill new-session__pill--import">Import on start</span>
                  ) : null}
                </div>
                <div className="new-session__meta">{character.role || 'No role yet.'}</div>
              </div>
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <Modal title="New Session" onClose={onClose} className="modal--new-session">
      <ModalFormLayout
        body={(
          <div className="new-session">
            <p className="new-session__intro">
              Choose which characters should participate in this session. Selected global characters will be imported into the campaign before the session starts.
            </p>
            <p className="new-session__requirement">
              At least one selected character must be player-controlled.
            </p>

            <section className="new-session__section" aria-labelledby="new-session-campaign-characters">
              <div className="new-session__section-header">
                <h2 id="new-session-campaign-characters" className="new-session__heading">Campaign Characters</h2>
                <span className="new-session__count">
                  {selectedCampaignCharacterIds.length} selected
                </span>
              </div>
              {sortedCampaignCharacters.length === 0 ? (
                <p className="new-session__empty">No campaign characters yet.</p>
              ) : (
                <div className="new-session__columns">
                  <section className="new-session__column" aria-labelledby="new-session-campaign-player">
                    <h3 id="new-session-campaign-player" className="new-session__subheading">Player</h3>
                    {renderCharacterList(
                      groupedCampaignCharacters.player,
                      selectedCampaignCharacterIds,
                      toggleCampaignCharacter,
                      'Campaign player characters',
                      false,
                    )}
                  </section>
                  <section className="new-session__column" aria-labelledby="new-session-campaign-ai">
                    <h3 id="new-session-campaign-ai" className="new-session__subheading">AI</h3>
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

            <section className="new-session__section" aria-labelledby="new-session-global-characters">
              <div className="new-session__section-header">
                <h2 id="new-session-global-characters" className="new-session__heading">Global Characters</h2>
                <span className="new-session__count">
                  {selectedReusableCharacterIds.length} selected
                </span>
              </div>
              {sortedReusableCharacters.length === 0 ? (
                <p className="new-session__empty">No global characters available.</p>
              ) : (
                <div className="new-session__columns">
                  <section className="new-session__column" aria-labelledby="new-session-global-player">
                    <h3 id="new-session-global-player" className="new-session__subheading">Player</h3>
                    {renderCharacterList(
                      groupedReusableCharacters.player,
                      selectedReusableCharacterIds,
                      toggleReusableCharacter,
                      'Global player characters',
                      true,
                    )}
                  </section>
                  <section className="new-session__column" aria-labelledby="new-session-global-ai">
                    <h3 id="new-session-global-ai" className="new-session__subheading">AI</h3>
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

            {statusMessage ? (
              <div className={`new-session__status new-session__status--${statusKind ?? 'success'}`}>
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
                    void handleStartSession()
                  }}
                  disabled={isBusy || !hasSelectedPlayerCharacter}
                >
                  {isBusy ? 'Starting...' : 'Start Session'}
                </button>
              </>
            )}
          />
        )}
      />
    </Modal>
  )
}
