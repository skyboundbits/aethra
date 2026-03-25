/**
 * src/components/CreateCampaignModal.tsx
 * Modal dialog for creating a new campaign with a name and description.
 */

import { useState } from 'react'
import { Modal } from './Modal'
import { ModalFooter, ModalFormLayout } from './ModalLayouts'
import { SwordsIcon } from './icons'
import '../styles/create-campaign.css'

/** Props accepted by the CreateCampaignModal component. */
interface CreateCampaignModalProps {
  /** True while the create request is being saved. */
  isBusy: boolean
  /** Called when the user closes the dialog without creating a campaign. */
  onClose: () => void
  /** Called when the user submits the campaign form. */
  onSubmit: (name: string, description: string) => void
}

/**
 * CreateCampaignModal
 * Collects the required metadata for a new stored campaign folder.
 */
export function CreateCampaignModal({
  isBusy,
  onClose,
  onSubmit,
}: CreateCampaignModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /**
   * Validate and submit the campaign creation form.
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
    onSubmit(trimmedName, trimmedDescription)
  }

  return (
    <Modal
      title={(
        <>
          <SwordsIcon className="modal__title-icon" />
          New Campaign
        </>
      )}
      onClose={onClose}
      variant="form"
      className="modal--create-campaign"
    >
      <form onSubmit={handleSubmit}>
        <ModalFormLayout
          body={(
            <div className="create-campaign">
              <p className="create-campaign__intro">
                Create a new campaign.
              </p>

              <label className="create-campaign__field" htmlFor="campaign-name">
                <span className="create-campaign__label">Name</span>
                <input
                  id="campaign-name"
                  className="create-campaign__input"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="The Ember Court"
                  autoFocus
                  disabled={isBusy}
                />
              </label>

              <label className="create-campaign__field" htmlFor="campaign-description">
                <span className="create-campaign__label">Description</span>
                <textarea
                  id="campaign-description"
                  className="create-campaign__textarea"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Political intrigue in a decaying imperial capital."
                  rows={5}
                  disabled={isBusy}
                />
              </label>

              {errorMessage ? (
                <p className="create-campaign__error" role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          )}
          footer={(
            <ModalFooter
              actions={(
                <>
                  <button type="button" className="modal-footer__button" onClick={onClose} disabled={isBusy}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="modal-footer__button modal-footer__button--primary"
                    disabled={isBusy}
                  >
                    {isBusy ? 'Creating...' : 'Create Campaign'}
                  </button>
                </>
              )}
            />
          )}
        />
      </form>
    </Modal>
  )
}
