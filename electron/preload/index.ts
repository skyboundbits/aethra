/**
 * electron/preload/index.ts
 * Preload script — runs in a privileged context before the renderer loads.
 *
 * Uses contextBridge to expose a minimal, typed API surface to the renderer
 * (window.api) without granting direct Node.js / Electron access.
 *
 * Exposed API:
 *   window.api.streamCompletion       — start a streaming AI request
 *   window.api.getSettings            — read persisted AppSettings
 *   window.api.saveSettings           — write AppSettings to disk
 *   window.api.checkLlamaBinary       — check if llama-server binary is present
 *   window.api.installLlamaBinary     — download and install llama-server binary
 *   window.api.onBinaryInstallProgress — subscribe to binary install progress
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent }       from 'electron'
import type {
  AppSettings,
  AiDebugEntry,
  AvailableModel,
  BinaryInstallProgress,
  Campaign,
  CampaignFileHandle,
  CampaignLoadProgress,
  CampaignSummary,
  CharacterProfile,
  ChatMessage,
  HardwareInfo,
  ReusableAvatar,
  HuggingFaceModelFile,
  LocalRuntimeLoadProgress,
  LocalRuntimeStatus,
  ModelDownloadProgress,
  ModelPreset,
  RelationshipGraph,
  ReusableCharacter,
  Scene,
  TokenUsage,
  WindowControlsState,
} from '../../src/types'

/** Handlers passed by the renderer to streamCompletion. */
interface StreamHandlers {
  onToken: (chunk: string) => void
  onUsage?: (usage: TokenUsage) => void
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
    function onUsage(_: IpcRendererEvent, reqId: string, usage: TokenUsage) {
      if (reqId === id) handlers.onUsage?.(usage)
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
      ipcRenderer.off('ai:usage', onUsage)
      ipcRenderer.off('ai:done',  onDone)
      ipcRenderer.off('ai:error', onError)
    }

    ipcRenderer.on('ai:chunk', onChunk)
    ipcRenderer.on('ai:usage', onUsage)
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
   * Request that a configured server loads the selected model.
   *
   * @param serverId - Server profile ID to control.
   * @param modelName - Exact upstream model name to load.
   * @param contextWindowTokens - Requested context window size in tokens.
   */
  loadModel(serverId: string, modelName: string, contextWindowTokens: number): Promise<void> {
    return ipcRenderer.invoke('models:load', serverId, modelName, contextWindowTokens) as Promise<void>
  },

  /**
   * Read the detected local hardware inventory used for llama.cpp guidance.
   *
   * @returns Promise resolving to the latest hardware summary.
   */
  getHardwareInfo(): Promise<HardwareInfo> {
    return ipcRenderer.invoke('hardware:get') as Promise<HardwareInfo>
  },

