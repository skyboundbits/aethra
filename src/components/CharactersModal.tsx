/**
 * src/components/CharactersModal.tsx
 * Modal dialog for creating, editing, importing, and reusing characters.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalPopupLayout, ModalWorkspaceLayout } from './ModalLayouts'
import { ConfirmModal } from './ConfirmModal'
import { useConfirm } from '../hooks/useConfirm'
import { AvatarCropEditor } from './AvatarCropEditor'
import { UserCircleIcon, UserIcon, UserPlusIcon, UsersIcon, UsersRoundIcon, WorldStarIcon } from './icons'
import '../styles/characters.css'

import type {
  CharacterProfile,
  ReusableAvatar,
  ReusableCharacter,
  ReusableCharacterRelationshipBundle,
  RelationshipGraph,
  RelationshipEntry,
  AffinityLabel,
} from '../types'

type CharactersTabId = 'new-character' | 'existing-campaign-characters' | 'existing-characters' | 'avatars' | 'app-characters'
type CharacterEditorMode = 'new-campaign' | 'edit-campaign' | 'edit-custom'
type CharacterEditorSection = 'details' | 'relationships'
type AvatarLibrarySection = 'user-avatars' | 'application-avatars'
type AvatarEditorMode = 'browse' | 'create' | 'edit'
type AvatarReturnTab = 'new-character' | 'existing-campaign-characters' | 'existing-characters'
const CHARACTER_EDITOR_AVATAR_SIZE = 220
const CHARACTER_LIBRARY_GALLERY_AVATAR_SIZE = 96
const CHARACTER_HEADER_AVATAR_SIZE = 120

const DEFAULT_PRONOUNS_BY_GENDER: Record<CharacterProfile['gender'], CharacterProfile['pronouns']> = {
  male: 'he/him',
  female: 'she/her',
  'non-specific': 'they/them',
}

interface SaveReusableCharacterConfirmationState {
  character: CharacterProfile
  relationshipBundle: ReusableCharacterRelationshipBundle | null
}

interface SaveReusableCharacterConfirmModalProps {
  characterName: string
  relationshipCount: number
  relatedCharacterCount: number
  copyRelationships: boolean
  onToggleCopyRelationships: (checked: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

function SaveReusableCharacterConfirmModal({
  characterName,
  relationshipCount,
  relatedCharacterCount,
  copyRelationships,
  onToggleCopyRelationships,
  onConfirm,
  onCancel,
}: SaveReusableCharacterConfirmModalProps) {
  const hasRelationships = relationshipCount > 0 && relatedCharacterCount > 1

  return (
    <Modal title="Save To Global Characters" onClose={onCancel} variant="popup">
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
                  onClick={onConfirm}
                >
                  Save Character
                </button>
              </>
            )}
          />
        )}
      >
        <p className="confirm-modal__message">Save {characterName || 'this character'} to Global Characters?</p>
        {hasRelationships ? (
          <label className="characters-modal__checkbox-row">
            <input
              type="checkbox"
              checked={copyRelationships}
              onChange={(event) => { onToggleCopyRelationships(event.target.checked) }}
            />
            <span>
              Also copy relationships and {relatedCharacterCount - 1} linked character{relatedCharacterCount === 2 ? '' : 's'}.
            </span>
          </label>
        ) : (
          <p className="confirm-modal__warning">No relationship data will be copied.</p>
        )}
      </ModalPopupLayout>
    </Modal>
  )
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
  onSaveReusableCharacter: (
    character: ReusableCharacter,
    relationshipBundle?: ReusableCharacterRelationshipBundle,
  ) => Promise<void>
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
    avatarSourceId: undefined,
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
    avatarSourceId: character.avatarSourceId,
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

interface AvatarDraft {
  id: string
  name: string
  imageData: string | null
  crop: ReusableAvatar['crop']
  createdAt: number
  updatedAt: number
}

const SAVED_AVATAR_IMAGE_SIZE = 512

function createEmptyAvatarDraft(): AvatarDraft {
  const now = Date.now()
  return {
    id: '',
    name: '',
    imageData: null,
    crop: { x: 0, y: 0, scale: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function getAvatarDraftSnapshot(avatar: AvatarDraft): string {
  return JSON.stringify({
    id: avatar.id,
    name: avatar.name,
    imageData: avatar.imageData,
    crop: avatar.crop,
  })
}

async function renderAvatarThumbnail(
  imageData: string,
  crop: ReusableAvatar['crop'],
  size: number = SAVED_AVATAR_IMAGE_SIZE,
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image()
    nextImage.onload = () => resolve(nextImage)
    nextImage.onerror = () => reject(new Error('Could not render avatar image.'))
    nextImage.src = imageData
  })

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create avatar canvas.')
  }

  const viewportScale = size / CHARACTER_EDITOR_AVATAR_SIZE
  const renderedWidth = size * crop.scale
  const renderedHeight = renderedWidth * (image.naturalHeight / image.naturalWidth)
  context.clearRect(0, 0, size, size)
  context.drawImage(
    image,
    crop.x * viewportScale,
    crop.y * viewportScale,
    renderedWidth,
    renderedHeight,
  )
  return canvas.toDataURL('image/png')
}

/**
 * Build a stable snapshot for unsaved-change detection.
 * Runtime timestamps are intentionally excluded.
 */
