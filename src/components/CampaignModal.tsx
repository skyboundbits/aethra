/**
 * src/components/CampaignModal.tsx
 * Modal dialog for editing the active campaign and switching campaigns.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import { ConfirmModal } from './ConfirmModal'
import { SwordsIcon, ChessQueenIcon, ChessKingIcon, ChessRookIcon } from './icons'
import '../styles/campaign-modal.css'
import type { Campaign, CampaignSummary } from '../types'

type CampaignModalTabId = 'current-campaign' | 'open-campaign' | 'new-campaign'

/** Props accepted by the CampaignModal component. */
interface CampaignModalProps {
  /** Active campaign loaded in the workspace. */
  campaign: Campaign | null
  /** Absolute path of the active campaign folder. */
  campaignPath: string | null
  /** Recently stored campaigns shown in the quick-open list. */
  recentCampaigns: CampaignSummary[]
  /** True while a campaign file action is in progress. */
  isBusy: boolean
  /** Optional status or error message shown in the modal. */
  statusMessage: string | null
  /** Called when the user closes the modal. */
  onClose: () => void
  /** Called when the user saves metadata for the active campaign. */
  onSaveCurrent: (name: string, description: string) => void
  /** Called when the user wants to create a new campaign. */
  onCreateCampaign: () => void
  /** Called when creating a new campaign with name and description. */
  onCreateCampaignWithDetails: (name: string, description: string) => Promise<void>
  /** Called when the user wants to open a campaign via native file picker. */
  onOpenFromFile: () => void
  /** Called when the user opens a recent campaign. */
  onOpenRecent: (path: string) => void
  /** Called to refresh the campaigns list. */
  onRefreshCampaigns: () => Promise<void>
}

/**
 * CampaignModal
 * Central campaign management surface for editing, opening, and creating campaigns.
 */
