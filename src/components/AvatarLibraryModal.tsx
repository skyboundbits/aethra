/**
 * src/components/AvatarLibraryModal.tsx
 * Global avatar library modal for creating, saving, reusing, and deleting avatars across campaigns.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import { AvatarCropEditor } from './AvatarCropEditor'
import '../styles/avatar-library.css'

import type { ReusableAvatar } from '../types'

type AvatarLibraryTabId = 'new-avatar' | 'custom-avatars' | 'app-avatars'
type AvatarEditorMode = 'create' | 'edit'
const CHARACTER_EDITOR_AVATAR_SIZE = 220
const AVATAR_LIBRARY_GALLERY_PREVIEW_SIZE = 112

interface AvatarLibraryDraft {
  id: string
  name: string
  imageData: string | null
  crop: ReusableAvatar['crop']
  createdAt: number
  updatedAt: number
}

/** Props accepted by the AvatarLibraryModal component. */
interface AvatarLibraryModalProps {
  /** Saved reusable avatars. */
  avatars: ReusableAvatar[]
  /** Optional status text shown above the editor. */
  statusMessage: string | null
  /** Visual state of the status message. */
  statusKind: 'error' | 'success' | null
  /** True while a save or delete operation is in progress. */
  isBusy: boolean
  /** Close handler for the modal. */
  onClose: () => void
  /** Called when an avatar should be applied to the current character. */
  onApplyAvatar: (avatar: ReusableAvatar) => void
  /** Called when a draft avatar should be saved. */
  onSaveAvatar: (avatar: ReusableAvatar) => Promise<void>
  /** Called when a saved avatar should be deleted. */
  onDeleteAvatar: (avatarId: string) => Promise<void>
}

