/**
 * src/components/CampaignLauncher.tsx
 * Startup screen shown until the user creates or opens a stored campaign.
 */

import '../styles/campaign-launcher.css'
import type { CampaignSummary } from '../types'

/** Props describing the staged launcher loading UI. */
interface CampaignLauncherLoadingState {
  /** Headline shown above the staged loading details. */
  title: string
  /** Human-readable detail for the current phase. */
  detail: string
  /** Approximate completion percentage for the progress bar. */
  percent: number | null
}

/** Props accepted by the CampaignLauncher component. */
interface CampaignLauncherProps {
  /** Stored campaigns available to open from the launcher. */
  campaigns: CampaignSummary[]
  /** True while a campaign file operation is in progress. */
  isBusy: boolean
  /** Optional staged loading state shown instead of the default launcher UI. */
  loadingState?: CampaignLauncherLoadingState | null
  /** Optional status or error message shown under the action buttons. */
  statusMessage: string | null
  /** Called when the user wants to create a new campaign. */
  onCreateCampaign: () => void
  /** Called when the user wants to pick a campaign file from disk. */
  onOpenFromFile: () => void
  /** Called when the user wants to open an existing stored campaign. */
  onOpenCampaign: (path: string) => void
}

/**
 * CampaignLauncher
 * Minimal landing screen that gates access to the chat UI until a campaign
 * JSON file is selected.
 */
export function CampaignLauncher({
  campaigns,
  isBusy,
  loadingState = null,
  statusMessage,
  onCreateCampaign,
  onOpenFromFile,
  onOpenCampaign,
}: CampaignLauncherProps) {
  if (loadingState) {
    return (
      <main className="campaign-launcher campaign-launcher--loading">
        <section className="campaign-launcher__panel campaign-launcher__panel--loading" aria-live="polite">
          <p className="campaign-launcher__eyebrow">Campaigns</p>
          <h1 className="campaign-launcher__title">{loadingState.title}</h1>
          <p className="campaign-launcher__copy campaign-launcher__copy--loading">
            {loadingState.detail}
          </p>

          <div className="campaign-launcher__progress" aria-hidden="true">
            <div
              className={`campaign-launcher__progress-bar${loadingState.percent == null ? ' campaign-launcher__progress-bar--indeterminate' : ''}`}
              style={loadingState.percent != null ? { width: `${loadingState.percent}%` } : undefined}
            />
          </div>

          <div className="campaign-launcher__progress-meta">
            <span>Opening existing campaign</span>
            <span>{loadingState.percent != null ? `${loadingState.percent}%` : 'Working…'}</span>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="campaign-launcher">
      <section className="campaign-launcher__panel" aria-labelledby="campaign-launcher-title">
        <p className="campaign-launcher__eyebrow">Campaigns</p>
        <h1 id="campaign-launcher-title" className="campaign-launcher__title">
          Start with a campaign
        </h1>
        <p className="campaign-launcher__copy">
          Create a new campaign with a name and description, or reopen one stored in the app data directory.
        </p>

        <div className="campaign-launcher__actions">
          <button
            className="campaign-launcher__button campaign-launcher__button--primary"
            type="button"
            onClick={onCreateCampaign}
            disabled={isBusy}
          >
            New Campaign
          </button>
          <button
            className="campaign-launcher__button campaign-launcher__button--secondary"
            type="button"
            onClick={onOpenFromFile}
            disabled={isBusy}
          >
            Open From File
          </button>
        </div>

        <p className="campaign-launcher__hint">
          {isBusy ? 'Opening campaign...' : 'Campaigns are stored under the app data campaigns folder.'}
        </p>

        {statusMessage ? (
          <p className="campaign-launcher__status" role="status">
            {statusMessage}
          </p>
        ) : null}

        <div className="campaign-launcher__library">
          <div className="campaign-launcher__library-header">
            <h2 className="campaign-launcher__library-title">Existing Campaigns</h2>
            <span className="campaign-launcher__library-count">
              {campaigns.length} stored
            </span>
          </div>

          {campaigns.length === 0 ? (
            <p className="campaign-launcher__empty">
              No campaigns found yet. Create one to initialize the campaigns folder.
            </p>
          ) : (
            <div className="campaign-launcher__list" role="list" aria-label="Stored campaigns">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  role="listitem"
                  className="campaign-launcher__campaign"
                  onClick={() => onOpenCampaign(campaign.path)}
                  disabled={isBusy}
                >
                  <span className="campaign-launcher__campaign-name">{campaign.name}</span>
                  <span className="campaign-launcher__campaign-description">
                    {campaign.description || 'No description yet.'}
                  </span>
                  <span className="campaign-launcher__campaign-meta">
                    {campaign.sessionCount} {campaign.sessionCount === 1 ? 'session' : 'sessions'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