export function CampaignModal({
  campaign,
  campaignPath,
  recentCampaigns,
  isBusy,
  statusMessage,
  onClose,
  onSaveCurrent,
  onCreateCampaign,
  onCreateCampaignWithDetails,
  onOpenFromFile,
  onOpenRecent,
  onRefreshCampaigns,
}: CampaignModalProps) {
  const [activeTab, setActiveTab] = useState<CampaignModalTabId>('current-campaign')
  const [name, setName] = useState(campaign?.name ?? '')
  const [description, setDescription] = useState(campaign?.description ?? '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newErrorMessage, setNewErrorMessage] = useState<string | null>(null)
  const [showNewCampaignConfirm, setShowNewCampaignConfirm] = useState(false)

  useEffect(() => {
    setName(campaign?.name ?? '')
    setDescription(campaign?.description ?? '')
    setErrorMessage(null)
  }, [campaign])

  /**
   * Refresh campaigns list when opening the modal or switching to open campaign tab.
   */
  useEffect(() => {
    if (activeTab === 'open-campaign') {
      void onRefreshCampaigns()
    }
  }, [activeTab, onRefreshCampaigns])

  const recentOptions = useMemo(
    () =>
      recentCampaigns
        .filter((entry) => entry.path !== campaignPath)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [campaignPath, recentCampaigns],
  )

  /**
   * Validate the current campaign form and submit it.
   *
   * @param event - Form submission event.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName) {
      setErrorMessage('Campaign name is required.')
      return
    }

    setErrorMessage(null)
    onSaveCurrent(trimmedName, trimmedDescription)
    setSaveSuccessMessage('Campaign saved')
    const timeout = setTimeout(() => setSaveSuccessMessage(null), 3000)
    return () => clearTimeout(timeout)
  }

  /**
   * Handle the save button click from the footer.
   */
  function handleSaveClick(): void {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName) {
      setErrorMessage('Campaign name is required.')
      return
    }

    setErrorMessage(null)
    onSaveCurrent(trimmedName, trimmedDescription)
    setSaveSuccessMessage('Campaign saved')
    const timeout = setTimeout(() => setSaveSuccessMessage(null), 3000)
  }

  /**
   * Validate and show confirmation dialog for creating a new campaign.
   */
  function handleCreateCampaignClick(): void {
    const trimmedName = newName.trim()

    if (!trimmedName) {
      setNewErrorMessage('Campaign name is required.')
      return
    }

    setNewErrorMessage(null)
    setShowNewCampaignConfirm(true)
  }

  /**
   * Create campaign and switch to it.
   */
  async function handleCreateAndSwitch(): Promise<void> {
    setShowNewCampaignConfirm(false)
    const name = newName.trim()
    const description = newDescription.trim()
    setNewName('')
    setNewDescription('')
    if (onCreateCampaignWithDetails) {
      await onCreateCampaignWithDetails(name, description)
      // Switch to current campaign tab to see the newly created campaign
      setTimeout(() => setActiveTab('current-campaign'), 100)
    }
  }

  /**
   * Create campaign and stay on new campaign tab.
   */
  async function handleCreateAndStay(): Promise<void> {
    setShowNewCampaignConfirm(false)
    const name = newName.trim()
    const description = newDescription.trim()
    setNewName('')
    setNewDescription('')
    if (onCreateCampaignWithDetails) {
      await onCreateCampaignWithDetails(name, description)
    }
  }

  /**
   * Validate the new campaign form and submit it.
   *
   * @param event - Form submission event.
   */
  function handleNewCampaignSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const trimmedName = newName.trim()

    if (!trimmedName) {
      setNewErrorMessage('Campaign name is required.')
      return
    }

    setNewErrorMessage(null)
    setNewName('')
    setNewDescription('')
    onCreateCampaign()
  }

  return (
    <>
      <Modal title={(
        <>
          <SwordsIcon className="modal__title-icon" />
          Campaign
        </>
      )} onClose={onClose} variant="workspace" className="modal--campaign">
      <ModalWorkspaceLayout
        nav={(
          <div className="campaign-modal__nav" aria-label="Campaign sections">
            <CampaignModalTab
              id="current-campaign"
              label={(
                <>
                  <span className="campaign-modal__nav-icon">
                    <ChessQueenIcon />
                  </span>
                  <span className="campaign-modal__nav-label">Current Campaign</span>
                </>
              )}
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
            <CampaignModalTab
              id="open-campaign"
              label={(
                <>
                  <span className="campaign-modal__nav-icon">
                    <ChessKingIcon />
                  </span>
                  <span className="campaign-modal__nav-label">Open Campaign</span>
                </>
              )}
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
            <CampaignModalTab
              id="new-campaign"
              label={(
                <>
                  <span className="campaign-modal__nav-icon">
                    <ChessRookIcon />
                  </span>
                  <span className="campaign-modal__nav-label">New Campaign</span>
                </>
              )}
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
          </div>
        )}
        panel={(
          <div className="campaign-modal__panel">
            {activeTab === 'current-campaign' && (
              <section className="campaign-modal__section">
                <div className="campaign-modal__section-header">
                  <div>
                    <p className="campaign-modal__eyebrow">Current Campaign</p>
                    <h2 className="campaign-modal__section-title">
                      {campaign?.name ?? 'No campaign loaded'}
                    </h2>
                  </div>
                </div>

                {campaign ? (
                  <form className="campaign-modal__form" onSubmit={handleSubmit}>
                    <label className="campaign-modal__field" htmlFor="campaign-modal-name">
                      <span className="campaign-modal__label">Name</span>
                      <input
                        id="campaign-modal-name"
                        className="campaign-modal__input"
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={isBusy}
                      />
                    </label>

                    <label className="campaign-modal__field" htmlFor="campaign-modal-description">
                      <span className="campaign-modal__label">Description</span>
                      <textarea
                        id="campaign-modal-description"
                        className="campaign-modal__textarea"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={5}
                        disabled={isBusy}
                      />
                    </label>

                    {errorMessage ? (
                      <p className="campaign-modal__error" role="alert">
                        {errorMessage}
                      </p>
                    ) : null}
                  </form>
                ) : (
                  <p className="campaign-modal__empty-panel">
                    Open or create a campaign to start chatting and manage campaign metadata.
                  </p>
                )}
              </section>
            )}
            {activeTab === 'open-campaign' && (
              <section className="campaign-modal__section">
                <div className="campaign-modal__section-header">
                  <div>
                    <p className="campaign-modal__eyebrow">Open Campaign</p>
                    <h2 className="campaign-modal__section-title">Switch campaigns</h2>
                  </div>
                </div>

                <div className="campaign-modal__actions">
                  <button
                    type="button"
                    className="campaign-modal__button"
                    onClick={onOpenFromFile}
                    disabled={isBusy}
                  >
                    Open From File
                  </button>
                </div>

                <div className="campaign-modal__recent">
                  <div className="campaign-modal__recent-header">
                    <h3 className="campaign-modal__recent-title">Recent Campaigns</h3>
                  </div>

                  {recentOptions.length === 0 ? (
                    <p className="campaign-modal__empty">
                      No other recent campaigns are available yet.
                    </p>
                  ) : (
                    <div className="campaign-modal__list" role="list" aria-label="Recent campaigns">
                      {recentOptions.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          role="listitem"
                          className="campaign-modal__recent-item"
                          onClick={() => onOpenRecent(entry.path)}
                          disabled={isBusy}
                        >
                          <span className="campaign-modal__recent-name">{entry.name}</span>
                          <span className="campaign-modal__recent-description">
                            {entry.description || 'No description yet.'}
                          </span>
                          <span className="campaign-modal__recent-meta">
                            {entry.sceneCount}{' '}
                            {entry.sceneCount === 1 ? 'scene' : 'scenes'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {activeTab === 'new-campaign' && (
              <section className="campaign-modal__section">
                <div className="campaign-modal__section-header">
                  <div>
                    <p className="campaign-modal__eyebrow">New Campaign</p>
                    <h2 className="campaign-modal__section-title">Create a new campaign</h2>
                  </div>
                </div>

                <form className="campaign-modal__form" onSubmit={handleNewCampaignSubmit}>
                  <label className="campaign-modal__field" htmlFor="new-campaign-name">
                    <span className="campaign-modal__label">Name</span>
                    <input
                      id="new-campaign-name"
                      className="campaign-modal__input"
                      type="text"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      placeholder="The Ember Court"
                      autoFocus
                      disabled={isBusy}
                    />
                  </label>

                  <label className="campaign-modal__field" htmlFor="new-campaign-description">
                    <span className="campaign-modal__label">Description</span>
                    <textarea
                      id="new-campaign-description"
                      className="campaign-modal__textarea"
                      value={newDescription}
                      onChange={(event) => setNewDescription(event.target.value)}
                      placeholder="Political intrigue in a decaying imperial capital."
                      rows={5}
                      disabled={isBusy}
                    />
                  </label>

                  {newErrorMessage ? (
                    <p className="campaign-modal__error" role="alert">
                      {newErrorMessage}
                    </p>
                  ) : null}
                </form>
              </section>
            )}
          </div>
        )}
        footer={(
          <ModalFooter
            status={
              saveSuccessMessage ? (
                <p className="campaign-modal__status campaign-modal__status--success" role="status">
                  {saveSuccessMessage}
                </p>
              ) : statusMessage ? (
                <p className="campaign-modal__status" role="status">
                  {statusMessage}
                </p>
              ) : undefined
            }
            actions={(
              <>
                <button type="button" className="modal-footer__button" onClick={onClose}>Close</button>
                {activeTab === 'current-campaign' && campaign ? (
                  <button
                    type="button"
                    className="modal-footer__button modal-footer__button--primary"
                    onClick={handleSaveClick}
                    disabled={isBusy}
                  >
                    {isBusy ? 'Saving...' : 'Save Campaign'}
                  </button>
                ) : null}
                {activeTab === 'new-campaign' ? (
                  <button
                    type="button"
                    className="modal-footer__button modal-footer__button--primary"
                    onClick={handleCreateCampaignClick}
                    disabled={isBusy}
                  >
                    {isBusy ? 'Creating...' : 'Create Campaign'}
                  </button>
                ) : null}
              </>
            )}
          />
        )}
      />
      </Modal>
      {showNewCampaignConfirm && (
        <ConfirmModal
          title="New Campaign Created"
          message={`Campaign "${newName}" has been created. Do you want to switch to this campaign or remain on this tab?`}
          confirmLabel="Switch to New Campaign"
          cancelLabel="Stay Here"
          onConfirm={handleCreateAndSwitch}
          onCancel={handleCreateAndStay}
        />
      )}
    </>
  )
}

interface CampaignModalTabProps {
  /** Stable tab identifier. */
  id: CampaignModalTabId
  /** Primary label shown in the left navigation. */
  label: React.ReactNode
  /** Supporting description shown below the label. */
  description?: string
  /** Currently active tab identifier. */
  activeTab: CampaignModalTabId
  /** Called when the tab is selected. */
  onSelect: (tabId: CampaignModalTabId) => void
}

/**
 * CampaignModalTab
 * Vertical navigation item used by the campaign modal.
 */
function CampaignModalTab({
  id,
  label,
  description,
  activeTab,
  onSelect,
}: CampaignModalTabProps) {
  /**
   * Select this campaign modal tab.
   */
  function handleClick(): void {
    onSelect(id)
  }

  return (
    <button
      type="button"
      className={`campaign-modal__nav-item${activeTab === id ? ' campaign-modal__nav-item--active' : ''}`}
      onClick={handleClick}
    >
      <span className="campaign-modal__nav-label-row">
        {typeof label === 'string' ? <span className="campaign-modal__nav-label">{label}</span> : label}
      </span>
      {description && <span className="campaign-modal__nav-description">{description}</span>}
    </button>
  )
}
