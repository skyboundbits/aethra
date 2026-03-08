/**
 * src/types/electron.d.ts
 * Augments the global Window interface with the API surface exposed by the
 * Electron preload script via contextBridge.
 *
 * window.api is available in the renderer process only. It must NOT be
 * called from Node.js contexts (main process / preload internals).
 */

import type { AppSettings, AvailableModel, ChatMessage, WindowControlsState } from './index'

/** Callbacks passed to window.api.streamCompletion. */
interface StreamHandlers {
  /** Called once per streamed text token. */
  onToken: (chunk: string) => void
  /** Called when the stream ends successfully. */
  onDone:  () => void
  /** Called if the request fails; receives an error description. */
  onError: (err: string) => void
}

declare global {
  interface Window {
    /** API bridge injected by the Electron preload script. */
    api: {
      /**
       * Send a message history to the AI server and stream the response back.
       * @param messages   - Full conversation in chat format.
       * @param serverId   - Server profile ID, or null for the active server.
       * @param modelSlug  - Model slug, or null for the active model.
       * @param handlers   - Stream event callbacks.
       */
      streamCompletion: (
        messages:  ChatMessage[],
        serverId:  string | null,
        modelSlug: string | null,
        handlers:  StreamHandlers,
      ) => void

      /**
       * Read persisted AppSettings from the main process.
       * @returns Promise resolving to the current settings.
       */
      getSettings: () => Promise<AppSettings>

      /**
       * Persist AppSettings via the main process.
       * @param settings - Settings object to save.
       */
      saveSettings: (settings: AppSettings) => Promise<void>

      /**
       * Query a configured AI server for its currently available models.
       * @param serverId - Server profile ID to inspect.
       * @returns Promise resolving to discovered models for that server.
       */
      browseModels: (serverId: string) => Promise<AvailableModel[]>

      /**
       * Read the current platform and maximize state for the focused window.
       * @returns Promise resolving to the current title bar control state.
       */
      getWindowState: () => Promise<WindowControlsState>

      /** Minimize the current window. */
      minimizeWindow: () => Promise<void>

      /** Toggle maximized/restored state on the current window. */
      toggleMaximizeWindow: () => Promise<void>

      /** Close the current window. */
      closeWindow: () => Promise<void>

      /**
       * Subscribe to maximize state changes from the main process.
       * @param listener - Called whenever the current window state changes.
       * @returns Cleanup function to remove the listener.
       */
      onWindowStateChange: (listener: (state: WindowControlsState) => void) => () => void
    }
  }
}

export {}
