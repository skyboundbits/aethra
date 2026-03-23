/**
 * src/components/CharactersModal.tsx
 * Modal dialog for creating, editing, importing, and reusing characters.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import { ConfirmModal } from './ConfirmModal'
import { useConfirm } from '../hooks/useConfirm'
import { AvatarLibraryModal } from './AvatarLibraryModal'
import { UsersRoundIcon } from './icons'
import '../styles/characters.css'

import type { CharacterProfile, ReusableAvatar, ReusableCharacter, RelationshipGraph, RelationshipEntry, AffinityLabel } from '../types'

type CharactersTabId = 'new-character' | 'existing-campaign-characters' | 'existing-characters' | 'app-characters' | 'relationships'
type CharacterEditorMode = 'new-campaign' | 'edit-campaign' | 'edit-custom'
const CHARACTER_EDITOR_AVATAR_SIZE = 220
const CHARACTER_LIBRARY_GALLERY_AVATAR_SIZE = 96
const CHARACTER_HEADER_AVATAR_SIZE = 120

const DEFAULT_PRONOUNS_BY_GENDER: Record<CharacterProfile['gender'], CharacterProfile['pronouns']> = {
  male: 'he/him',
  female: 'she/her',
  'non-specific': 'they/them',
}

/** Props accepted by the CharactersModal component. */
interface CharactersModalProps {
  characters: CharacterProfile[]
  activeCharacterId: string | null
  statusMessage: string | null
  statusKind: 'error' | 'success' | null
  isBusy: boolean
  onClose: () => void
  onSelectCharacter: (characterId: string) => void
  onCreateCharacter: () => void
  onSaveCharacter: (character: CharacterProfile) => Promise<void>
  onDeleteCharacter: (characterId: string) => Promise<void>
  reusableAvatars: ReusableAvatar[]
  avatarLibraryStatusMessage: string | null
  avatarLibraryStatusKind: 'error' | 'success' | null
  isAvatarLibraryBusy: boolean
  onSaveReusableAvatar: (avatar: ReusableAvatar) => Promise<void>
  onDeleteReusableAvatar: (avatarId: string) => Promise<void>
  reusableCharacters: ReusableCharacter[]
  characterLibraryStatusMessage: string | null
  characterLibraryStatusKind: 'error' | 'success' | null
  isCharacterLibraryBusy: boolean
  onSaveReusableCharacter: (character: ReusableCharacter) => Promise<void>
  onDeleteReusableCharacter: (characterId: string) => Promise<void>
  onImportReusableCharacter: (character: ReusableCharacter) => Promise<void>
  /** Current persisted relationship graph for the campaign; null if none. */
  relationshipGraph: RelationshipGraph | null
  /** Persist an updated graph to disk immediately. */
  onSaveRelationships: (graph: RelationshipGraph) => Promise<void>
  /** Delete both directions of a pair (A→B and B→A) after confirmation. */
  onDeleteRelationshipPair: (fromId: string, toId: string) => Promise<void>
}

function createCampaignCharacterDraft(): CharacterProfile {
  const now = Date.now()
  return {
    id: '',
    name: '',
    folderName: '',
    role: '',
    gender: 'non-specific',
    pronouns: 'they/them',
    description: '',
    personality: '',
    speakingStyle: '',
    goals: '',
    avatarImageData: null,
    avatarCrop: { x: 0, y: 0, scale: 1 },
    controlledBy: 'ai',
    createdAt: now,
    updatedAt: now,
  }
}

function toReusableCharacter(character: CharacterProfile): ReusableCharacter {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    gender: character.gender,
    pronouns: character.pronouns,
    description: character.description,
    personality: character.personality,
    speakingStyle: character.speakingStyle,
    goals: character.goals,
    avatarImageData: character.avatarImageData,
    avatarCrop: character.avatarCrop,
    controlledBy: character.controlledBy,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  }
}