function createEmptyAvatarDraft(): AvatarLibraryDraft {
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

/**
 * AvatarLibraryModal
 * Two-column modal for managing a globally reusable avatar library.
 */
export function AvatarLibraryModal({
  avatars,
  statusMessage,
  statusKind,
  isBusy,
  onClose,
  onApplyAvatar,
  onSaveAvatar,
  onDeleteAvatar,
}: AvatarLibraryModalProps) {
  const [activeTab, setActiveTab] = useState<AvatarLibraryTabId>('new-avatar')
  const [editorMode, setEditorMode] = useState<AvatarEditorMode>('create')
  const [activeAvatarId, setActiveAvatarId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AvatarLibraryDraft>(createEmptyAvatarDraft())

  const customAvatars = useMemo(
    () => [...avatars].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [avatars],
  )

  useEffect(() => {
    if (activeTab === 'new-avatar') {
      if (editorMode === 'edit') {
        const editingAvatar = customAvatars.find((avatar) => avatar.id === activeAvatarId) ?? null
        if (editingAvatar) {
          setDraft(editingAvatar)
          return
        }
      }

      setEditorMode('create')
      setActiveAvatarId(null)
      setDraft(createEmptyAvatarDraft())
      return
    }

    if (activeTab !== 'custom-avatars') {
      return
    }

    const activeAvatar = customAvatars.find((avatar) => avatar.id === activeAvatarId) ?? null
    if (activeAvatar) {
      setDraft(activeAvatar)
      return
    }

    setActiveAvatarId(customAvatars[0]?.id ?? null)
  }, [activeAvatarId, activeTab, customAvatars])

  function updateDraftField<K extends keyof AvatarLibraryDraft>(field: K, value: AvatarLibraryDraft[K]): void {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  async function handleSave(): Promise<void> {
    if (!draft.imageData) {
      return
    }

    await onSaveAvatar({
      ...draft,
      name: draft.name.trim(),
    } as ReusableAvatar)
    setEditorMode('edit')
    setActiveTab('custom-avatars')
  }

  const selectedCustomAvatar = customAvatars.find((avatar) => avatar.id === activeAvatarId) ?? null
  const canApply = activeTab === 'new-avatar'
    ? Boolean(draft.imageData)
    : activeTab === 'custom-avatars'
      ? Boolean(selectedCustomAvatar)
      : false
  const canDelete = activeTab === 'custom-avatars' && Boolean(selectedCustomAvatar)
  const canSave = activeTab === 'new-avatar' && Boolean(draft.imageData)
  const canEdit = activeTab === 'custom-avatars' && Boolean(selectedCustomAvatar)

  return (
    <Modal title="Avatar Library" onClose={onClose} variant="workspace">
      <ModalWorkspaceLayout
        nav={(
          <aside className="avatar-library__nav" aria-label="Avatar library sections">
            <button
              type="button"
              className={`avatar-library__tab${activeTab === 'new-avatar' ? ' avatar-library__tab--active' : ''}`}
              onClick={() => {
                setEditorMode('create')
                setActiveTab('new-avatar')
              }}
            >
              New Avatar
            </button>
            <button
              type="button"
              className={`avatar-library__tab${activeTab === 'custom-avatars' ? ' avatar-library__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('custom-avatars')
              }}
            >
              Custom Avatars
            </button>
            <button
              type="button"
              className={`avatar-library__tab${activeTab === 'app-avatars' ? ' avatar-library__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('app-avatars')
              }}
            >
              App Avatars
            </button>

          </aside>
        )}
        panel={(
          <section className="avatar-library__panel">
            {activeTab === 'app-avatars' ? (
              <div className="avatar-library__blank">
                App avatars are not available yet.
              </div>
            ) : activeTab === 'custom-avatars' ? (
              <div className="avatar-library__editor">
                <div>
                  <h2 className="avatar-library__heading">Custom Avatars</h2>
                  <p className="avatar-library__subheading">
                    Your saved avatars, shown alphabetically for quick reuse.
                  </p>
                </div>

                {customAvatars.length === 0 ? (
                  <div className="avatar-library__blank">
                    No custom avatars saved yet.
                  </div>
                ) : (
                  <div className="avatar-library__gallery" role="list" aria-label="Custom avatars">
                    {customAvatars.map((avatar) => (
                      (() => {
                        const avatarOffsetScale = AVATAR_LIBRARY_GALLERY_PREVIEW_SIZE / CHARACTER_EDITOR_AVATAR_SIZE
                        return (
                      <button
                        key={avatar.id}
                        type="button"
                        role="listitem"
                        className={`avatar-library__gallery-item${activeAvatarId === avatar.id ? ' avatar-library__gallery-item--active' : ''}`}
                        onClick={() => {
                          setActiveAvatarId(avatar.id)
                        }}
                      >
                        <div
                          className="avatar-library__gallery-preview"
                          style={{
                            backgroundImage: `url("${avatar.imageData}")`,
                            backgroundPosition: `${avatar.crop.x * avatarOffsetScale}px ${avatar.crop.y * avatarOffsetScale}px`,
                            backgroundSize: `${avatar.crop.scale * 100}%`,
                          }}
                        />
                        <span className="avatar-library__gallery-name">{avatar.name}</span>
                      </button>
                        )
                      })()
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="avatar-library__editor">
                <div>
                  <h2 className="avatar-library__heading">
                    {editorMode === 'edit' ? (draft.name || 'Edit Avatar') : 'Create Avatar'}
                  </h2>
                  <p className="avatar-library__subheading">
                    {editorMode === 'edit'
                      ? 'Update a saved avatar, then save the changes back into your global library.'
                      : 'Build a reusable avatar and save it to your global library.'}
                  </p>
                </div>

                <div className="avatar-library__field">
                  <label className="avatar-library__label" htmlFor="avatar-library-name">
                    Avatar Name
                  </label>
                  <input
                    id="avatar-library-name"
                    className="avatar-library__input"
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraftField('name', event.target.value)}
                    placeholder="Captain portrait"
                  />
                </div>

                <div className="avatar-library__field">
                  <label className="avatar-library__label">Avatar</label>
                  <AvatarCropEditor
                    imageData={draft.imageData}
                    crop={draft.crop}
                    onImageDataChange={(imageData) => updateDraftField('imageData', imageData)}
                    onCropChange={(crop) => updateDraftField('crop', crop)}
                    helpText="Save a cropped avatar once, then reuse it for any future character in any campaign."
                  />
                </div>
              </div>
            )}
          </section>
        )}
        footer={(
          <ModalFooter
            status={statusMessage ? (
              <div className={`avatar-library__status avatar-library__status--${statusKind ?? 'success'}`}>
                {statusMessage}
              </div>
            ) : undefined}
            actions={(
              <>
                <button type="button" className="modal-footer__button" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="modal-footer__button"
                  onClick={() => {
                    if (activeTab === 'new-avatar' && draft.imageData) {
                      onApplyAvatar(draft as ReusableAvatar)
                    }
                    if (activeTab === 'custom-avatars' && selectedCustomAvatar) {
                      onApplyAvatar(selectedCustomAvatar)
                    }
                  }}
                  disabled={!canApply}
                >
                  Use For Character
                </button>
                <button
                  type="button"
                  className="modal-footer__button"
                  onClick={() => {
                    if (selectedCustomAvatar) {
                      setDraft(selectedCustomAvatar)
                      setEditorMode('edit')
                      setActiveTab('new-avatar')
                    }
                  }}
                  disabled={!canEdit || isBusy}
                >
                  Edit Avatar
                </button>
                <button
                  type="button"
                  className="modal-footer__button"
                  onClick={() => {
                    if (selectedCustomAvatar) {
                      void onDeleteAvatar(selectedCustomAvatar.id)
                    }
                  }}
                  disabled={!canDelete || isBusy}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="modal-footer__button modal-footer__button--primary"
                  onClick={() => {
                    void handleSave()
                  }}
                  disabled={!canSave || isBusy}
                >
                  {isBusy ? 'Saving...' : (editorMode === 'edit' ? 'Save Changes' : 'Save Avatar')}
                </button>
              </>
            )}
          />
        )}
      />
    </Modal>
  )
}
