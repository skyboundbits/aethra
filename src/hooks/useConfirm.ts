/**
 * src/hooks/useConfirm.ts
 * Hook that provides an in-app alternative to window.confirm().
 * Returns a confirm() function and the pending state needed to render ConfirmModal.
 */

import { useCallback, useRef, useState } from 'react'

/** Options passed to the confirm() function. */
export interface ConfirmOptions {
  /** Dialog heading. */
  title: string
  /** Primary message shown in the body. */
  message: string
  /** Optional warning text shown in a distinct style beneath the message. */
  warning?: string
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string
}

/** State exposed to the consumer for rendering ConfirmModal. */
export interface ConfirmState extends ConfirmOptions {
  /** Resolve the pending promise with true (confirm). */
  onConfirm: () => void
  /** Resolve the pending promise with false (cancel). */
  onCancel: () => void
}

/**
 * useConfirm
 * Manages a single pending confirmation dialog.
 *
 * @returns confirm function and current pending state (null when idle).
 *
 * @example
 * const { confirm, confirmState } = useConfirm()
 * // in JSX: confirmState ? <ConfirmModal {...confirmState} /> : null
 * // in handler: if (await confirm({ title: 'Delete?', message: '...' })) { ... }
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  confirmState: ConfirmState | null
} {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setConfirmState({
        ...options,
        onConfirm: () => {
          resolverRef.current?.(true)
          resolverRef.current = null
          setConfirmState(null)
        },
        onCancel: () => {
          resolverRef.current?.(false)
          resolverRef.current = null
          setConfirmState(null)
        },
      })
    })
  }, [])

  return { confirm, confirmState }
}
