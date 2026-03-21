/**
 * src/types/electron.d.ts
 * Augments the global Window interface with the API surface exposed by the
 * Electron preload script via contextBridge.
 *
 * window.api is available in the renderer process only. It must NOT be
 * called from Node.js contexts (main process / preload internals).
 */

import type {
  AppSettings,
  AiDebugEntry,
  AvailableModel,
  BinaryInstallProgress,
  Campaign,
  CampaignFileHandle,
  CampaignSummary,
  CharacterProfile,
  ChatMessage,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeStatus,
  ModelDownloadProgress,
  ModelPreset,
  TokenUsage,
  WindowControlsState,
} from './index'

/** Callbacks passed to window.api.streamCompletion. */
interface StreamHandlers {
  /** Called once per streamed text token. */
  onToken: (chunk: string) => void
  /** Called if the server reports real token usage for the request. */
  onUsage?: (usage: TokenUsage) => void
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
       * Ask a configured server to load a model with the selected context size.
       * @param serverId - Server profile ID to control.
       * @param modelName - Exact upstream model name to load.
       * @param contextWindowTokens - Requested context window size in tokens.
       */
      loadModel: (serverId: string, modelName: string, contextWindowTokens: number) => Promise<void>

      /**
       * Read the detected local hardware inventory used for llama.cpp guidance.
       * @returns Promise resolving to the latest hardware summary.
       */
      getHardwareInfo: () => Promise<HardwareInfo>

      /**
       * Open a native folder picker for the local models directory.
       * @returns Promise resolving to the chosen directory, or null when cancelled.
       */
      pickModelsDirectory: () => Promise<string | null>

      /**
       * Open a native file picker for the llama-server executable.
       * @returns Promise resolving to the chosen executable, or null when cancelled.
       */
      pickLlamaExecutable: () => Promise<string | null>

      /**
       * Browse GGUF files in a Hugging Face repository.
       * @param serverId - Local llama.cpp server profile id.
       * @param repoId - Hugging Face repository identifier.
       */
      browseHuggingFaceModels: (serverId: string, repoId: string) => Promise<HuggingFaceModelFile[]>

      /**
       * Download a GGUF file from Hugging Face into the configured models directory.
       * @param serverId - Local llama.cpp server profile id.
       * @param repoId - Hugging Face repository identifier.
       * @param fileName - Repository-relative GGUF path.
       */
      downloadHuggingFaceModel: (serverId: string, repoId: string, fileName: string) => Promise<ModelPreset>

      /**
       * Subscribe to model download progress updates.
       * @param listener - Called whenever download progress changes.
       * @returns Cleanup function to remove the listener.
       */
      onModelDownloadProgress: (listener: (progress: ModelDownloadProgress) => void) => () => void

      /**
       * Read the current managed local llama.cpp runtime state.
       * @returns Promise resolving to the runtime status.
       */
      getLocalRuntimeStatus: () => Promise<LocalRuntimeStatus>

      /**
       * Start the managed local llama.cpp runtime for a selected model.
       * @param serverId - Local llama.cpp server profile id.
       * @param modelSlug - Local model slug to load.
       */
      loadLocalModel: (serverId: string, modelSlug: string) => Promise<LocalRuntimeStatus>

      /**
       * Stop the managed local llama.cpp runtime.
       */
      stopLocalModel: () => Promise<void>

      /**
       * Subscribe to local runtime status updates from the main process.
       * @param listener - Called whenever the runtime status changes.
       * @returns Cleanup function to remove the listener.
       */
      onLocalRuntimeStatus: (listener: (status: LocalRuntimeStatus) => void) => () => void

      /**
       * Read the current in-memory AI debug log.
       * @returns Promise resolving to the most recent AI debug entries.
       */
      getAiDebugLog: () => Promise<AiDebugEntry[]>

      /**
       * Clear the in-memory AI debug log.
       */
      clearAiDebugLog: () => Promise<void>

      /**
       * Append a renderer-originated AI debug entry to the shared log.
       * @param entry - Entry fields excluding the generated id.
       */
      appendAiDebugEntry: (entry: Omit<AiDebugEntry, 'id'>) => Promise<void>

      /**
       * Subscribe to AI debug events from the main process.
       * @param listener - Called whenever a new debug entry is recorded.
       * @returns Cleanup function to remove the listener.
       */
      onAiDebugEntry: (listener: (entry: AiDebugEntry) => void) => () => void

      /**
       * Check whether a usable llama-server binary exists for a local server profile.
       * @param serverId - Local llama.cpp server profile id.
       * @returns Detection result including found status, path, backend, and estimated size.
       */
      checkLlamaBinary: (serverId: string) => Promise<{
        found: boolean
        path: string | null
        detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
        estimatedSizeMb: number
      }>

      /**
       * Download and install the llama-server binary for a local server profile.
       * Progress is broadcast via onBinaryInstallProgress. Returns when complete or on error.
       * @param serverId - Local llama.cpp server profile id.
       * @returns Result with success flag and resolved executable path.
       */
      installLlamaBinary: (serverId: string) => Promise<{
        success: boolean
        executablePath: string | null
        error?: string
      }>

      /**
       * Subscribe to binary install progress updates from the main process.
       * @param listener - Called whenever install progress changes.
       * @returns Cleanup function to remove the listener.
       */
      onBinaryInstallProgress: (listener: (progress: BinaryInstallProgress) => void) => () => void

      /**
       * Create a new campaign folder and initial campaign.json payload.
       * @param name - Human-readable campaign name.
       * @param description - Short campaign description.
       * @returns Promise resolving to the saved campaign and folder path.
       */
      createCampaign: (name: string, description: string) => Promise<CampaignFileHandle>

      /**
       * Load the list of saved campaigns from the app-managed campaigns directory.
       * @returns Promise resolving to campaign summaries for the launcher.
       */
      listCampaigns: () => Promise<CampaignSummary[]>

      /**
       * Open a stored campaign by its folder path.
       * @param path - Absolute filesystem path of the campaign folder.
       * @returns Promise resolving to the loaded campaign and path.
       */
      openCampaign: (path: string) => Promise<CampaignFileHandle>

      /**
       * Open a native file picker for an existing campaign JSON file.
       * @returns Promise resolving to the selected campaign folder path, or null when cancelled.
       */
      pickCampaignFile: () => Promise<string | null>

      /**
       * Persist the current campaign to its JSON file.
       * @param path - Absolute path to the target campaign JSON file.
       * @param campaign - Full campaign payload to save.
       */
      saveCampaign: (path: string, campaign: Campaign) => Promise<void>

      /**
       * Load all stored characters for a campaign.
       * @param campaignPath - Absolute path to the active campaign folder.
       */
      listCharacters: (campaignPath: string) => Promise<CharacterProfile[]>

      /**
       * Create a new stored character folder within the active campaign.
       * @param campaignPath - Absolute path to the active campaign folder.
       * @param name - Human-readable character name.
       */
      createCharacter: (campaignPath: string, name: string) => Promise<CharacterProfile>

      /**
       * Persist a character profile to its character folder.
       * @param campaignPath - Absolute path to the active campaign folder.
       * @param character - Character profile to save.
       */
      saveCharacter: (campaignPath: string, character: CharacterProfile) => Promise<CharacterProfile>

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
