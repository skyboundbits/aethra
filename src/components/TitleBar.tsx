/**
 * src/components/TitleBar.tsx
 * Custom Electron title bar with draggable region and platform-aware controls.
 */

import { useEffect, useState } from 'react'
import '../styles/titlebar.css'
import { MaximizeIcon, MinusIcon, RestoreIcon, XIcon } from './icons'

import type { WindowControlsState } from '../types'

const FALLBACK_WINDOW_STATE: WindowControlsState = {
  platform: 'win32',
  isMaximized: false,
}

interface TitleBarProps {
  /** App name shown in the title bar. */
  title: string
}

/**
 * TitleBar
 * Renders a custom draggable title bar and Electron window controls.
 */
export function TitleBar({ title }: TitleBarProps) {
  const [windowState, setWindowState] = useState<WindowControlsState>(FALLBACK_WINDOW_STATE)

  /**
   * Load initial window state and subscribe to subsequent changes.
   */
  useEffect(() => {
    let cancelled = false

    /**
     * Read the initial platform/maximize state from the preload bridge.
     */
    async function loadWindowState(): Promise<void> {
      try {
        const state = await window.api.getWindowState()
        if (!cancelled) {
          setWindowState(state)
        }
      } catch (err) {
        console.error('[Aethra] Could not read window state:', err)
      }
    }

    void loadWindowState()

    const cleanup = window.api.onWindowStateChange((state) => {
      if (!cancelled) {
        setWindowState(state)
      }
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  /**
   * Minimize the current Electron window.
   */
  async function handleMinimize(): Promise<void> {
    await window.api.minimizeWindow()
  }

  /**
   * Toggle maximized/restored state for the current Electron window.
   */
  async function handleToggleMaximize(): Promise<void> {
    await window.api.toggleMaximizeWindow()
  }

  /**
   * Close the current Electron window.
   */
  async function handleClose(): Promise<void> {
    await window.api.closeWindow()
  }

  const isMac = windowState.platform === 'darwin'
  const maximizeLabel = windowState.isMaximized ? 'Restore window' : 'Maximize window'

  return (
    <header className={`title-bar${isMac ? ' title-bar--mac' : ''}`}>
      <div className="title-bar__drag-region">
        <span className={`title-bar__title${isMac ? '' : ' title-bar__title--glass'}`}>{title}</span>
      </div>

      {isMac ? (
        <div className="title-bar__controls title-bar__controls--mac">
          <button
            className="title-bar__control title-bar__control--close"
            onClick={() => { void handleClose() }}
            aria-label="Close window"
            title="Close"
          />
          <button
            className="title-bar__control title-bar__control--minimize"
            onClick={() => { void handleMinimize() }}
            aria-label="Minimize window"
            title="Minimize"
          />
          <button
            className="title-bar__control title-bar__control--maximize"
            onClick={() => { void handleToggleMaximize() }}
            aria-label={maximizeLabel}
            title={windowState.isMaximized ? 'Restore' : 'Maximize'}
          />
        </div>
      ) : null}

      {!isMac ? (
        <div className="title-bar__controls">
          <button
            className="title-bar__control title-bar__control--windows"
            onClick={() => { void handleMinimize() }}
            aria-label="Minimize window"
            title="Minimize"
          >
            <MinusIcon className="title-bar__icon" aria-hidden="true" />
          </button>
          <button
            className="title-bar__control title-bar__control--windows"
            onClick={() => { void handleToggleMaximize() }}
            aria-label={maximizeLabel}
            title={windowState.isMaximized ? 'Restore' : 'Maximize'}
          >
            {windowState.isMaximized ? (
              <RestoreIcon className="title-bar__icon" aria-hidden="true" />
            ) : (
              <MaximizeIcon className="title-bar__icon" aria-hidden="true" />
            )}
          </button>
          <button
            className="title-bar__control title-bar__control--windows title-bar__control--windows-close"
            onClick={() => { void handleClose() }}
            aria-label="Close window"
            title="Close"
          >
            <XIcon className="title-bar__icon" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
