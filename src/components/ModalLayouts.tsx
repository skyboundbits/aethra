/**
 * src/components/ModalLayouts.tsx
 * Shared modal layout primitives for workspace, form, and popup dialogs.
 */

import '../styles/modal-layouts.css'

/** Props accepted by the ModalWorkspaceLayout component. */
interface ModalWorkspaceLayoutProps {
  /** Optional left navigation column content. */
  nav: React.ReactNode
  /** Primary panel content shown on the right. */
  panel: React.ReactNode
  /** Optional footer row rendered beneath the body. */
  footer?: React.ReactNode
}

/**
 * ModalWorkspaceLayout
 * Two-column modal layout used for management surfaces with left navigation.
 */
export function ModalWorkspaceLayout({
  nav,
  panel,
  footer,
}: ModalWorkspaceLayoutProps) {
  return (
    <div className="modal-layout modal-layout--workspace">
      <div className="modal-layout__body modal-layout__body--workspace">
        <nav className="modal-layout__nav">{nav}</nav>
        <div className="modal-layout__panel modal-layout__panel--workspace">{panel}</div>
      </div>
      {footer ? <div className="modal-layout__footer">{footer}</div> : null}
    </div>
  )
}

/** Props accepted by the ModalFormLayout component. */
interface ModalFormLayoutProps {
  /** Main body content for the form modal. */
  body: React.ReactNode
  /** Optional footer row rendered beneath the form body. */
  footer?: React.ReactNode
}

/**
 * ModalFormLayout
 * Single-column modal layout with a footer action row.
 */
export function ModalFormLayout({ body, footer }: ModalFormLayoutProps) {
  return (
    <div className="modal-layout modal-layout--form">
      <div className="modal-layout__panel modal-layout__panel--form">{body}</div>
      {footer ? <div className="modal-layout__footer">{footer}</div> : null}
    </div>
  )
}

/** Props accepted by the ModalPopupLayout component. */
interface ModalPopupLayoutProps {
  /** Main content for the popup modal. */
  children: React.ReactNode
  /** Optional footer row rendered beneath the popup body. */
  footer?: React.ReactNode
}

/**
 * ModalPopupLayout
 * Compact modal layout used for short-lived popups and inspectors.
 */
export function ModalPopupLayout({ children, footer }: ModalPopupLayoutProps) {
  return (
    <div className="modal-layout modal-layout--popup">
      <div className="modal-layout__panel modal-layout__panel--popup">{children}</div>
      {footer ? <div className="modal-layout__footer">{footer}</div> : null}
    </div>
  )
}

/** Props accepted by the ModalFooter component. */
interface ModalFooterProps {
  /** Optional status or helper content aligned left. */
  status?: React.ReactNode
  /** Footer action buttons aligned right. */
  actions?: React.ReactNode
}

/**
 * ModalFooter
 * Shared footer row with a left status region and right action group.
 */
export function ModalFooter({ status, actions }: ModalFooterProps) {
  return (
    <>
      {status ? (
        <div className="modal-footer__status">{status}</div>
      ) : (
        <div className="modal-footer__spacer" aria-hidden="true" />
      )}
      {actions ? <div className="modal-footer__actions">{actions}</div> : null}
    </>
  )
}
