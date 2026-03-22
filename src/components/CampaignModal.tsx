/**
 * src/components/CampaignModal.tsx
 * Modal dialog for editing the active campaign and switching campaigns.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalWorkspaceLayout } from './ModalLayouts'
import '../styles/campaign-modal.css'
import type { Campaign, CampaignSummary } from '../types'

type CampaignModalTabId = 'current-campaign' | 'open-campaign'

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
  /** Called when the user wants to open a campaign via native file picker. */
  onOpenFromFile: () => void
  /** Called when the user opens a recent campaign. */
  onOpenRecent: (path: string) => void
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
  onOpenFromFile,
  onOpenRecent,
}: CampaignModalProps) {
  const [activeTab, setActiveTab] = useState<CampaignModalTabId>('current-campaign')
  const [name, setName] = useState(campaign?.name ?? '')
  const [description, setDescription] = useState(campaign?.description ?? '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setName(campaign?.name ?? '')
    setDescription(campaign?.description ?? '')
    setErrorMessage(null)
  }, [campaign])

  const recentOptions = useMemo(
    () => recentCampaigns.filter((entry) => entry.path !== campaignPath),
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
  }

  return (
    <Modal title="Campaign" onClose={onClose} variant="workspace" className="modal--campaign">
      <ModalWorkspaceLayout
        nav={(
          <div className="campaign-modal__nav" aria-label="Campaign sections">
            <CampaignModalTab
              id="current-campaign"
              label="Current Campaign"
              description="Edit the active campaign details."
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
            <CampaignModalTab
              id="open-campaign"
              label="Open Campaign"
              description="Create a new campaign or switch to a recent one."
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
          </div>
        )}
        panel={(
          <div className="campaign-modal__panel">
            {activeTab === 'current-campaign' ? (
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

                    <div className="campaign-modal__actions">
                      <button
                        type="submit"
                        className="campaign-modal__button campaign-modal__button--primary"
                        disabled={isBusy}
                      >
                        {isBusy ? 'Saving...' : 'Save Current Campaign'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="campaign-modal__empty-panel">
                    Open or create a campaign to start chatting and manage campaign metadata.
                  </p>
                )}
              </section>
            ) : (
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
                    className="campaign-modal__button campaign-modal__button--primary"
                    onClick={onCreateCampaign}
                    disabled={isBusy}
                  >
                    New Campaign
                  </button>
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
                    <span className="campaign-modal__recent-count">{recentOptions.length}</span>
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
                            {entry.sessionCount}{' '}
                            {entry.sessionCount === 1 ? 'session' : 'sessions'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
        footer={(
          <ModalFooter
            status={
              statusMessage ? (
                <p className="campaign-modal__status" role="status">
                  {statusMessage}
                </p>
              ) : undefined
            }
            actions={<button type="button" className="modal-footer__button" onClick={onClose}>Close</button>}
          />
        )}
      />
    </Modal>
  )
}

interface CampaignModalTabProps {
  /** Stable tab identifier. */
  id: CampaignModalTabId
  /** Primary label shown in the left navigation. */
  label: string
  /** Supporting description shown below the label. */
  description: string
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
      <span className="campaign-modal__nav-label">{label}</span>
      <span className="campaign-modal__nav-description">{description}</span>
    </button>
  )
}
