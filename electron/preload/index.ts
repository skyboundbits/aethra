/**
 * electron/preload/index.ts
 * Preload script — runs in a privileged context before the renderer loads.
 *
 * Uses contextBridge to expose a minimal, typed API surface to the renderer
 * (window.api) without granting direct Node.js / Electron access.
 *
 * Exposed API:
 *   window.api.streamCompletion  — start a streaming AI request
 *   window.api.getSettings       — read persisted AppSettings
 *   window.api.saveSettings      — write AppSettings to disk
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent }       from 'electron'
import type { AppSettings, AvailableModel, ChatMessage, WindowControlsState } from '../../src/types'

/** Handlers passed by the renderer to streamCompletion. */
interface StreamHandlers {
  onToken: (chunk: string) => void
  onDone:  () => void
  onError: (err: string) => void
}

contextBridge.exposeInMainWorld('api', {
  /**
   * Send a message history to the AI server and receive the response as a stream.
   * Registers per-request listeners keyed by a random ID so multiple concurrent
   * requests don't interfere with each other.
   *
   * @param messages   - Full conversation history in chat format.
   * @param serverId   - Server profile ID to use, or null for the active server.
   * @param modelSlug  - Model slug to request, or null for the active model.
   * @param handlers   - Callbacks for stream events.
   */
  streamCompletion(
    messages:  ChatMessage[],
    serverId:  string | null,
    modelSlug: string | null,
    handlers:  StreamHandlers,
  ): void {
    const id = Math.random().toString(36).slice(2, 10)

    function onChunk(_: IpcRendererEvent, reqId: string, chunk: string) {
      if (reqId === id) handlers.onToken(chunk)
    }
    function onDone(_: IpcRendererEvent, reqId: string) {
      if (reqId !== id) return
      cleanup()
      handlers.onDone()
    }
    function onError(_: IpcRendererEvent, reqId: string, err: string) {
      if (reqId !== id) return
      cleanup()
      handlers.onError(err)
    }
    function cleanup() {
      ipcRenderer.off('ai:chunk', onChunk)
      ipcRenderer.off('ai:done',  onDone)
      ipcRenderer.off('ai:error', onError)
    }

    ipcRenderer.on('ai:chunk', onChunk)
    ipcRenderer.on('ai:done',  onDone)
    ipcRenderer.on('ai:error', onError)
    ipcRenderer.send('ai:stream', { id, messages, serverId, modelSlug })
  },

  /**
   * Read the persisted AppSettings from disk (main process).
   * @returns Promise resolving to the current settings.
   */
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:get') as Promise<AppSettings>
  },

  /**
   * Persist AppSettings to disk via the main process.
   * @param settings - The full settings object to save.
   */
  saveSettings(settings: AppSettings): Promise<void> {
    return ipcRenderer.invoke('settings:set', settings) as Promise<void>
  },

  /**
   * Request the current model catalog from a configured server profile.
   *
   * @param serverId - Server profile ID to query.
   * @returns Promise resolving to discovered models for that server.
   */
  browseModels(serverId: string): Promise<AvailableModel[]> {
    return ipcRenderer.invoke('models:browse', serverId) as Promise<AvailableModel[]>
  },

  /**
   * Read the current window control state.
   * @returns Promise resolving to the platform and maximize state.
   */
  getWindowState(): Promise<WindowControlsState> {
    return ipcRenderer.invoke('window:get-state') as Promise<WindowControlsState>
  },

  /**
   * Minimize the current BrowserWindow.
   */
  minimizeWindow(): Promise<void> {
    return ipcRenderer.invoke('window:minimize') as Promise<void>
  },

  /**
   * Toggle the current BrowserWindow maximized/restored state.
   */
  toggleMaximizeWindow(): Promise<void> {
    return ipcRenderer.invoke('window:toggle-maximize') as Promise<void>
  },

  /**
   * Close the current BrowserWindow.
   */
  closeWindow(): Promise<void> {
    return ipcRenderer.invoke('window:close') as Promise<void>
  },

  /**
   * Subscribe to title bar state changes pushed from the main process.
   *
   * @param listener - Called whenever maximize state changes.
   * @returns Cleanup function that removes the IPC listener.
   */
  onWindowStateChange(listener: (state: WindowControlsState) => void): () => void {
    function onState(_: IpcRendererEvent, state: WindowControlsState) {
      listener(state)
    }

    ipcRenderer.on('window:state-changed', onState)
    return () => {
      ipcRenderer.off('window:state-changed', onState)
    }
  },
})