function getCharacterDraftSnapshot(character: CharacterProfile): string {
  return JSON.stringify({
    id: character.id,
    name: character.name,
    folderName: character.folderName,
    role: character.role,
    gender: character.gender,
    pronouns: character.pronouns,
    description: character.description,
    personality: character.personality,
    speakingStyle: character.speakingStyle,
    goals: character.goals,
    avatarImageData: character.avatarImageData,
    avatarSourceId: character.avatarSourceId ?? null,
    avatarCrop: character.avatarCrop,
    controlledBy: character.controlledBy,
  })
}

/** Props for the in-editor relationships panel. */
interface CharacterRelationshipsPanelProps {
  graph: RelationshipGraph | null
  draft: CharacterProfile
  characters: CharacterProfile[]
  onSave: (graph: RelationshipGraph) => Promise<void>
  onDeletePair: (fromId: string, toId: string) => Promise<void>
}

/**
 * Relationships editor rendered inside one campaign character editor.
 * Each directed relationship is edited inline and saved immediately.
 */
function CharacterRelationshipsPanel({ graph, draft, characters, onSave, onDeletePair }: CharacterRelationshipsPanelProps) {
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

  if (!draft.id) {
    return (
      <div className="characters-modal__relationships-empty">
        <p>Save this character to the campaign before editing relationships.</p>
      </div>
    )
  }

  if (!graph || graph.entries.length === 0) {
    return (
      <div className="characters-modal__relationships-empty">
        <p>No relationship data yet. Use the <strong>Refresh Relationships</strong> button in the session panel to generate relationship data from your campaign transcripts.</p>
      </div>
    )
  }

  const directedEntries = graph.entries
    .filter((entry) => entry.fromCharacterId === draft.id && entry.toCharacterId !== draft.id)
    .sort((first, second) => {
      const firstName = characters.find((character) => character.id === first.toCharacterId)?.name ?? first.toCharacterId
      const secondName = characters.find((character) => character.id === second.toCharacterId)?.name ?? second.toCharacterId
      return firstName.localeCompare(secondName, undefined, { sensitivity: 'base' })
    })

  if (directedEntries.length === 0) {
    return (
      <div className="characters-modal__relationships-empty">
        <p>No relationship entries exist for this character yet.</p>
      </div>
    )
  }

  return (
    <div className="characters-modal__relationships-stack">
      {directedEntries.map((entry) => {
        const targetName = characters.find((character) => character.id === entry.toCharacterId)?.name ?? entry.toCharacterId
        const trustInputId = `character-relationship-trust-${entry.fromCharacterId}-${entry.toCharacterId}`
        const affinityInputId = `character-relationship-affinity-${entry.fromCharacterId}-${entry.toCharacterId}`
        const notesInputId = `character-relationship-notes-${entry.fromCharacterId}-${entry.toCharacterId}`

        return (
          <section key={`${entry.fromCharacterId}:${entry.toCharacterId}`} className="characters-modal__relationship-card">
            <div className="characters-modal__relationship-card-header">
              <div>
                <h3 className="characters-modal__relationship-name">{targetName}</h3>
                <p className="characters-modal__relationship-subheading">
                  {draft.name || 'This character'}'s perspective toward {targetName}.
                </p>
              </div>
              <button
                type="button"
                className="characters-modal__relationships-delete-btn"
                title="Delete this relationship pair"
                onClick={() => { void onDeletePair(entry.fromCharacterId, entry.toCharacterId) }}
              >
                Delete Pair
              </button>
            </div>

            <div className="characters-modal__relationship-grid">
              <div className="characters-modal__field">
                <label className="characters-modal__label" htmlFor={trustInputId}>Trust Score (0-100)</label>
                <input
                  id={trustInputId}
                  type="number"
                  min={0}
                  max={100}
                  className="characters-modal__input"
                  defaultValue={entry.trustScore}
                  onBlur={(event) => {
                    const value = Math.max(0, Math.min(100, Number(event.target.value) || 0))
                    void handleFieldChange(entry.fromCharacterId, entry.toCharacterId, { trustScore: value })
                  }}
                />
              </div>

              <div className="characters-modal__field">
                <label className="characters-modal__label" htmlFor={affinityInputId}>Affinity</label>
                <select
                  id={affinityInputId}
                  className="characters-modal__input app-select"
                  defaultValue={entry.affinityLabel}
                  onBlur={(event) => {
                    void handleFieldChange(entry.fromCharacterId, entry.toCharacterId, {
                      affinityLabel: event.target.value as AffinityLabel,
                    })
                  }}
                >
                  {(['hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted'] as AffinityLabel[]).map((label) => (
                    <option key={label} value={label}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="characters-modal__field">
              <label className="characters-modal__label">AI Summary</label>
              <textarea className="characters-modal__textarea characters-modal__textarea--compact" value={entry.summary} readOnly />
            </div>

            <div className="characters-modal__field">
              <label className="characters-modal__label" htmlFor={notesInputId}>Manual Notes</label>
              <textarea
                id={notesInputId}
                className="characters-modal__textarea characters-modal__textarea--compact"
                defaultValue={entry.manualNotes}
                placeholder="Add personal notes or context overrides..."
                onBlur={(event) => {
                  void handleFieldChange(entry.fromCharacterId, entry.toCharacterId, {
                    manualNotes: event.target.value,
                  })
                }}
              />
            </div>
          </section>
        )
      })}
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
  const initialDraft = createCampaignCharacterDraft()
  const [activeTab, setActiveTab] = useState<CharactersTabId>('new-character')
  const [editorMode, setEditorMode] = useState<CharacterEditorMode>('new-campaign')
  const [draft, setDraft] = useState<CharacterProfile>(initialDraft)
  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState<string>(() => getCharacterDraftSnapshot(initialDraft))
  const [editorSection, setEditorSection] = useState<CharacterEditorSection>('details')
  const [avatarSection, setAvatarSection] = useState<AvatarLibrarySection>('user-avatars')
  const [avatarEditorMode, setAvatarEditorMode] = useState<AvatarEditorMode>('browse')
  const [isSelectingAvatarForCharacter, setIsSelectingAvatarForCharacter] = useState(false)
  const [avatarReturnTab, setAvatarReturnTab] = useState<AvatarReturnTab>('new-character')
  const [selectedReusableAvatarId, setSelectedReusableAvatarId] = useState<string | null>(null)
  const initialAvatarDraft = createEmptyAvatarDraft()
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft>(initialAvatarDraft)
  const [savedAvatarDraftSnapshot, setSavedAvatarDraftSnapshot] = useState<string>(() => getAvatarDraftSnapshot(initialAvatarDraft))
  const [selectedCampaignCharacterId, setSelectedCampaignCharacterId] = useState<string | null>(activeCharacterId)
  const [selectedReusableCharacterId, setSelectedReusableCharacterId] = useState<string | null>(null)
  const [saveReusableConfirmation, setSaveReusableConfirmation] = useState<SaveReusableCharacterConfirmationState | null>(null)
  const [copyRelationshipsOnSave, setCopyRelationshipsOnSave] = useState(false)

  function buildReusableRelationshipBundle(character: CharacterProfile): ReusableCharacterRelationshipBundle | null {
    if (!relationshipGraph) {
      return null
    }

    const includedIds = new Set<string>([character.id])
    let didExpand = true
    while (didExpand) {
      didExpand = false
      for (const entry of relationshipGraph.entries) {
        if (includedIds.has(entry.fromCharacterId) || includedIds.has(entry.toCharacterId)) {
          if (!includedIds.has(entry.fromCharacterId)) {
            includedIds.add(entry.fromCharacterId)
            didExpand = true
          }
          if (!includedIds.has(entry.toCharacterId)) {
            includedIds.add(entry.toCharacterId)
            didExpand = true
          }
        }
      }
    }

    if (includedIds.size < 2) {
      return null
    }

    const bundledCharacters = characters
      .filter((candidate) => includedIds.has(candidate.id))
      .map((candidate) => toReusableCharacter(candidate))
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))
      .map(({ relationshipBundle: _relationshipBundle, ...candidate }) => candidate)
    const bundledCharacterIds = new Set(bundledCharacters.map((candidate) => candidate.id))
    const bundledEntries = relationshipGraph.entries.filter((entry) =>
      bundledCharacterIds.has(entry.fromCharacterId) && bundledCharacterIds.has(entry.toCharacterId),
    )

    if (bundledCharacters.length < 2 || bundledEntries.length === 0) {
      return null
    }

    return {
      rootCharacterId: character.id,
      characters: bundledCharacters,
      entries: bundledEntries,
    }
  }

  function promptSaveReusableCharacter(character: CharacterProfile): void {
    const relationshipBundle = buildReusableRelationshipBundle(character)
    setCopyRelationshipsOnSave(relationshipBundle !== null)
    setSaveReusableConfirmation({ character, relationshipBundle })
  }

  async function handleConfirmSaveReusableCharacter(): Promise<void> {
    if (!saveReusableConfirmation) {
      return
    }

    const { character, relationshipBundle } = saveReusableConfirmation
    setSaveReusableConfirmation(null)
    await onSaveReusableCharacter(
      toReusableCharacter(character),
      copyRelationshipsOnSave ? (relationshipBundle ?? undefined) : undefined,
    )
  }

  const sortedCampaignCharacters = useMemo(
    () => [...characters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [characters],
  )
  const sortedReusableCharacters = useMemo(
    () => [...reusableCharacters].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [reusableCharacters],
  )
  const sortedReusableAvatars = useMemo(
    () => [...reusableAvatars].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [reusableAvatars],
  )

  useEffect(() => {
    setSelectedCampaignCharacterId(activeCharacterId)
  }, [activeCharacterId])

  useEffect(() => {
    if (activeTab === 'new-character' && editorMode === 'new-campaign' && draft.id !== '') {
      const nextDraft = createCampaignCharacterDraft()
      setDraft(nextDraft)
      setSavedDraftSnapshot(getCharacterDraftSnapshot(nextDraft))
    }
  }, [activeTab, draft.id, editorMode])

  useEffect(() => {
    if (avatarSection !== 'user-avatars') {
      return
    }

    if (avatarEditorMode === 'create') {
      return
    }

    const selectedAvatar = sortedReusableAvatars.find((avatar) => avatar.id === selectedReusableAvatarId) ?? null
    if (selectedAvatar) {
      setAvatarDraft(selectedAvatar)
      setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(selectedAvatar))
      return
    }

    const firstAvatar = sortedReusableAvatars[0] ?? null
    setSelectedReusableAvatarId(firstAvatar?.id ?? null)
    if (firstAvatar) {
      setAvatarDraft(firstAvatar)
      setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(firstAvatar))
    }
  }, [avatarEditorMode, avatarSection, selectedReusableAvatarId, sortedReusableAvatars])

  function updateDraftField<K extends keyof CharacterProfile>(field: K, value: CharacterProfile[K]): void {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  function updateAvatarDraftField<K extends keyof AvatarDraft>(field: K, value: AvatarDraft[K]): void {
    setAvatarDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
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
      const confirmed = await confirmDiscardChanges('You have unsaved changes. Discard them and return to the library?')
      if (!confirmed) return
      resetEditorToNewCampaignDraft()
      return
    }

    if (tabId === 'new-character') {
      resetEditorToNewCampaignDraft()
    }

    if (tabId === 'avatars') {
      setIsSelectingAvatarForCharacter(false)
    }

    setActiveTab(tabId)
  }

  async function handleSave(): Promise<void> {
    if (editorMode === 'edit-custom') {
      await onSaveReusableCharacter(toReusableCharacter(draft), selectedReusableCharacter?.relationshipBundle)
      setSavedDraftSnapshot(getCharacterDraftSnapshot(draft))
      setActiveTab('existing-characters')
      return
    }

    const nextDraft = {
      ...draft,
      name: draft.name.trim(),
      role: draft.role.trim(),
    }
    await onSaveCharacter(nextDraft)
    setDraft(nextDraft)
    setSavedDraftSnapshot(getCharacterDraftSnapshot(nextDraft))
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
      resetEditorToNewCampaignDraft()
      setActiveTab('existing-characters')
      return
    }

    await onDeleteCharacter(draft.id)
    setSelectedCampaignCharacterId(null)
    resetEditorToNewCampaignDraft()
    setActiveTab('existing-campaign-characters')
  }

  async function handleDeleteSelectedCampaignCharacter(): Promise<void> {
    if (!selectedCampaignCharacter) {
      return
    }

    const confirmed = await confirm({
      title: 'Delete Campaign Character',
      message: `Delete ${selectedCampaignCharacter.name || 'this character'} from this campaign?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) {
      return
    }

    await onDeleteCharacter(selectedCampaignCharacter.id)
    setSelectedCampaignCharacterId(null)
  }

  async function handleDeleteSelectedReusableCharacter(): Promise<void> {
    if (!selectedReusableCharacter) {
      return
    }

    const confirmed = await confirm({
      title: 'Delete Global Character',
      message: `Delete ${selectedReusableCharacter.name || 'this character'} from global characters?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) {
      return
    }

    await onDeleteReusableCharacter(selectedReusableCharacter.id)
    setSelectedReusableCharacterId(null)
  }

  function openCampaignCharacterEditor(character: CharacterProfile): void {
    setDraft(character)
    setSavedDraftSnapshot(getCharacterDraftSnapshot(character))
    setEditorSection('details')
    setEditorMode('edit-campaign')
  }

  function openReusableCharacterEditor(character: ReusableCharacter): void {
    const nextDraft = toCampaignCharacter(character)
    setDraft(nextDraft)
    setSavedDraftSnapshot(getCharacterDraftSnapshot(nextDraft))
    setEditorSection('details')
    setEditorMode('edit-custom')
  }

  const selectedCampaignCharacter =
    sortedCampaignCharacters.find((character) => character.id === selectedCampaignCharacterId) ?? null
  const selectedReusableCharacter =
    sortedReusableCharacters.find((character) => character.id === selectedReusableCharacterId) ?? null
  const isEditingCampaignCharacter = activeTab === 'existing-campaign-characters' && editorMode === 'edit-campaign'
  const isEditingReusableCharacter = activeTab === 'existing-characters' && editorMode === 'edit-custom'
  const isShowingEditor = activeTab === 'new-character' || isEditingCampaignCharacter || isEditingReusableCharacter
  const hasUnsavedChanges = isShowingEditor && getCharacterDraftSnapshot(draft) !== savedDraftSnapshot
  const isShowingAvatarEditor = activeTab === 'avatars' && avatarEditorMode !== 'browse'
  const hasUnsavedAvatarChanges = isShowingAvatarEditor && getAvatarDraftSnapshot(avatarDraft) !== savedAvatarDraftSnapshot
  const editorAvatarOffsetScale = CHARACTER_HEADER_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
  const editorAvatarStyle = draft.avatarImageData
    ? {
      backgroundImage: `url("${draft.avatarImageData}")`,
      backgroundPosition: `${draft.avatarCrop.x * editorAvatarOffsetScale}px ${draft.avatarCrop.y * editorAvatarOffsetScale}px`,
      backgroundSize: `${draft.avatarCrop.scale * 100}%`,
    }
    : undefined

  function resetEditorToNewCampaignDraft(): void {
    const nextDraft = createCampaignCharacterDraft()
    setEditorMode('new-campaign')
    setEditorSection('details')
    setDraft(nextDraft)
    setSavedDraftSnapshot(getCharacterDraftSnapshot(nextDraft))
  }

  async function confirmDiscardChanges(message: string): Promise<boolean> {
    if (!hasUnsavedChanges && !hasUnsavedAvatarChanges) {
      return true
    }

    return confirm({
      title: 'Discard Changes',
      message,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep Editing',
    })
  }

  async function handleRequestClose(): Promise<void> {
    const confirmed = await confirmDiscardChanges('You have unsaved changes. Discard them and close this window?')
    if (!confirmed) {
      return
    }

    onClose()
  }

  async function handleReturnToAvatarLibrary(): Promise<void> {
    const confirmed = await confirmDiscardChanges('You have unsaved changes. Discard them and return to the avatar library?')
    if (!confirmed) {
      return
    }

    setAvatarEditorMode('browse')
  }

  function openNewAvatarEditor(): void {
    setAvatarSection('user-avatars')
    setActiveTab('avatars')
    setAvatarEditorMode('create')
    setSelectedReusableAvatarId(null)
    const nextDraft = createEmptyAvatarDraft()
    setAvatarDraft(nextDraft)
    setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(nextDraft))
  }

  function openExistingAvatarEditor(avatar: ReusableAvatar): void {
    setAvatarSection('user-avatars')
    setActiveTab('avatars')
    setAvatarEditorMode('edit')
    setSelectedReusableAvatarId(avatar.id)
    setAvatarDraft(avatar)
    setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(avatar))
  }

  async function handleSaveAvatar(): Promise<void> {
    if (!avatarDraft.imageData) {
      return
    }

    if (avatarEditorMode === 'create') {
      const confirmed = await confirm({
        title: 'Create Avatar',
        message: 'Create this avatar? Its image will be flattened and cannot be edited after saving.',
        confirmLabel: 'Create Avatar',
        cancelLabel: 'Keep Editing',
      })
      if (!confirmed) {
        return
      }
    }

    const renderedAvatarImageData = avatarEditorMode === 'create'
      ? await renderAvatarThumbnail(avatarDraft.imageData, avatarDraft.crop)
      : avatarDraft.imageData
    const nextAvatar: ReusableAvatar = {
      ...avatarDraft,
      name: avatarDraft.name.trim(),
      imageData: renderedAvatarImageData,
      crop: { x: 0, y: 0, scale: 1 },
    }

    await onSaveReusableAvatar(nextAvatar)
    setAvatarDraft(nextAvatar)
    setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(nextAvatar))
    setAvatarEditorMode('browse')
  }

  async function handleDeleteSelectedAvatar(): Promise<void> {
    const selectedAvatar = sortedReusableAvatars.find((avatar) => avatar.id === selectedReusableAvatarId) ?? null
    if (!selectedAvatar) {
      return
    }

    const confirmed = await confirm({
      title: 'Delete Avatar',
      message: `Delete ${selectedAvatar.name || 'this avatar'} from user avatars?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) {
      return
    }

    await onDeleteReusableAvatar(selectedAvatar.id)
    setSelectedReusableAvatarId(null)
    setAvatarEditorMode('browse')
    const nextDraft = createEmptyAvatarDraft()
    setAvatarDraft(nextDraft)
    setSavedAvatarDraftSnapshot(getAvatarDraftSnapshot(nextDraft))
  }

  function applyAvatarToCurrentCharacter(avatar: ReusableAvatar): void {
    updateDraftField('avatarImageData', avatar.imageData)
    updateDraftField('avatarSourceId', avatar.id)
    updateDraftField('avatarCrop', avatar.crop)
    setIsSelectingAvatarForCharacter(false)
    setActiveTab(avatarReturnTab)
  }

  return (
    <>
      <Modal
        title={(
          <>
            <UsersRoundIcon className="modal__title-icon" aria-hidden="true" />
            <span>Characters</span>
          </>
        )}
        onClose={() => {
          void handleRequestClose()
        }}
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
                <UserPlusIcon className="characters-modal__tab-icon" aria-hidden="true" />
                <span>New Character</span>
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'existing-campaign-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('existing-campaign-characters')
                }}
              >
                <UsersIcon className="characters-modal__tab-icon" aria-hidden="true" />
                <span>Campaign Characters</span>
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'existing-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('existing-characters')
                }}
              >
                <WorldStarIcon className="characters-modal__tab-icon" aria-hidden="true" />
                <span>Global Characters</span>
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'app-characters' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('app-characters')
                }}
              >
                <UserIcon className="characters-modal__tab-icon" aria-hidden="true" />
                <span>App Characters</span>
              </button>
              <button
                type="button"
                className={`characters-modal__tab${activeTab === 'avatars' ? ' characters-modal__tab--active' : ''}`}
                onClick={() => {
                  handleTabClick('avatars')
                }}
              >
                <UserCircleIcon className="characters-modal__tab-icon" aria-hidden="true" />
                <span>Avatars</span>
              </button>
            </aside>
          )}
        panel={(
          <section className="characters-modal__panel">
              {activeTab === 'avatars' ? (
                avatarEditorMode !== 'browse' ? (
                  <div className="characters-modal__editor">
                    <div className="characters-modal__header">
                      <div>
                        <h2 className="characters-modal__heading">
                          {avatarEditorMode === 'edit' ? (avatarDraft.name || 'Edit Avatar') : 'New Avatar'}
                        </h2>
                        <p className="characters-modal__subheading">
                          {avatarEditorMode === 'edit'
                            ? 'Update this saved avatar and keep it available for future characters.'
                            : 'Create a reusable avatar for your character library.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="characters-modal__footer-btn"
                        onClick={() => {
                          void handleReturnToAvatarLibrary()
                        }}
                      >
                        Avatar Library
                      </button>
                    </div>
                    <div className="characters-modal__field">
                      {avatarEditorMode === 'edit' ? (
                        <div className="characters-modal__avatar-locked">
                          <div
                            className="characters-modal__avatar-locked-preview"
                            style={avatarDraft.imageData
                              ? { backgroundImage: `url("${avatarDraft.imageData}")` }
                              : undefined}
                          >
                            {avatarDraft.imageData ? null : 'AV'}
                          </div>
                          <p className="characters-modal__subheading">
                            Saved avatars are flattened to a smaller image. You can rename this avatar, but changing the image requires creating a new avatar.
                          </p>
                        </div>
                      ) : (
                        <AvatarCropEditor
                          imageData={avatarDraft.imageData}
                          crop={avatarDraft.crop}
                          onImageDataChange={(imageData) => updateAvatarDraftField('imageData', imageData)}
                          onCropChange={(crop) => updateAvatarDraftField('crop', crop)}
                          helpText="Drag the image inside the circle to frame the avatar. This saved version will be flattened and won't be editable later."
                          uploadLabel="Select Image"
                          emptyMessage="Upload an image to start building a reusable avatar."
                          controlsHeader={(
                            <div className="characters-modal__field">
                              <label className="characters-modal__label" htmlFor="avatar-name">Avatar Name</label>
                              <input
                                id="avatar-name"
                                className="characters-modal__input"
                                type="text"
                                value={avatarDraft.name}
                                onChange={(event) => updateAvatarDraftField('name', event.target.value)}
                                placeholder="Captain portrait"
                              />
                            </div>
                          )}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="characters-modal__library">
                    <div className="characters-modal__header">
                      <div className="characters-modal__field">
                        <h2 className="characters-modal__heading">Avatars</h2>
                        <p className="characters-modal__subheading">Manage reusable avatars and apply them to characters from one place.</p>
                      </div>
                      <button
                        type="button"
                        className="characters-modal__footer-btn"
                        onClick={() => {
                          openNewAvatarEditor()
                        }}
                      >
                        New Avatar
                      </button>
                    </div>
                    <div className="characters-modal__segment" role="tablist" aria-label="Avatar sections">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={avatarSection === 'user-avatars'}
                        className={`characters-modal__segment-btn${avatarSection === 'user-avatars' ? ' characters-modal__segment-btn--active' : ''}`}
                        onClick={() => {
                          setAvatarSection('user-avatars')
                        }}
                      >
                        User Avatars
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={avatarSection === 'application-avatars'}
                        className={`characters-modal__segment-btn${avatarSection === 'application-avatars' ? ' characters-modal__segment-btn--active' : ''}`}
                        onClick={() => {
                          setAvatarSection('application-avatars')
                        }}
                      >
                        Application Avatars
                      </button>
                    </div>
                    {avatarSection === 'application-avatars' ? (
                      <div className="characters-modal__blank">Application avatars are not available yet.</div>
                    ) : reusableAvatars.length === 0 ? (
                      <div className="characters-modal__blank">No saved avatars yet.</div>
                    ) : (
                      <div className="characters-modal__gallery" role="list" aria-label="Reusable avatars">
                        {sortedReusableAvatars.map((avatar) => {
                          const avatarOffsetScale = CHARACTER_LIBRARY_GALLERY_AVATAR_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                          const avatarStyle = {
                            backgroundImage: `url("${avatar.imageData}")`,
                            backgroundPosition: `${avatar.crop.x * avatarOffsetScale}px ${avatar.crop.y * avatarOffsetScale}px`,
                            backgroundSize: `${avatar.crop.scale * 100}%`,
                          }

                          return (
                            <button
                              key={avatar.id}
                              type="button"
                              role="listitem"
                              className={`characters-modal__gallery-item${selectedReusableAvatarId === avatar.id ? ' characters-modal__gallery-item--active' : ''}`}
                              onClick={() => {
                                setSelectedReusableAvatarId(avatar.id)
                              }}
                              onDoubleClick={() => {
                                openExistingAvatarEditor(avatar)
                              }}
                            >
                              <div className="characters-modal__gallery-avatar characters-modal__gallery-avatar--image" style={avatarStyle} />
                              <span className="characters-modal__gallery-name">{avatar.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              ) : activeTab === 'app-characters' ? (
                <div className="characters-modal__blank">App characters are not available yet.</div>
              ) : activeTab === 'existing-campaign-characters' && !isEditingCampaignCharacter ? (
                <div className="characters-modal__library">
                  <div>
                    <h2 className="characters-modal__heading">Campaign Characters</h2>
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
                            onDoubleClick={() => {
                              setSelectedCampaignCharacterId(character.id)
                              onSelectCharacter(character.id)
                              openCampaignCharacterEditor(character)
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
                    <h2 className="characters-modal__heading">Global Characters</h2>
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
                            onDoubleClick={() => {
                              setSelectedReusableCharacterId(character.id)
                              openReusableCharacterEditor(character)
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
                        setIsSelectingAvatarForCharacter(true)
                        setAvatarReturnTab(activeTab === 'avatars' ? 'new-character' : activeTab as AvatarReturnTab)
                        setActiveTab('avatars')
                        setAvatarSection('user-avatars')
                      }}
                    >
                      {editorAvatarStyle ? null : <span>{draft.name.trim().slice(0, 2).toUpperCase() || 'AV'}</span>}
                    </button>
                    <div className="characters-modal__identity-copy">
                      <label className="characters-modal__label" htmlFor="character-name">Character Name</label>
                      <input id="character-name" className="characters-modal__input" type="text" value={draft.name} onChange={(event) => updateDraftField('name', event.target.value)} placeholder="Character name" />
                      <p className="characters-modal__subheading">
                        Click the avatar to choose or create one from your avatar library.
                      </p>
                    </div>
                  </div>
                  <div className="characters-modal__segment" role="tablist" aria-label="Character editor sections">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editorSection === 'details'}
                      className={`characters-modal__segment-btn${editorSection === 'details' ? ' characters-modal__segment-btn--active' : ''}`}
                      onClick={() => {
                        setEditorSection('details')
                      }}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editorSection === 'relationships'}
                      className={`characters-modal__segment-btn${editorSection === 'relationships' ? ' characters-modal__segment-btn--active' : ''}`}
                      onClick={() => {
                        setEditorSection('relationships')
                      }}
                    >
                      Relationships
                    </button>
                  </div>
                  {editorSection === 'details' ? (
                    <>
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
                    </>
                  ) : (
                    <CharacterRelationshipsPanel
                      graph={relationshipGraph}
                      draft={draft}
                      characters={characters}
                      onSave={onSaveRelationships}
                      onDeletePair={onDeleteRelationshipPair}
                    />
                  )}
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
                  <button
                    type="button"
                    className="modal-footer__button"
                    onClick={() => {
                      void handleRequestClose()
                    }}
                  >
                    Close
                  </button>
                  {activeTab === 'existing-campaign-characters' && !isEditingCampaignCharacter ? (
                    <>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedCampaignCharacter || isBusy || isCharacterLibraryBusy}
                        onClick={() => {
                          void handleDeleteSelectedCampaignCharacter()
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedCampaignCharacter || isCharacterLibraryBusy}
                        onClick={() => {
                          if (selectedCampaignCharacter) {
                            promptSaveReusableCharacter(selectedCampaignCharacter)
                          }
                        }}
                      >
                        Save To Global Characters
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button modal-footer__button--primary"
                        disabled={!selectedCampaignCharacter}
                        onClick={() => {
                          if (selectedCampaignCharacter) {
                            openCampaignCharacterEditor(selectedCampaignCharacter)
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
                          void handleDeleteSelectedReusableCharacter()
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
                            openReusableCharacterEditor(selectedReusableCharacter)
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
                  {activeTab === 'avatars' && avatarEditorMode !== 'browse' ? (
                    <button
                      type="button"
                      className="modal-footer__button modal-footer__button--primary"
                      onClick={() => {
                        void handleSaveAvatar()
                      }}
                      disabled={!avatarDraft.name.trim() || !avatarDraft.imageData || isAvatarLibraryBusy}
                    >
                      {isAvatarLibraryBusy ? 'Saving...' : (avatarEditorMode === 'edit' ? 'Save Avatar' : 'Create Avatar')}
                    </button>
                  ) : null}
                  {activeTab === 'avatars' && avatarEditorMode === 'browse' && avatarSection === 'user-avatars' && isSelectingAvatarForCharacter ? (
                    <button
                      type="button"
                      className="modal-footer__button modal-footer__button--primary"
                      disabled={!selectedReusableAvatarId}
                      onClick={() => {
                        const selectedAvatar = sortedReusableAvatars.find((avatar) => avatar.id === selectedReusableAvatarId) ?? null
                        if (selectedAvatar) {
                          applyAvatarToCurrentCharacter(selectedAvatar)
                        }
                      }}
                    >
                      Use for Character
                    </button>
                  ) : null}
                  {activeTab === 'avatars' && avatarEditorMode === 'browse' && avatarSection === 'user-avatars' ? (
                    <>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedReusableAvatarId || isAvatarLibraryBusy}
                        onClick={() => {
                          void handleDeleteSelectedAvatar()
                        }}
                      >
                        Delete Avatar
                      </button>
                      <button
                        type="button"
                        className="modal-footer__button"
                        disabled={!selectedReusableAvatarId || isAvatarLibraryBusy}
                        onClick={() => {
                          const selectedAvatar = sortedReusableAvatars.find((avatar) => avatar.id === selectedReusableAvatarId) ?? null
                          if (selectedAvatar) {
                            openExistingAvatarEditor(selectedAvatar)
                          }
                        }}
                      >
                        Edit Avatar
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
                            promptSaveReusableCharacter(draft)
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
      {confirmState ? <ConfirmModal {...confirmState} /> : null}
      {saveReusableConfirmation ? (
        <SaveReusableCharacterConfirmModal
          characterName={saveReusableConfirmation.character.name}
          relationshipCount={saveReusableConfirmation.relationshipBundle?.entries.length ?? 0}
          relatedCharacterCount={saveReusableConfirmation.relationshipBundle?.characters.length ?? 1}
          copyRelationships={copyRelationshipsOnSave}
          onToggleCopyRelationships={setCopyRelationshipsOnSave}
          onConfirm={() => { void handleConfirmSaveReusableCharacter() }}
          onCancel={() => { setSaveReusableConfirmation(null) }}
        />
      ) : null}
    </>
  )
}