function toCampaignCharacter(character: ReusableCharacter): CharacterProfile {
  return {
    ...character,
    folderName: '',
  }
}

/** Props for the Relationships tab content panel. */
interface RelationshipsTabContentProps {
  graph: RelationshipGraph | null
  characters: CharacterProfile[]
  onSave: (graph: RelationshipGraph) => Promise<void>
  onDeletePair: (fromId: string, toId: string) => Promise<void>
}

/**
 * Relationships tab rendered inside the CharactersModal workspace layout.
 * Shows a pair list on the left and an editable detail view on the right.
 * Edits are saved to disk immediately on change/blur.
 */
function RelationshipsTabContent({ graph, characters, onSave, onDeletePair }: RelationshipsTabContentProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = graph?.entries[0]
    return first ? `${first.fromCharacterId}:${first.toCharacterId}` : null
  })

  /** Resolve a character name by ID. */
  function name(id: string): string {
    return characters.find((c) => c.id === id)?.name ?? id
  }

  /** Immediately persist a field edit. */
  async function handleFieldChange(
    fromId: string,
    toId: string,
    patch: Partial<Pick<RelationshipEntry, 'trustScore' | 'affinityLabel' | 'manualNotes'>>,
  ): Promise<void> {
    if (!graph) return
    const next: RelationshipGraph = {
      ...graph,
      entries: graph.entries.map((entry) =>
        entry.fromCharacterId === fromId && entry.toCharacterId === toId
          ? { ...entry, ...patch }
          : entry,
      ),
    }
    await onSave(next)
  }

  if (!graph || graph.entries.length === 0) {
    return (
      <div className="characters-modal__relationships-empty">
        <p>No relationship data yet. Use the <strong>Refresh Relationships</strong> button in the session panel to generate relationship data from your campaign transcripts.</p>
      </div>
    )
  }

  const selectedEntry = selectedKey
    ? graph.entries.find((e) => `${e.fromCharacterId}:${e.toCharacterId}` === selectedKey) ?? null
    : null

  // Group by source
  const grouped = new Map<string, RelationshipEntry[]>()
  for (const entry of graph.entries) {
    const group = grouped.get(entry.fromCharacterId) ?? []
    group.push(entry)
    grouped.set(entry.fromCharacterId, group)
  }

  return (
    <div className="characters-modal__relationships-layout">
      {/* Left: pair list */}
      <div className="characters-modal__relationships-list">
        {[...grouped.entries()].map(([fromId, entries]) => (
          <div key={fromId}>
            <p className="characters-modal__relationships-group-header">{name(fromId)}</p>
            {entries.map((entry) => {
              const key = `${entry.fromCharacterId}:${entry.toCharacterId}`
              return (
                <div key={key} className="characters-modal__relationships-pair-row">
                  <button
                    type="button"
                    className={[
                      'characters-modal__relationships-pair-btn',
                      selectedKey === key ? 'characters-modal__relationships-pair-btn--selected' : '',
                    ].join(' ')}
                    onClick={() => setSelectedKey(key)}
                  >
                    <span className={`rel-review__affinity-badge rel-review__affinity-badge--${entry.affinityLabel}`}>
                      {entry.affinityLabel}
                    </span>
                    → {name(entry.toCharacterId)}
                  </button>
                  <button
                    type="button"
                    className="characters-modal__relationships-delete-btn"
                    title="Delete this relationship pair"
                    onClick={() => { void onDeletePair(entry.fromCharacterId, entry.toCharacterId) }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Right: detail view */}
      <div className="characters-modal__relationships-detail">
        {selectedEntry ? (
          <div className="rel-review__detail">
            <h3 className="rel-review__detail-header">
              {name(selectedEntry.fromCharacterId)} → {name(selectedEntry.toCharacterId)}
            </h3>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-trust">Trust Score (0–100)</label>
              <input
                id="cm-rel-trust"
                type="number"
                min={0}
                max={100}
                className="rel-review__trust-input"
                defaultValue={selectedEntry.trustScore}
                key={`trust-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                onBlur={(e) => {
                  const val = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, { trustScore: val })
                }}
              />
            </div>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-affinity">Affinity</label>
              <select
                id="cm-rel-affinity"
                className="rel-review__affinity-select"
                defaultValue={selectedEntry.affinityLabel}
                key={`affinity-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                onBlur={(e) =>
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
                    affinityLabel: e.target.value as AffinityLabel,
                  })
                }
              >
                {(['hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted'] as AffinityLabel[]).map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="rel-review__field-label">AI Summary (read-only)</label>
              <textarea className="rel-review__summary-text" value={selectedEntry.summary} readOnly />
            </div>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-notes">Manual Notes</label>
              <textarea
                id="cm-rel-notes"
                className="rel-review__notes-input"
                defaultValue={selectedEntry.manualNotes}
                key={`notes-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                placeholder="Add personal notes or context overrides…"
                onBlur={(e) =>
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
                    manualNotes: e.target.value,
                  })
                }
              />
            </div>
          </div>
        ) : (
          <p className="rel-review__no-selection">Select a pair to view details.</p>
        )}
      </div>
    </div>
  )
}

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
  onDeleteCharacter,
  reusableAvatars,
  avatarLibraryStatusMessage,
  avatarLibraryStatusKind,
  isAvatarLibraryBusy,
  onSaveReusableAvatar,
  onDeleteReusableAvatar,
  reusableCharacters,
  characterLibraryStatusMessage,
  characterLibraryStatusKind,
  isCharacterLibraryBusy,
  onSaveReusableCharacter,
  onDeleteReusableCharacter,
  onImportReusableCharacter,
  relationshipGraph,
  onSaveRelationships,
  onDeleteRelationshipPair,
}: CharactersModalProps) {
  const { confirm, confirmState } = useConfirm()
  const [activeTab, setActiveTab] = useState<CharactersTabId>('new-character')
  const [editorMode, setEditorMode] = useState<CharacterEditorMode>('new-campaign')
  const [draft, setDraft] = useState<CharacterProfile>(createCampaignCharacterDraft())
  const [isAvatarLibraryOpen, setIsAvatarLibraryOpen] = useState(false)
  const [selectedCampaignCharacterId, setSelectedCampaignCharacterId] = useState<string | null>(activeCharacterId)
  const [selectedReusableCharacterId, setSelectedReusableCharacterId] = useState<string | null>(null)

  const sortedCampaignCharacters = useMemo(
    () => [...characters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [characters],
  )
  const sortedReusableCharacters = useMemo(
    () => [...reusableCharacters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [reusableCharacters],
  )

  useEffect(() => {
    setSelectedCampaignCharacterId(activeCharacterId)
  }, [activeCharacterId])

  useEffect(() => {
    if (activeTab === 'new-character' && editorMode === 'new-campaign' && draft.id !== '') {
      setDraft(createCampaignCharacterDraft())
    }
  }, [activeTab, draft.id, editorMode])

  function updateDraftField<K extends keyof CharacterProfile>(field: K, value: CharacterProfile[K]): void {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  function handleGenderChange(gender: CharacterProfile['gender']): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      gender,
      pronouns: DEFAULT_PRONOUNS_BY_GENDER[gender],
    }))
  }

  async function handleTabClick(tabId: CharactersTabId): Promise<void> {
    if (tabId === activeTab && (isEditingCampaignCharacter || isEditingReusableCharacter)) {
      const confirmed = await confirm({
        title: 'Discard Changes',
        message: 'You have unsaved changes. Discard them and return to the library?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep Editing',
      })
      if (!confirmed) return
      setEditorMode('new-campaign')
      return
    }

    if (tabId === 'new-character') {
      setEditorMode('new-campaign')
      setDraft(createCampaignCharacterDraft())
    }

    setActiveTab(tabId)
  }

  async function handleSave(): Promise<void> {
    if (editorMode === 'edit-custom') {
      await onSaveReusableCharacter(toReusableCharacter(draft))
      setActiveTab('existing-characters')
      return
    }

    await onSaveCharacter({
      ...draft,
      name: draft.name.trim(),
      role: draft.role.trim(),
    })
    setEditorMode('edit-campaign')
    setActiveTab('existing-campaign-characters')
  }

  async function handleDeleteEditedCharacter(): Promise<void> {
    if (!draft.id) {
      return
    }

    if (isEditingReusableCharacter) {
      await onDeleteReusableCharacter(draft.id)
      setSelectedReusableCharacterId(null)
      setEditorMode('new-campaign')
      setDraft(createCampaignCharacterDraft())
      setActiveTab('existing-characters')
      return
    }

    await onDeleteCharacter(draft.id)
    setSelectedCampaignCharacterId(null)
    setEditorMode('new-campaign')
    setDraft(createCampaignCharacterDraft())
    setActiveTab('existing-campaign-characters')
  }

  const selectedCampaignCharacter =
    sortedCampaignCharacters.find((character) => character.id === selectedCampaignCharacterId) ?? null
  const selectedReusableCharacter =
    sortedReusableCharacters.find((character) => character.id === selectedReusableCharacterId) ?? null
  const isEditingCampaignCharacter = activeTab === 'existing-campaign-characters' && editorMode === 'edit-campaign'
  const isEditingReusableCharacter = activeTab === 'existing-characters' && editorMode === 'edit-custom'
  const isShowingEditor = activeTab === 'new-character' || isEditingCampaignCharacter || isEditingReusableCharacter
  const editorAvatarOffsetScale = CHARACTER_HEADER_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
  const editorAvatarStyle = draft.avatarImageData
    ? {
      backgroundImage: `url("${draft.avatarImageData}")`,
      backgroundPosition: `${draft.avatarCrop.x * editorAvatarOffsetScale}px ${draft.avatarCrop.y * editorAvatarOffsetScale}px`,
      backgroundSize: `${draft.avatarCrop.scale * 100}%`,
    }
    : undefined

  return (
    <>
      <Modal
        title={(
          <>
            <UsersRoundIcon className="modal__title-icon" aria-hidden="true" />
            <span>Characters</span>
          </>
        )}
        onClose={onClose}
        variant="workspace"
      >
        <ModalWorkspaceLayout
          nav={(
            <aside className="characters-modal__nav" aria-label="Character sections">
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'new-character' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('new-character')
                }}
              >
                New Character
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'existing-campaign-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('existing-campaign-characters')
                }}
              >
                Existing Campaign Characters
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'existing-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('existing-characters')
                }}
              >
                Existing Characters
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'app-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('app-characters')
                }}
              >
                App Characters
              </button>
              <div className="characters-modal__nav-divider">Relationships</div>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'relationships' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('relationships')
                }}
              >
                Relationships
              </button>
            </aside>
          )}
        panel={(
          <section className="characters-modal__panel">
              {activeTab === 'relationships' ? (
                <RelationshipsTabContent
                  graph={relationshipGraph}
                  characters={characters}
                  onSave={onSaveRelationships}
                  onDeletePair={onDeleteRelationshipPair}
                />
              ) : activeTab === 'app-characters' ? (
                <div className="characters-modal__blank">App characters are not available yet.</div>
              ) : activeTab === 'existing-campaign-characters' && !isEditingCampaignCharacter ? (
                <div className="characters-modal__library">
                  <div>
                    <h2 className="characters-modal__heading">Existing Campaign Characters</h2>
                    <p className="characters-modal__subheading">Characters already stored inside this campaign.</p>
                  </div>
                  {sortedCampaignCharacters.length === 0 ? (
                    <div className="characters-modal__blank">No campaign characters yet.</div>
                  ) : (
                    <div className="characters-modal__gallery" role="list" aria-label="Campaign characters">
                      {sortedCampaignCharacters.map((character) => {
                        const avatarOffsetScale = CHARACTER_LIBRARY_GALLERY_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                        const avatarStyle = character.avatarImageData
                          ? {
                            backgroundImage: `url("${character.avatarImageData}")`,
                            backgroundPosition: `${character.avatarCrop.x * avatarOffsetScale}px ${character.avatarCrop.y * avatarOffsetScale}px`,
                            backgroundSize: `${character.avatarCrop.scale * 100}%`,
                          }
                          : undefined

                        return (
                          <button
                            key={character.id}
                            type="button"
                            role="listitem"
                            className={`characters-modal__gallery-item${selectedCampaignCharacterId === character.id ? ' characters-modal__gallery-item--active' : ''}`}
                            onClick={() => {
                              setSelectedCampaignCharacterId(character.id)
                              onSelectCharacter(character.id)
                            }}
                          >
                            <div className={`characters-modal__gallery-avatar${avatarStyle ? ' characters-modal__gallery-avatar--image' : ''}`} style={avatarStyle}>
                              {avatarStyle ? null : character.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="characters-modal__gallery-name">{character.name}</span>
                            <span className="characters-modal__gallery-summary">{character.role || 'No role yet.'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === 'existing-characters' && !isEditingReusableCharacter ? (
                <div className="characters-modal__library">
                  <div>
                    <h2 className="characters-modal__heading">Existing Characters</h2>
                    <p className="characters-modal__subheading">Global custom characters that can be reused across campaigns.</p>
                  </div>
                  {sortedReusableCharacters.length === 0 ? (
                    <div className="characters-modal__blank">No saved custom characters yet.</div>
                  ) : (
                    <div className="characters-modal__gallery" role="list" aria-label="Existing characters">
                      {sortedReusableCharacters.map((character) => {
                        const avatarOffsetScale = CHARACTER_LIBRARY_GALLERY_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                        const avatarStyle = character.avatarImageData
                          ? {
                            backgroundImage: `url("${character.avatarImageData}")`,
                            backgroundPosition: `${character.avatarCrop.x * avatarOffsetScale}px ${character.avatarCrop.y * avatarOffsetScale}px`,
                            backgroundSize: `${character.avatarCrop.scale * 100}%`,
                          }
                          : undefined

                        return (
                          <button
                            key={character.id}
                            type="button"
                            role="listitem"
                            className={`characters-modal__gallery-item${selectedReusableCharacterId === character.id ? ' characters-modal__gallery-item--active' : ''}`}
                            onClick={() => {
                              setSelectedReusableCharacterId(character.id)
                            }}
                          >
                            <div className={`characters-modal__gallery-avatar${avatarStyle ? ' characters-modal__gallery-avatar--image' : ''}`} style={avatarStyle}>
                              {avatarStyle ? null : character.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="characters-modal__gallery-name">{character.name}</span>
                            <span className="characters-modal__gallery-summary">{character.role || 'No role yet.'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="characters-modal__editor">
                  <div className="characters-modal__header">
                    <div>
                      <h2 className="characters-modal__heading">
                        {editorMode === 'edit-custom'
                          ? `Edit ${draft.name || 'Character'}`
                          : isEditingCampaignCharacter
                            ? `Edit ${draft.name || 'Character'}`
                            : 'New Character'}
                      </h2>
                      <p className="characters-modal__subheading">
                        {editorMode === 'edit-custom'
                          ? 'Update this global reusable character.'
                          : isEditingCampaignCharacter
                            ? 'Update this campaign character.'
                          : 'Create a new character for the current campaign.'}
                      </p>
                    </div>
                    {(isEditingCampaignCharacter || isEditingReusableCharacter) ? (
                      <button
                        type="button"
                        className="characters-modal__footer-btn"
                        onClick={() => { void handleTabClick(activeTab) }}
                      >
                        Back To Library
                      </button>
                    ) : null}
                  </div>
                  <div className="characters-modal__identity">
                    <button
                      type="button"
                      className={`characters-modal__identity-avatar${editorAvatarStyle ? ' characters-modal__identity-avatar--image' : ''}`}
                      style={editorAvatarStyle}
                      onClick={() => {
                        setIsAvatarLibraryOpen(true)
                      }}
                    >
                      {editorAvatarStyle ? null : <span>{draft.name.trim().slice(0, 2).toUpperCase() || 'AV'}</span>}
                    </button>
                    <div className="characters-modal__identity-copy">
                      <label className="characters-modal__label" htmlFor="character-name">Character Name</label>
                      <input id="character-name" className="characters-modal__input" type="text" value={draft.name} onChange={(event) => updateDraftField('name', event.target.value)} placeholder="Character name" />
                      <p className="characters-modal__subheading">
                        {editorMode === 'edit-custom'
                          ? 'Click the avatar to choose or create one from your avatar library.'
                          : draft.folderName
                            ? <>Stored in <code>characters/{draft.folderName}</code></>
                            : <>Click the avatar to choose or create one from your avatar library.</>}
                      </p>
                    </div>
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-role">Role</label>
                    <input id="character-role" className="characters-modal__input" type="text" value={draft.role} onChange={(event) => updateDraftField('role', event.target.value)} placeholder="Imperial officer" />
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-controlled-by">Controlled By</label>
                    <select id="character-controlled-by" className="characters-modal__input app-select" value={draft.controlledBy} onChange={(event) => updateDraftField('controlledBy', event.target.value as CharacterProfile['controlledBy'])}>
                      <option value="ai">AI</option>
                      <option value="user">Player</option>
                    </select>
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-gender">Gender</label>
                    <select id="character-gender" className="characters-modal__input app-select" value={draft.gender} onChange={(event) => handleGenderChange(event.target.value as CharacterProfile['gender'])}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non-specific">Non Specific</option>
                    </select>
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-pronouns">Pronouns</label>
                    <select id="character-pronouns" className="characters-modal__input app-select" value={draft.pronouns} onChange={(event) => updateDraftField('pronouns', event.target.value as CharacterProfile['pronouns'])}>
                      <option value="he/him">He/Him</option>
                      <option value="she/her">She/Her</option>
                      <option value="they/them">They/Them</option>
                    </select>
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-description">Description</label>
                    <textarea id="character-description" className="characters-modal__textarea characters-modal__textarea--compact" value={draft.description} onChange={(event) => updateDraftField('description', event.target.value)} />
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-personality">Personality</label>
                    <textarea id="character-personality" className="characters-modal__textarea characters-modal__textarea--compact" value={draft.personality} onChange={(event) => updateDraftField('personality', event.target.value)} />
                  </div>
                  <div className="characters-modal__field">
                    <label className="characters-modal__label" htmlFor="character-speaking-style">Speaking Style</label>
                    <textarea id="character-speaking-style" className="characters-modal__textarea characters-modal__textarea--compact" value={draft.speakingStyle} onChange={(event) => updateDraftField('speakingStyle', event.target.value)} />
                  </div>
                  <div className="characters-modal__field characters-modal__field--grow">
                    <label className="characters-modal__label" htmlFor="character-goals">Goals</label>
                    <textarea id="character-goals" className="characters-modal__textarea" value={draft.goals} onChange={(event) => updateDraftField('goals', event.target.value)} />
                  </div>
                </div>
              )}
            </section>
          )}
        footer={(
            <ModalFooter
              status={(characterLibraryStatusMessage || statusMessage) ? (
                <div className={`characters-modal__status characters-modal__status--${
                  characterLibraryStatusMessage
                    ? (characterLibraryStatusKind ?? 'success')
                    : (statusKind ?? 'success')
                }`}>
                  {characterLibraryStatusMessage ?? statusMessage}
                </div>
              ) : undefined}
              actions={(
                <>
                  <button type="button" className="modal-footer__button" onClick={onClose}>Close</button>
                  {activeTab === 'existing-campaign-characters' && !isEditingCampaignCharacter ? (
                    <>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedCampaignCharacter || isCharacterLibraryBusy}
                        onClick={() => {
                          if (selectedCampaignCharacter) {
                            void onSaveReusableCharacter(toReusableCharacter(selectedCampaignCharacter))
                          }
                        }}
                      >
                        Save To Existing Characters
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button modal-footer__button--primary"
                        disabled={!selectedCampaignCharacter}
                        onClick={() => {
                          if (selectedCampaignCharacter) {
                            setDraft(selectedCampaignCharacter)
                            setEditorMode('edit-campaign')
                          }
                        }}
                      >
                        Edit Character
                      </button>
                    </>
                  ) : null}
                  {activeTab === 'existing-characters' && !isEditingReusableCharacter ? (
                    <>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedReusableCharacter || isCharacterLibraryBusy}
                        onClick={() => {
                          if (selectedReusableCharacter) {
                            void onDeleteReusableCharacter(selectedReusableCharacter.id)
                          }
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedReusableCharacter}
                        onClick={() => {
                          if (selectedReusableCharacter) {
                            setDraft(toCampaignCharacter(selectedReusableCharacter))
                            setEditorMode('edit-custom')
                          }
                        }}
                      >
                        Edit Character
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button modal-footer__button--primary"
                        disabled={!selectedReusableCharacter || isBusy}
                        onClick={() => {
                          if (selectedReusableCharacter) {
                            void onImportReusableCharacter(selectedReusableCharacter)
                          }
                        }}
                      >
                        Add To Campaign
                      </button>
                    </>
                  ) : null}
                  {isShowingEditor ? (
                    <>
                      {(isEditingCampaignCharacter || isEditingReusableCharacter) ? (
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={isBusy || isCharacterLibraryBusy}
                        onClick={() => {
                          void handleDeleteEditedCharacter()
                        }}
                      >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="modal-footer__button"
                          disabled={!draft.name.trim() || isCharacterLibraryBusy}
                          onClick={() => {
                            void onSaveReusableCharacter(toReusableCharacter(draft))
                          }}
                        >
                          Save To Existing Characters
                        </button>
                      )}
                      <button
                        type="button"
                        className="modal-footer__button modal-footer__button--primary"
                        onClick={() => {
                          void handleSave()
                        }}
                        disabled={!draft.name.trim() || isBusy || isCharacterLibraryBusy}
                      >
                        {isBusy || isCharacterLibraryBusy ? 'Saving...' : (isEditingCampaignCharacter || editorMode === 'edit-custom' ? 'Save Character' : 'Save To Campaign')}
                      </button>
                    </>
                  ) : null}
                </>
              )}
            />
          )}
        />
      </Modal>
      {isAvatarLibraryOpen ? (
        <AvatarLibraryModal
          avatars={reusableAvatars}
          statusMessage={avatarLibraryStatusMessage}
          statusKind={avatarLibraryStatusKind}
          isBusy={isAvatarLibraryBusy}
          onClose={() => {
            setIsAvatarLibraryOpen(false)
          }}
          onApplyAvatar={(avatar) => {
            updateDraftField('avatarImageData', avatar.imageData)
            updateDraftField('avatarCrop', avatar.crop)
            setIsAvatarLibraryOpen(false)
          }}
          onSaveAvatar={onSaveReusableAvatar}
          onDeleteAvatar={onDeleteReusableAvatar}
        />
      ) : null}
      {confirmState ? <ConfirmModal {...confirmState} /> : null}
    </>
  )
}