  /**
   * Open a native folder picker for the local llama.cpp models directory.
   *
   * @returns Promise resolving to the chosen directory path, or null when cancelled.
   */
  pickModelsDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('llama:pick-models-directory') as Promise<string | null>
  },

  /**
   * Open a native file picker for the llama-server executable.
   *
   * @returns Promise resolving to the chosen executable path, or null when cancelled.
   */
  pickLlamaExecutable(): Promise<string | null> {
    return ipcRenderer.invoke('llama:pick-executable') as Promise<string | null>
  },

  /**
   * Browse GGUF files available in a Hugging Face repository.
   *
   * @param serverId - Local llama.cpp server profile id.
   * @param repoId - Hugging Face repository identifier.
   * @returns Promise resolving to GGUF files reported by Hugging Face.
   */
  browseHuggingFaceModels(serverId: string, repoId: string): Promise<HuggingFaceModelFile[]> {
    return ipcRenderer.invoke('llama:hf:browse', serverId, repoId) as Promise<HuggingFaceModelFile[]>
  },

  /**
   * Download a GGUF file from Hugging Face into the configured local models directory.
   *
   * @param serverId - Local llama.cpp server profile id.
   * @param repoId - Hugging Face repository identifier.
   * @param fileName - Repository-relative GGUF path.
   * @returns Promise resolving to the persisted local model preset.
   */
  downloadHuggingFaceModel(serverId: string, repoId: string, fileName: string): Promise<ModelPreset> {
    return ipcRenderer.invoke('llama:hf:download', serverId, repoId, fileName) as Promise<ModelPreset>
  },

  /**
   * Cancel an in-flight GGUF download from Hugging Face.
   *
   * @param serverId - Local llama.cpp server profile id.
   * @param repoId - Hugging Face repository identifier.
   * @param fileName - Repository-relative GGUF path.
   */
  cancelHuggingFaceModelDownload(serverId: string, repoId: string, fileName: string): Promise<void> {
    return ipcRenderer.invoke('llama:hf:cancel-download', serverId, repoId, fileName) as Promise<void>
  },

  /**
   * Delete a local llama.cpp model and persist the resulting settings state.
   *
   * @param serverId - Local llama.cpp server profile id.
   * @param modelSlug - Local model slug to delete.
   * @returns Promise resolving to the updated app settings.
   */
  deleteLocalModel(serverId: string, modelSlug: string): Promise<AppSettings> {
    return ipcRenderer.invoke('llama:model:delete', serverId, modelSlug) as Promise<AppSettings>
  },

  /**
   * Subscribe to Hugging Face model download progress updates.
   *
   * @param listener - Called whenever the main process emits a progress update.
   * @returns Cleanup function that removes the IPC listener.
   */
  onModelDownloadProgress(listener: (progress: ModelDownloadProgress) => void): () => void {
    function onProgress(_: IpcRendererEvent, progress: ModelDownloadProgress) {
      listener(progress)
    }

    ipcRenderer.on('llama:model-download:progress', onProgress)
    return () => {
      ipcRenderer.off('llama:model-download:progress', onProgress)
    }
  },

  /**
   * Read the current managed local runtime status.
   *
   * @returns Promise resolving to the managed llama.cpp runtime status.
   */
  getLocalRuntimeStatus(): Promise<LocalRuntimeStatus> {
    return ipcRenderer.invoke('llama:runtime:get-status') as Promise<LocalRuntimeStatus>
  },

  /**
   * Start the managed local llama.cpp runtime for a selected GGUF model.
   *
   * @param serverId - Local llama.cpp server profile id.
   * @param modelSlug - Local model slug to load.
   * @returns Promise resolving to the runtime status after startup completes.
   */
  loadLocalModel(serverId: string, modelSlug: string): Promise<LocalRuntimeStatus> {
    return ipcRenderer.invoke('llama:runtime:load', serverId, modelSlug) as Promise<LocalRuntimeStatus>
  },

  /**
   * Stop the managed local llama.cpp runtime.
   */
  stopLocalModel(): Promise<void> {
    return ipcRenderer.invoke('llama:runtime:stop') as Promise<void>
  },

  /**
   * Subscribe to local runtime state changes pushed from the main process.
   *
   * @param listener - Called whenever the managed runtime status changes.
   * @returns Cleanup function that removes the IPC listener.
   */
  onLocalRuntimeStatus(listener: (status: LocalRuntimeStatus) => void): () => void {
    function onStatus(_: IpcRendererEvent, status: LocalRuntimeStatus) {
      listener(status)
    }

    ipcRenderer.on('llama:runtime:status', onStatus)
    return () => {
      ipcRenderer.off('llama:runtime:status', onStatus)
    }
  },

  /**
   * Subscribe to local llama.cpp startup progress updates.
   *
   * @param listener - Called whenever model startup progress changes.
   * @returns Cleanup function that removes the IPC listener.
   */
  onLocalRuntimeLoadProgress(listener: (progress: LocalRuntimeLoadProgress | null) => void): () => void {
    function onProgress(_: IpcRendererEvent, progress: LocalRuntimeLoadProgress | null) {
      listener(progress)
    }

    ipcRenderer.on('llama:runtime:load-progress', onProgress)
    return () => {
      ipcRenderer.off('llama:runtime:load-progress', onProgress)
    }
  },

  /**
   * Check whether a usable llama-server binary exists for a local server profile.
   * @param serverId - Local llama.cpp server profile id.
   * @returns Detection result including found status, path, backend, and estimated size.
   */
  checkLlamaBinary(serverId: string) {
    return ipcRenderer.invoke('llama:binary:check', serverId) as Promise<{
      found: boolean
      path: string | null
      detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
      estimatedSizeMb: number
    }>
  },

  /**
   * Download and install the llama-server binary for a local server profile.
   * Progress is broadcast via onBinaryInstallProgress during the operation.
   * @param serverId - Local llama.cpp server profile id.
   * @returns Result with success flag and resolved executable path.
   */
  installLlamaBinary(serverId: string) {
    return ipcRenderer.invoke('llama:binary:install', serverId) as Promise<{
      success: boolean
      executablePath: string | null
      error?: string
    }>
  },

  /**
   * Subscribe to binary install progress updates from the main process.
   * @param listener - Called whenever install progress changes.
   * @returns Cleanup function to remove the listener.
   */
  onBinaryInstallProgress(listener: (progress: BinaryInstallProgress) => void) {
    function onProgress(_: IpcRendererEvent, progress: BinaryInstallProgress) {
      listener(progress)
    }
    ipcRenderer.on('llama:binary:install:progress', onProgress)
    return () => { ipcRenderer.off('llama:binary:install:progress', onProgress) }
  },

  /**
   * Read the in-memory AI debug log from the main process.
   * @returns Promise resolving to the most recent AI debug entries.
   */
  getAiDebugLog(): Promise<AiDebugEntry[]> {
    return ipcRenderer.invoke('ai:debug:get') as Promise<AiDebugEntry[]>
  },

  /**
   * Clear the in-memory AI debug log.
   */
  clearAiDebugLog(): Promise<void> {
    return ipcRenderer.invoke('ai:debug:clear') as Promise<void>
  },

  /**
   * Append a renderer-originated AI debug entry to the shared log.
   *
   * @param entry - Entry fields excluding the generated id.
   */
  appendAiDebugEntry(entry: Omit<AiDebugEntry, 'id'>): Promise<void> {
    return ipcRenderer.invoke('ai:debug:append', entry) as Promise<void>
  },

  /**
   * Subscribe to new AI debug log entries.
   *
   * @param listener - Called whenever a new AI debug event is recorded.
   * @returns Cleanup function that removes the IPC listener.
   */
  onAiDebugEntry(listener: (entry: AiDebugEntry) => void): () => void {
    function onEntry(_: IpcRendererEvent, entry: AiDebugEntry) {
      listener(entry)
    }

    ipcRenderer.on('ai:debug:entry', onEntry)
    return () => {
      ipcRenderer.off('ai:debug:entry', onEntry)
    }
  },

  /**
   * Create a new stored campaign folder in the app data directory.
   *
   * @param name - Human-readable campaign name.
   * @param description - Short campaign description.
   * @returns Promise resolving to the created campaign and folder path.
   */
  createCampaign(name: string, description: string): Promise<CampaignFileHandle> {
    return ipcRenderer.invoke('campaign:create', name, description) as Promise<CampaignFileHandle>
  },

  /**
   * Load the list of saved campaigns from the app-managed campaigns directory.
   *
   * @returns Promise resolving to campaign summaries for the launcher.
   */
  listCampaigns(): Promise<CampaignSummary[]> {
    return ipcRenderer.invoke('campaign:list') as Promise<CampaignSummary[]>
  },

  /**
   * Open an existing stored campaign by folder path.
   *
   * @param path - Absolute path to the campaign folder.
   * @returns Promise resolving to the loaded campaign and folder path.
   */
  openCampaign(path: string): Promise<CampaignFileHandle> {
    return ipcRenderer.invoke('campaign:open', path) as Promise<CampaignFileHandle>
  },

  /**
   * Subscribe to progress updates while an existing campaign loads from disk.
   *
   * @param listener - Called whenever the main process emits a load update.
   * @returns Cleanup function that removes the IPC listener.
   */
  onCampaignLoadProgress(listener: (progress: CampaignLoadProgress) => void): () => void {
    function onProgress(_: IpcRendererEvent, progress: CampaignLoadProgress) {
      listener(progress)
    }

    ipcRenderer.on('campaign:load:progress', onProgress)
    return () => {
      ipcRenderer.off('campaign:load:progress', onProgress)
    }
  },

  /**
   * Open a native file picker for an existing campaign JSON file.
   *
   * @returns Promise resolving to the selected campaign folder path, or null.
   */
  pickCampaignFile(): Promise<string | null> {
    return ipcRenderer.invoke('campaign:pick-file') as Promise<string | null>
  },

  /**
   * Save the current campaign JSON to disk.
   *
   * @param path - Absolute path to the target file.
   * @param campaign - Campaign payload to write.
   */
  saveCampaign(path: string, campaign: Campaign): Promise<void> {
    return ipcRenderer.invoke('campaign:save', path, campaign) as Promise<void>
  },

  /**
   * Load all stored characters for a campaign.
   *
   * @param campaignPath - Absolute path to the active campaign folder.
   * @returns Promise resolving to stored character profiles.
   */
  listCharacters(campaignPath: string): Promise<CharacterProfile[]> {
    return ipcRenderer.invoke('characters:list', campaignPath) as Promise<CharacterProfile[]>
  },

  /**
   * Create a new character folder within the active campaign.
   *
   * @param campaignPath - Absolute path to the active campaign folder.
   * @param name - Human-readable character name.
   * @returns Promise resolving to the created character profile.
   */
  createCharacter(campaignPath: string, name: string): Promise<CharacterProfile> {
    return ipcRenderer.invoke('characters:create', campaignPath, name) as Promise<CharacterProfile>
  },

  /**
   * Persist a character profile inside the active campaign.
   *
   * @param campaignPath - Absolute path to the active campaign folder.
   * @param character - Character profile to write.
   * @returns Promise resolving to the saved character profile.
   */
  saveCharacter(campaignPath: string, character: CharacterProfile): Promise<CharacterProfile> {
    return ipcRenderer.invoke('characters:save', campaignPath, character) as Promise<CharacterProfile>
  },

  /**
   * Delete a stored character from the active campaign.
   *
   * @param campaignPath - Absolute path to the active campaign folder.
   * @param characterId - Stable character identifier to remove.
   */
  deleteCharacter(campaignPath: string, characterId: string): Promise<void> {
    return ipcRenderer.invoke('characters:delete', campaignPath, characterId) as Promise<void>
  },

  /**
   * Load the stored relationship graph for a campaign.
   *
   * @param campaignPath - Absolute path to the campaign folder.
   * @param campaignId - Campaign.id for integrity validation.
   * @returns Promise resolving to the graph, or null when absent.
   */
  getRelationships(campaignPath: string, campaignId: string): Promise<RelationshipGraph | null> {
    return ipcRenderer.invoke('relationships:get', campaignPath, campaignId) as Promise<RelationshipGraph | null>
  },

  /**
   * Persist the relationship graph to disk.
   *
   * @param campaignPath - Absolute path to the campaign folder.
   * @param graph - Full graph to write.
   */
  saveRelationships(campaignPath: string, graph: RelationshipGraph): Promise<void> {
    return ipcRenderer.invoke('relationships:set', campaignPath, graph) as Promise<void>
  },

  /**
   * Generate a relationship-focused narrative summary (Pass 1 only).
   * Used when rebuilding scene summary to optionally add relationship context.
   *
   * @param campaignPath - Absolute path to the campaign folder.
   * @param campaignId - Campaign.id for context (not persisted).
   * @param characters - Campaign character roster.
   * @param sessions - Campaign sessions to analyze.
   * @returns Promise resolving to the narrative prose summary.
   */
  generateRelationshipNarrative(
    campaignPath: string,
    campaignId: string,
    characters: CharacterProfile[],
    sessions: Scene[],
  ): Promise<string> {
    return ipcRenderer.invoke('relationships:generate-narrative', campaignPath, campaignId, characters, sessions) as Promise<string>
  },

  /**
   * Run LLM analysis and return the merged relationship graph without saving.
   *
   * @param campaignPath - Absolute path to the campaign folder.
   * @param campaignId - Campaign.id written into the returned graph.
   * @param characters - Campaign character roster.
   * @param sessions - All campaign sessions, oldest first.
   * @returns Promise resolving to the merged graph for user review.
   */
  refreshRelationships(
    campaignPath: string,
    campaignId: string,
    characters: CharacterProfile[],
    sessions: Scene[],
  ): Promise<RelationshipGraph> {
    return ipcRenderer.invoke('relationships:refresh', campaignPath, campaignId, characters, sessions) as Promise<RelationshipGraph>
  },

  /**
   * Load the global reusable avatar library.
   *
   * @returns Promise resolving to saved reusable avatars.
   */
  listReusableAvatars(): Promise<ReusableAvatar[]> {
    return ipcRenderer.invoke('avatars:list') as Promise<ReusableAvatar[]>
  },

  /**
   * Persist a reusable avatar in the global avatar library.
   *
   * @param avatar - Avatar record to create or update.
   * @returns Promise resolving to the saved avatar.
   */
  saveReusableAvatar(avatar: ReusableAvatar): Promise<ReusableAvatar> {
    return ipcRenderer.invoke('avatars:save', avatar) as Promise<ReusableAvatar>
  },

  /**
   * Delete one reusable avatar from the global avatar library.
   *
   * @param avatarId - Stable avatar identifier to remove.
   */
  deleteReusableAvatar(avatarId: string): Promise<void> {
    return ipcRenderer.invoke('avatars:delete', avatarId) as Promise<void>
  },

  /**
   * Load the global reusable character library.
   *
   * @returns Promise resolving to saved reusable characters.
   */
  listReusableCharacters(): Promise<ReusableCharacter[]> {
    return ipcRenderer.invoke('characters:reusable:list') as Promise<ReusableCharacter[]>
  },

  /**
   * Persist a reusable character in the global character library.
   *
   * @param character - Character record to create or update.
   * @returns Promise resolving to the saved character.
   */
  saveReusableCharacter(character: ReusableCharacter): Promise<ReusableCharacter> {
    return ipcRenderer.invoke('characters:reusable:save', character) as Promise<ReusableCharacter>
  },

  /**
   * Delete one reusable character from the global character library.
   *
   * @param characterId - Stable character identifier to remove.
   */
  deleteReusableCharacter(characterId: string): Promise<void> {
    return ipcRenderer.invoke('characters:reusable:delete', characterId) as Promise<void>
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

  /**
   * Fetch pre-authored app characters and avatars.
   *
   * @returns Promise resolving to objects with avatars and characters arrays.
   */
  getAppContent() {
    return ipcRenderer.invoke('appContent:get') as Promise<{
      avatars: Array<{
        id: string
        name: string
        imageData: string
        crop: { x: number; y: number; scale: number }
      }>
      characters: Array<{
        id: string
        name: string
        role: string
        gender: 'male' | 'female' | 'non-specific'
        pronouns: 'he/him' | 'she/her' | 'they/them'
        description: string
        personality: string
        speakingStyle: string
        goals: string
        avatarImageData: string
        avatarCrop: { x: number; y: number; scale: number }
      }>
    }>
  },
})
