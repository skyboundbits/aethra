/**
 * src/App.tsx
 * Root application component for Aethra.
 *
 * Owns all top-level state:
 *   - sessions      : list of roleplay sessions
 *   - activeSession : which session is currently open
 *   - inputValue    : current text in the composer
 *   - isStreaming   : true while an AI response is in-flight
 *   - activeTab     : which ribbon nav tab is selected
 *
 * Renders the ribbon bar above the three-column floating layout:
 *   RibbonBar (top) | Sidebar | ChatArea + InputBar | DetailsPanel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import './styles/global.css'
import './styles/layout.css'

import { RibbonBar }    from './components/RibbonBar'
import { Sidebar }      from './components/Sidebar'
import { ChatArea }     from './components/ChatArea'
import { InputBar }     from './components/InputBar'
import { DetailsPanel } from './components/DetailsPanel'
import { SettingsModal } from './components/SettingsModal'
import { TitleBar } from './components/TitleBar'
import { CampaignLauncher } from './components/CampaignLauncher'
import { CreateCampaignModal } from './components/CreateCampaignModal'
import { CampaignModal } from './components/CampaignModal'
import { CharactersModal } from './components/CharactersModal'
import { AiDebugModal } from './components/AiDebugModal'
import { ModelLoaderModal } from './components/ModelLoaderModal'
import { ModelParametersModal } from './components/ModelParametersModal'
import { Modal } from './components/Modal'

import { streamCompletion } from './services/aiService'
import { estimateLocalModelFit } from './services/modelFitService'
import { buildCampaignBasePrompt, buildRollingSummarySystemPrompt } from './prompts/campaignPrompts'
import { applyTheme, parseImportedTheme, upsertCustomTheme } from './services/themeService'

import type {
  AppSettings,
  AvailableModel,
  AiDebugEntry,
  BinaryInstallProgress,
  Campaign,
  CampaignSummary,
  CharacterProfile,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeStatus,
  Message,
  ChatMessage,
  ModelDownloadProgress,
  ModelPreset,
  Session,
  TokenUsage,
} from './types'

const DEFAULT_SETTINGS: AppSettings = {
  servers: [],
  models: [],
  activeServerId: null,
  activeModelSlug: null,
  systemPrompt: 'You are a roleplaying agent responding naturally to the user.',
  enableRollingSummaries: false,
  chatTextSize: 'small',
  activeThemeId: 'default',
  customThemes: [],
}

/**
 * Generate a lightweight unique ID.
 * Combines a timestamp with a short random hex string.
 * (Replace with crypto.randomUUID() if broader support is needed.)
 */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

const AWAITING_PLAYER_ACTION_MARKER = '[System] Awaiting player action...'
const TRANSIENT_ERROR_MARKER = '[System Error]'
const LEGACY_STREAM_ERROR_MESSAGE = '⚠️ Could not reach the selected AI server. Check that it is running and the server address is correct.'
const MAX_UNTAGGED_ASSISTANT_ATTEMPTS = 3
const SUMMARY_RECENT_MESSAGE_COUNT = 10
const SUMMARY_IDLE_DELAY_MS = 1500
const SUMMARY_REBUILD_CONTEXT_FRACTION = 0.75

/**
 * Determine whether a message content string is the non-display placeholder
 * used to pause for player input.
 *
 * @param content - Message text to inspect.
 * @returns True when the content should be hidden and excluded from prompts.
 */
function isAwaitingPlayerActionMarker(content: string): boolean {
  return content.trim() === AWAITING_PLAYER_ACTION_MARKER
}

/**
 * Determine whether a message is a non-canonical renderer error that should
 * stay out of prompts and rolling summaries.
 *
 * @param content - Message text to inspect.
 * @returns True when the message should be excluded from context.
 */
function isTransientErrorMessage(content: string): boolean {
  const normalized = content.trim()
  return normalized === LEGACY_STREAM_ERROR_MESSAGE || normalized.startsWith(TRANSIENT_ERROR_MARKER)
}

/**
 * Remove hidden placeholder markers from a session transcript.
 *
 * @param messages - Internal message list.
 * @returns Only prompt-visible messages.
 */
function getVisiblePromptMessages(messages: Message[]): Message[] {
  return messages.filter((message) =>
    !isAwaitingPlayerActionMarker(message.content) && !isTransientErrorMessage(message.content),
  )
}

/**
 * Compute the live message window that should remain verbatim in the prompt.
 *
 * When rolling summaries are enabled, this returns the unsummarized tail plus
 * the latest recap window so no context is dropped while a background summary
 * job is still catching up.
 *
 * @param session - Session whose prompt window is being computed.
 * @param useRollingSummary - Whether summary-backed context is active.
 * @param pendingMessages - Optional messages not yet committed to session state.
 * @returns Messages to include verbatim in the outbound prompt.
 */
function getPromptWindowMessages(
  session: Session,
  useRollingSummary: boolean,
  pendingMessages: Message[] = [],
): Message[] {
  const visibleMessages = getVisiblePromptMessages([...session.messages, ...pendingMessages])
  if (!useRollingSummary) {
    return visibleMessages
  }

  const recentStartIndex = Math.max(visibleMessages.length - SUMMARY_RECENT_MESSAGE_COUNT, 0)
  const summarizedCount = session.rollingSummary.trim().length > 0
    ? Math.max(0, Math.floor(session.summarizedMessageCount))
    : 0
  const windowStartIndex = Math.min(summarizedCount, recentStartIndex)

  return visibleMessages.slice(windowStartIndex)
}

/**
 * Build the scene summary section for the prompt, when enabled.
 *
 * @param session - Active session.
 * @param useRollingSummary - Whether summary-backed context is active.
 * @returns Summary text or null when no summary should be sent.
 */
function getPromptSceneSummary(session: Session, useRollingSummary: boolean): string | null {
  if (!useRollingSummary || session.summarizedMessageCount <= 0) {
    return null
  }

  const normalizedSummary = session.rollingSummary.trim()
  return normalizedSummary.length > 0 ? normalizedSummary : null
}

/**
 * Convert internal Message array to the chat format expected by the AI service.
 * @param messages - Internal message list.
 */
function toApiMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((message) =>
      !isAwaitingPlayerActionMarker(message.content) && !isTransientErrorMessage(message.content),
    )
    .map((message) => ({
      role: message.role,
      content:
        message.role === 'user'
          ? `[${message.characterName?.trim() || 'Character'}] ${message.content}`
          : message.content,
    }))
}

/**
 * Build a readable default session title from the first user message.
 *
 * @param input - Raw user input.
 * @returns Trimmed single-line title.
 */
function buildSessionTitle(input: string): string {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0) return 'New Chat'
  return normalized.slice(0, 40)
}

/**
 * Build the deterministic system-message context sent with every request.
 *
 * @param campaign - Active campaign metadata.
 * @param characters - Characters available in the active campaign.
 * @param customSystemPrompt - User-configured system prompt text.
 * @param sceneSummary - Rolling scene summary, if one exists for the session.
 */
function buildSystemContext(
  campaign: Campaign,
  characters: CharacterProfile[],
  customSystemPrompt: string,
  sceneSummary: string | null,
): ChatMessage[] {
  const baseInstruction: ChatMessage = {
    role: 'system',
    content: buildCampaignBasePrompt(),
  }

  const customInstruction = customSystemPrompt.trim()
    ? `Additional Instructions:\n${customSystemPrompt.trim()}`
    : null

  const campaignContext: ChatMessage = {
    role: 'system',
    content: `Campaign: ${campaign.name}. Setting: ${campaign.description || 'No campaign setting provided.'}`,
  }

  const charactersContext: ChatMessage = {
    role: 'system',
    content: characters.length > 0
      ? `Characters:\n\n${characters.map((character) => {
        const sections = [
          character.name,
          `Role: ${character.role || 'Unspecified'}`,
          `Gender: ${character.gender || 'Unspecified'}`,
          `Pronouns: ${character.pronouns || 'Unspecified'}`,
          `Personality: ${character.personality || 'Unspecified'}`,
        ]

        if (character.description) {
          sections.push(`Description: ${character.description}`)
        }

        if (character.speakingStyle) {
          sections.push(`Speaking Style: ${character.speakingStyle}`)
        }

        if (character.goals) {
          sections.push(`Goals: ${character.goals}`)
        }

        return sections.join('\n')
      }).join('\n\n')}\n\nCharacter Control:\n${characters.map((character) => {
        const controllerLabel = character.controlledBy === 'user'
          ? 'PLAYER'
          : 'AI'

        return `${character.name}=${controllerLabel}`
      }).join('\n')}`
      : 'Characters:\n\nNo campaign characters have been created yet.',
  }

  const summaryContext = sceneSummary
    ? `Scene Summary:\n${sceneSummary}\n\nTreat the scene summary as compressed canon for older events. Maintain continuity with it, and let the recent chat history below take priority if there is a direct conflict.`
    : null

  // Merge all system context into a single message so models that enforce
  // "system message must be at the beginning" (e.g. Qwen3.5) don't reject the request.
  return [{
    role: 'system',
    content: [
      baseInstruction.content,
      customInstruction,
      campaignContext.content,
      charactersContext.content,
      summaryContext,
    ].filter((section): section is string => Boolean(section)).join('\n\n'),
  }]
}

/**
 * Estimate token usage for the outbound request payload.
 * This is a rough UI hint, not an exact tokenizer count.
 *
 * @param messages - Full prompt payload that will be sent to the model.
 */
function estimateTokenCount(messages: ChatMessage[]): number {
  const serialized = messages
    .map((message) => `${message.role}:${message.content}`)
    .join('\n')

  return Math.max(1, Math.ceil(serialized.length / 4))
}

/** Snapshot of a pending background summary update. */
interface SessionSummarySnapshot {
  /** Session being summarized. */
  sessionId: string
  /** Existing summary text, if any. */
  previousSummary: string
  /** Message count already represented by the existing summary. */
  baseSummarizedCount: number
  /** Target archived message count after this pass completes. */
  nextSummarizedCount: number
  /** Transcript slice newly being compressed into the summary. */
  transcript: Message[]
}

/**
 * Build the outbound prompt payload for a session.
 *
 * @param campaign - Active campaign metadata.
 * @param characters - Characters available in the campaign.
 * @param settings - Current persisted app settings.
 * @param session - Session being sent to the model.
 * @param pendingMessages - Optional messages not yet written into session state.
 * @returns Full chat payload for the model.
 */
function buildRequestMessages(
  campaign: Campaign,
  characters: CharacterProfile[],
  settings: AppSettings,
  session: Session,
  pendingMessages: Message[] = [],
): ChatMessage[] {
  return [
    ...buildSystemContext(
      campaign,
      characters,
      settings.systemPrompt,
      getPromptSceneSummary(session, settings.enableRollingSummaries),
    ),
    ...toApiMessages(getPromptWindowMessages(session, settings.enableRollingSummaries, pendingMessages)),
  ]
}

/**
 * Determine whether a session currently has enough archived content to summarize.
 *
 * @param session - Session candidate.
 * @returns Snapshot describing the next summary pass, or null when no work is needed.
 */
function createSessionSummarySnapshot(session: Session): SessionSummarySnapshot | null {
  const visibleMessages = getVisiblePromptMessages(session.messages)
  const nextSummarizedCount = Math.max(visibleMessages.length - SUMMARY_RECENT_MESSAGE_COUNT, 0)
  const currentSummary = session.rollingSummary.trim()
  const baseSummarizedCount = currentSummary.length > 0
    ? Math.max(0, Math.min(session.summarizedMessageCount, nextSummarizedCount))
    : 0

  if (nextSummarizedCount <= baseSummarizedCount) {
    return null
  }

  const transcript = visibleMessages.slice(baseSummarizedCount, nextSummarizedCount)
  if (transcript.length === 0) {
    return null
  }

  return {
    sessionId: session.id,
    previousSummary: currentSummary,
    baseSummarizedCount,
    nextSummarizedCount,
    transcript,
  }
}

/**
 * Build the dedicated prompt used to refresh a rolling scene summary.
 *
 * @param snapshot - Archived transcript slice being summarized.
 * @returns Chat payload for the background summary request.
 */
function buildSummaryMessages(snapshot: SessionSummarySnapshot): ChatMessage[] {
  return buildRollingSummaryUpdateMessages(snapshot.previousSummary, snapshot.transcript)
}

/**
 * Convert a transcript slice into the compact speaker-tagged format used by
 * summary prompts.
 *
 * @param transcript - Messages to serialize.
 * @returns Plain-text transcript block.
 */
function formatSummaryTranscript(transcript: Message[]): string {
  return transcript
    .map((message) => {
      const speaker = message.role === 'user'
        ? message.characterName?.trim() || 'Player'
        : message.characterName?.trim() || 'Assistant'

      return `[${speaker}] ${message.content}`
    })
    .join('\n')
}

/**
 * Build the dedicated prompt used to update a rolling summary from transcript.
 *
 * @param previousSummary - Existing summary text, if any.
 * @param transcript - Transcript slice to merge.
 * @param retryReason - Optional correction note when a prior attempt returned transcript-like output.
 * @returns Chat payload for the summary request.
 */
function buildRollingSummaryUpdateMessages(
  previousSummary: string,
  transcript: Message[],
  retryReason?: string,
): ChatMessage[] {
  const normalizedSummary = previousSummary.trim()
  const transcriptBlock = formatSummaryTranscript(transcript)
  const correctionNote = retryReason ? `Correction:\n${retryReason}` : null

  return [
    {
      role: 'system',
      content: buildRollingSummarySystemPrompt(),
    },
    {
      role: 'user',
      content: `Previous summary:
${normalizedSummary.length > 0 ? normalizedSummary : 'No prior summary.'}

New transcript to merge into the summary:
${transcriptBlock}

${correctionNote ? `${correctionNote}\n\n` : ''}Return the updated rolling scene summary only.`,
    },
  ]
}

/**
 * Detect transcript-like model output that should not be stored as a summary.
 *
 * @param summary - Candidate summary text returned by the model.
 * @returns True when the output looks like copied chat lines rather than a summary.
 */
function isTranscriptLikeSummary(summary: string): boolean {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return true
  }

  const speakerTaggedLines = lines.filter((line) => /^\[[^\]\r\n]+\]\s+/.test(line)).length
  if (speakerTaggedLines > 0 && speakerTaggedLines >= Math.ceil(lines.length * 0.4)) {
    return true
  }

  const chatPrefixLines = lines.filter((line) => /^(user|assistant|player|scene)\s*:/i.test(line)).length
  if (chatPrefixLines > 0 && chatPrefixLines >= Math.ceil(lines.length * 0.4)) {
    return true
  }

  return false
}

/**
 * Request a rolling summary update, retrying once if the model returns
 * transcript-style output instead of an actual summary.
 *
 * @param previousSummary - Existing accumulated summary text.
 * @param transcript - Transcript slice to merge.
 * @returns Validated summary text.
 */
async function requestRollingSummary(previousSummary: string, transcript: Message[]): Promise<string> {
  let retryReason: string | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let nextSummary = ''
    await new Promise<void>((resolve, reject) => {
      streamCompletion(
        buildRollingSummaryUpdateMessages(previousSummary, transcript, retryReason),
        (chunk) => {
          nextSummary += chunk
        },
        null,
        resolve,
        reject,
      )
    })

    const normalizedSummary = nextSummary.trim()
    if (!normalizedSummary) {
      throw new Error('The model returned an empty summary.')
    }

    if (!isTranscriptLikeSummary(normalizedSummary)) {
      return normalizedSummary
    }

    retryReason = 'The last attempt copied chat lines. Rewrite it as an actual summary, not a transcript.'
  }

  throw new Error('The model kept returning transcript-style output instead of a summary.')
}

/**
 * Find the largest transcript chunk starting at a given index that should fit
 * in a summary request budget.
 *
 * @param messages - Visible transcript messages in chronological order.
 * @param startIndex - Inclusive start index for the chunk.
 * @param previousSummary - Current accumulated summary text.
 * @param transcriptBudget - Maximum prompt size for the summary request.
 * @returns Exclusive end index for the selected chunk.
 */
function findSummaryChunkEnd(
  messages: Message[],
  startIndex: number,
  previousSummary: string,
  transcriptBudget: number,
): number {
  let endIndex = startIndex + 1

  while (endIndex <= messages.length) {
    const prompt = buildRollingSummaryUpdateMessages(previousSummary, messages.slice(startIndex, endIndex))
    if (estimateTokenCount(prompt) > transcriptBudget) {
      return endIndex === startIndex + 1 ? endIndex : endIndex - 1
    }

    endIndex += 1
  }

  return messages.length
}

/** Parsed assistant bubble content plus optional speaker metadata. */
interface StreamedAssistantBubble {
  /** Bubble text, including the raw `[Character]` marker for debugging. */
  content: string
  /** Parsed speaker name from the leading marker, if present. */
  characterName?: string
}

/**
 * Split a streamed assistant reply into discrete bubble payloads.
 * Each bracketed entry like `[Name]` starts a new bubble, while the
 * marker text itself is preserved for debugging. Consecutive entries from the
 * same character remain grouped in a single bubble. PLAYER-controlled
 * characters are ignored until the next bracketed marker appears.
 *
 * @param content - Full accumulated assistant text received so far.
 * @param playerControlledNames - Character names controlled by the player.
 * @returns Ordered bubble payloads to render as separate assistant messages.
 */
function splitStreamedAssistantBubbles(
  content: string,
  playerControlledNames: Set<string>,
): StreamedAssistantBubble[] {
  if (content.length === 0) {
    return [{ content: '' }]
  }

  const segments: StreamedAssistantBubble[] = []
  const markerRegex = /\[[^\]\r\n]+\]/g
  let previousIndex = 0
  let match = markerRegex.exec(content)
  let previousSpeaker: string | null = null

  while (match) {
    if (match.index > previousIndex) {
      const leading = content.slice(previousIndex, match.index)
      if (leading.trim().length > 0) {
        segments.push({ content: leading })
      } else if (segments.length > 0) {
        segments[segments.length - 1].content += leading
      }
    }

    const nextMatch = markerRegex.exec(content)
    const segmentEnd = nextMatch ? nextMatch.index : content.length
    const segment = content.slice(match.index, segmentEnd)
    const speaker = match[0].slice(1, -1).trim() || null
    const normalizedSpeaker = speaker?.toLocaleLowerCase() ?? null

    if (isAwaitingPlayerActionMarker(segment)) {
      previousSpeaker = null
      previousIndex = segmentEnd
      match = nextMatch
      continue
    }

    if (normalizedSpeaker && playerControlledNames.has(normalizedSpeaker)) {
      previousSpeaker = null
      previousIndex = segmentEnd
      match = nextMatch
      continue
    }

    if (speaker && speaker === previousSpeaker && segments.length > 0) {
      segments[segments.length - 1].content += segment
    } else {
      segments.push({
        content: segment,
        characterName: speaker ?? undefined,
      })
    }

    previousSpeaker = speaker
    previousIndex = segmentEnd
    match = nextMatch
  }

  if (previousIndex < content.length) {
    const trailing = content.slice(previousIndex)
    if (segments.length === 0 || trailing.trim().length > 0) {
      segments.push({ content: trailing })
    } else {
      segments[segments.length - 1].content += trailing
    }
  }

  return segments.length > 0 ? segments : [{ content: '' }]
}

/**
 * Determine whether a streamed assistant reply contains at least one
 * non-player speaker tag that can be rendered as a named bubble.
 *
 * @param bubbles - Parsed streamed assistant bubble payloads.
 * @returns True when a valid character tag is present.
 */
function hasNamedAssistantBubble(bubbles: StreamedAssistantBubble[]): boolean {
  return bubbles.some((bubble) => typeof bubble.characterName === 'string' && bubble.characterName.trim().length > 0)
}

/**
 * Capture avatar fields directly on a message so rendering stays stable across reloads.
 *
 * @param character - Character supplying the avatar snapshot, if any.
 * @returns Message fields containing avatar image and crop snapshots.
 */
function getMessageAvatarSnapshot(character: CharacterProfile | null): Pick<Message, 'characterAvatarImageData' | 'characterAvatarCrop'> {
  return {
    characterAvatarImageData: character?.avatarImageData ?? undefined,
    characterAvatarCrop: character?.avatarImageData
      ? { ...character.avatarCrop }
      : undefined,
  }
}

/**
 * Attach the best available character identity and avatar snapshot to one message.
 *
 * @param message - Message to hydrate.
 * @param charactersById - Character lookup by ID.
 * @param charactersByName - Character lookup by normalized name.
 * @returns Original message when unchanged, otherwise a hydrated copy.
 */
function hydrateMessageAvatar(
  message: Message,
  charactersById: Map<string, CharacterProfile>,
  charactersByName: Map<string, CharacterProfile>,
): Message {
  const matchedCharacter =
    (message.characterId ? charactersById.get(message.characterId) : undefined) ??
    (message.characterName
      ? charactersByName.get(message.characterName.trim().toLocaleLowerCase())
      : undefined) ??
    null

  if (!matchedCharacter) {
    return message
  }

  const nextCharacterId = message.characterId ?? matchedCharacter.id
  const nextAvatarImageData = matchedCharacter.avatarImageData ?? undefined
  const nextAvatarCrop = matchedCharacter.avatarImageData
    ? { ...matchedCharacter.avatarCrop }
    : undefined
  const hasSameCrop =
    message.characterAvatarCrop?.x === nextAvatarCrop?.x &&
    message.characterAvatarCrop?.y === nextAvatarCrop?.y &&
    message.characterAvatarCrop?.scale === nextAvatarCrop?.scale

  if (
    message.characterId === nextCharacterId &&
    message.characterAvatarImageData === nextAvatarImageData &&
    hasSameCrop
  ) {
    return message
  }

  return {
    ...message,
    characterId: nextCharacterId,
    characterAvatarImageData: nextAvatarImageData,
    characterAvatarCrop: nextAvatarCrop,
  }
}

/**
 * Reattach character IDs and avatar snapshots to loaded messages using the
 * active campaign character roster.
 *
 * @param campaign - Campaign whose session messages should be hydrated.
 * @param characters - Character roster available for matching.
 * @returns Campaign copy with message avatar metadata filled where possible.
 */
function hydrateCampaignMessageAvatars(campaign: Campaign, characters: CharacterProfile[]): Campaign {
  if (characters.length === 0) {
    return campaign
  }

  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const charactersByName = new Map(
    characters.map((character) => [character.name.trim().toLocaleLowerCase(), character]),
  )

  let didChange = false
  const nextSessions = campaign.sessions.map((session) => {
    let sessionChanged = false
    const nextMessages = session.messages.map((message) => {
      const nextMessage = hydrateMessageAvatar(message, charactersById, charactersByName)
      if (nextMessage !== message) {
        sessionChanged = true
      }
      return nextMessage
    })

    if (!sessionChanged) {
      return session
    }

    didChange = true
    return {
      ...session,
      messages: nextMessages,
    }
  })

  return didChange
    ? {
      ...campaign,
      sessions: nextSessions,
    }
    : campaign
}

/**
 * App
 * Top-level component that wires together all panels and manages state.
 */
export default function App() {
  /* ── State ──────────────────────────────────────────────────────────── */

  /** Active campaign currently open in the workspace. */
  const [campaign, setCampaign] = useState<Campaign | null>(null)

  /** Absolute path of the active campaign folder. */
  const [campaignPath, setCampaignPath] = useState<string | null>(null)

  /** ID of the session currently displayed in the chat area. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  /** Controlled value for the message composer textarea. */
  const [inputValue, setInputValue] = useState('')

  /** Incremented when the composer should reclaim keyboard focus. */
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0)

  /** True while a streaming AI response is in-flight. */
  const [isStreaming, setIsStreaming] = useState(false)

  /** Currently active ribbon navigation tab. */
  const [activeTab, setActiveTab] = useState('campaign')

  /** Persisted app settings loaded from Electron. */
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  /**
   * Ref that always holds the latest appSettings value, used by event listeners
   * registered in empty-dep useEffects to avoid stale closure issues.
   */
  const appSettingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  /** Ref holding the latest active campaign for background summary jobs. */
  const campaignRef = useRef<Campaign | null>(null)
  /** Ref holding the latest character list for prompt assembly outside render. */
  const charactersRef = useRef<CharacterProfile[]>([])
  /** Ref holding the current streaming state for idle summary scheduling. */
  const isStreamingRef = useRef(false)
  /** Per-session delayed summary timers. */
  const summaryTimeoutsRef = useRef<Record<string, number | undefined>>({})
  /** Sessions currently being summarized in the background. */
  const summaryInFlightRef = useRef<Set<string>>(new Set())
  /** Sessions that should be summarized again after the current pass finishes. */
  const summaryRerunRef = useRef<Set<string>>(new Set())

  /** Detected local hardware inventory used for llama.cpp fit guidance. */
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null)

  /** Current managed local llama.cpp runtime status. */
  const [localRuntimeStatus, setLocalRuntimeStatus] = useState<LocalRuntimeStatus | null>(null)

  /** Most recent Hugging Face model download progress update. */
  const [modelDownloadProgress, setModelDownloadProgress] = useState<ModelDownloadProgress | null>(null)

  /** Current binary installation progress (llama-server or similar). */
  const [binaryInstallProgress, setBinaryInstallProgress] = useState<BinaryInstallProgress | null>(null)

  /** Binary check result populated when the model loader modal opens (llama.cpp servers only). */
  const [modelLoaderBinaryCheck, setModelLoaderBinaryCheck] = useState<{
    found: boolean
    detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
    estimatedSizeMb: number
  } | null>(null)

  /** GGUF files currently listed from the selected Hugging Face repository. */
  const [huggingFaceFiles, setHuggingFaceFiles] = useState<HuggingFaceModelFile[]>([])

  /** True while browsing the currently entered Hugging Face repository. */
  const [isBrowsingHuggingFace, setIsBrowsingHuggingFace] = useState(false)

  /** True while downloading a Hugging Face GGUF file. */
  const [isDownloadingModel, setIsDownloadingModel] = useState(false)

  /** True while the settings modal is open. */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  /** True while the system prompt editor modal is open. */
  const [isCharactersOpen, setIsCharactersOpen] = useState(false)
  /** True while the current session summary modal is open. */
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
  /** True while the current summary is being rebuilt manually. */
  const [isRebuildingSummary, setIsRebuildingSummary] = useState(false)
  /** Status note shown inside the summary modal. */
  const [summaryModalStatusMessage, setSummaryModalStatusMessage] = useState<string | null>(null)
  /** Visual state of the summary modal status note. */
  const [summaryModalStatusKind, setSummaryModalStatusKind] = useState<'error' | 'success' | null>(null)

  /** Status message shown in the settings modal. */
  const [settingsStatusMessage, setSettingsStatusMessage] = useState<string | null>(null)

  /** Visual state of the settings modal status message. */
  const [settingsStatusKind, setSettingsStatusKind] = useState<'error' | 'success' | null>(null)

  /** Models discovered live from the active server in the settings UI. */
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])

  /** True while fetching the remote model catalog from the active server. */
  const [isBrowsingModels, setIsBrowsingModels] = useState(false)

  /** True while a campaign file operation is in progress. */
  const [isCampaignBusy, setIsCampaignBusy] = useState(false)

  /** Status message shown in the campaign launcher. */
  const [campaignStatusMessage, setCampaignStatusMessage] = useState<string | null>(null)

  /** Campaign summaries available to open from the launcher. */
  const [availableCampaigns, setAvailableCampaigns] = useState<CampaignSummary[]>([])

  /** Characters available for the active campaign. */
  const [characters, setCharacters] = useState<CharacterProfile[]>([])

  /** Currently selected character in the characters modal. */
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null)

  /** Currently selected character in the message composer dropdown. */
  const [composerCharacterId, setComposerCharacterId] = useState<string | null>(null)

  /** Last exact token usage reported by the AI server, if available. */
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null)

  /** Message currently awaiting delete confirmation. */
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null)
  /** Session currently awaiting delete confirmation. */
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)

  /** Status message shown in the characters modal. */
  const [charactersStatusMessage, setCharactersStatusMessage] = useState<string | null>(null)

  /** Visual state of the characters modal status message. */
  const [charactersStatusKind, setCharactersStatusKind] = useState<'error' | 'success' | null>(null)

  /** True while a character file operation is in progress. */
  const [isCharactersBusy, setIsCharactersBusy] = useState(false)

  /** True while the create campaign modal is open. */
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false)
  /** True while the campaign management modal is open. */
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false)
  /** True while the model loader modal is open. */
  const [isModelLoaderOpen, setIsModelLoaderOpen] = useState(false)
  /** True while the runtime model parameters modal is open. */
  const [isModelParametersOpen, setIsModelParametersOpen] = useState(false)
  /** True while a remote model load request is in flight. */
  const [isModelLoading, setIsModelLoading] = useState(false)
  /** True while runtime model parameters are being saved. */
  const [isModelParametersSaving, setIsModelParametersSaving] = useState(false)
  /** Status message shown in the model loader modal. */
  const [modelLoaderStatusMessage, setModelLoaderStatusMessage] = useState<string | null>(null)
  /** Visual state of the model loader status message. */
  const [modelLoaderStatusKind, setModelLoaderStatusKind] = useState<'error' | 'success' | null>(null)
  /** Status message shown in the model parameters modal. */
  const [modelParametersStatusMessage, setModelParametersStatusMessage] = useState<string | null>(null)
  /** Visual state of the model parameters status message. */
  const [modelParametersStatusKind, setModelParametersStatusKind] = useState<'error' | 'success' | null>(null)
  const [isAiDebugOpen, setIsAiDebugOpen] = useState(false)
  const [aiDebugEntries, setAiDebugEntries] = useState<AiDebugEntry[]>([])

  /** Last campaign object that was successfully saved to disk. */
  const lastSavedCampaignRef = useRef<Campaign | null>(null)

  /**
   * Load persisted settings on first render.
   */
  useEffect(() => {
    let cancelled = false

    /**
     * Read settings from the main process and seed local state.
     */
    async function loadSettings(): Promise<void> {
      try {
        const settings = await window.api.getSettings()
        if (!cancelled) {
          setAppSettings(settings)
        }
      } catch (err) {
        console.error('[Aethra] Could not load app settings:', err)
        if (!cancelled) {
          setSettingsStatusKind('error')
          setSettingsStatusMessage('Could not load settings. Using in-memory defaults.')
        }
      }
    }

    loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Load local hardware details and subscribe to managed llama.cpp runtime updates.
   */
  useEffect(() => {
    let cancelled = false

    void window.api.getHardwareInfo()
      .then((info) => {
        if (!cancelled) {
          setHardwareInfo(info)
        }
      })
      .catch((err) => {
        console.error('[Aethra] Could not detect local hardware:', err)
      })

    void window.api.getLocalRuntimeStatus()
      .then((status) => {
        if (!cancelled) {
          setLocalRuntimeStatus(status)
        }
      })
      .catch((err) => {
        console.error('[Aethra] Could not read local runtime status:', err)
      })

    const disposeRuntimeListener = window.api.onLocalRuntimeStatus((status) => {
      setLocalRuntimeStatus(status)
    })
    const disposeDownloadListener = window.api.onModelDownloadProgress((progress) => {
      setModelDownloadProgress(progress)
      if (progress.status === 'completed' || progress.status === 'error') {
        setIsDownloadingModel(false)
      }
    })
    const disposeBinaryInstallListener = window.api.onBinaryInstallProgress((progress) => {
      setBinaryInstallProgress(progress)
      if (progress.status === 'complete') {
        const currentSettings = appSettingsRef.current
        const server = currentSettings.servers.find((s) => s.id === currentSettings.activeServerId)
        if (server?.kind === 'llama.cpp') {
          window.api.checkLlamaBinary(server.id)
            .then((result) => { setModelLoaderBinaryCheck(result) })
            .catch(() => {})
        }
      }
    })

    return () => {
      cancelled = true
      disposeRuntimeListener()
      disposeDownloadListener()
      disposeBinaryInstallListener()
    }
  }, [])

  // Keep the settings ref in sync so event listeners in empty-dep useEffects can read current values.
  appSettingsRef.current = appSettings
  campaignRef.current = campaign
  charactersRef.current = characters
  isStreamingRef.current = isStreaming

  /**
   * Apply the currently active theme whenever theme settings change.
   */
  useEffect(() => {
    applyTheme(appSettings.activeThemeId, appSettings.customThemes)
  }, [appSettings.activeThemeId, appSettings.customThemes])

  /**
   * Load the stored campaign catalog for the launcher on first render.
   */
  useEffect(() => {
    void refreshCampaigns()
  }, [])

  /**
   * Load campaign-scoped characters whenever the active campaign path changes.
   */
  useEffect(() => {
    if (!campaignPath) {
      setCharacters([])
      setActiveCharacterId(null)
      setComposerCharacterId(null)
      return
    }

    void refreshCharacters(campaignPath)
  }, [campaignPath])

  /* ── Derived values ─────────────────────────────────────────────────── */

  /** All roleplay sessions available in the sidebar. */
  const sessions = campaign?.sessions ?? []

  /** The full session object for the active session (or null). */
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  /** Messages belonging to the active session. */
  const messages: Message[] = activeSession?.messages ?? []

  /** The character currently selected for the next outgoing user message. */
  const composerCharacter =
    characters.find((character) => character.id === composerCharacterId) ?? null

  /** The currently selected AI server from persisted settings. */
  const activeServer =
    appSettings.servers.find((server) => server.id === appSettings.activeServerId) ??
    appSettings.servers[0] ??
    null

  /** Model presets available for the active server. */
  const activeServerModels: ModelPreset[] = activeServer
    ? appSettings.models.filter((model) => model.serverId === activeServer.id)
    : []

  /** True when the selected server supports explicit model load actions. */
  const canLoadModel = activeServer?.kind === 'text-generation-webui' || activeServer?.kind === 'llama.cpp'

  /** True when the selected server is the managed local llama.cpp provider. */
  const isLocalLlamaActive = activeServer?.kind === 'llama.cpp'

  /** The currently selected AI model from persisted settings. */
  const activeModel =
    activeServerModels.find((model) => model.slug === appSettings.activeModelSlug) ??
    activeServerModels[0] ??
    null

  /** True when runtime parameters can be edited for the active model preset. */
  const canEditModelParameters = activeModel !== null

  /** Heuristic GPU fit guidance for the active local model, when applicable. */
  const activeLocalModelFit = useMemo(
    () => isLocalLlamaActive
      ? estimateLocalModelFit(activeModel, hardwareInfo, activeModel?.contextWindowTokens ?? null)
      : null,
    [activeModel, hardwareInfo, isLocalLlamaActive],
  )

  /** Stable system-context payload for the active campaign. */
  const systemContextMessages = useMemo(() => {
    if (!campaign || !activeSession) {
      return []
    }

    return buildSystemContext(
      campaign,
      characters,
      appSettings.systemPrompt,
      getPromptSceneSummary(activeSession, appSettings.enableRollingSummaries),
    )
  }, [
    activeSession,
    appSettings.enableRollingSummaries,
    appSettings.systemPrompt,
    campaign,
    characters,
  ])

  /** Stable chat-history payload for the active session. */
  const apiMessages = useMemo(() => {
    if (!activeSession) {
      return []
    }

    return toApiMessages(getPromptWindowMessages(activeSession, appSettings.enableRollingSummaries))
  }, [activeSession, appSettings.enableRollingSummaries])

  /** Approximate tokens used by the current outbound prompt. */
  const estimatedPromptTokens = useMemo(
    () => estimateTokenCount([...systemContextMessages, ...apiMessages]),
    [apiMessages, systemContextMessages],
  )

  /** Tokens shown in the UI, preferring full request usage from the last completed response. */
  const usedTokens = lastTokenUsage?.totalTokens ?? estimatedPromptTokens

  /** Remaining context budget for the selected model, if known. */
  const remainingTokens = activeModel?.contextWindowTokens
    ? Math.max(activeModel.contextWindowTokens - usedTokens, 0)
    : null

  /** Total context window for the selected model, if known. */
  const totalContextTokens = activeModel?.contextWindowTokens ?? null

  /** True when the used token count came from the API server. */
  const usedTokensIsExact = lastTokenUsage !== null

  /** True when remaining tokens are based on model-reported prompt usage. */
  const remainingTokensIsExact = lastTokenUsage !== null && remainingTokens !== null

  /**
   * Keep the temporary discovered model list scoped to the current server.
   */
  useEffect(() => {
    setAvailableModels((prev) =>
      activeServer ? prev.filter((model) => model.serverId === activeServer.id) : [],
    )
    setHuggingFaceFiles([])
  }, [activeServer?.id])

  /**
   * Keep a live renderer-side mirror of the AI debug log.
   */
  useEffect(() => {
    void window.api.getAiDebugLog()
      .then((entries) => {
        setAiDebugEntries(entries)
      })
      .catch((err) => {
        console.error('[Aethra] Could not load AI debug log:', err)
      })

    return window.api.onAiDebugEntry((entry) => {
      setAiDebugEntries((prev) => {
        const nextEntries = [...prev, entry]
        return nextEntries.length > 200 ? nextEntries.slice(nextEntries.length - 200) : nextEntries
      })
    })
  }, [])

  /**
   * Clear exact usage whenever the active prompt context changes outside a completed request.
   */
  useEffect(() => {
    setLastTokenUsage(null)
  }, [activeSessionId, campaignPath, activeModel?.id, campaign?.id, characters])

  /**
   * Cancel delayed summary work whenever rolling summaries are disabled.
   */
  useEffect(() => {
    if (appSettings.enableRollingSummaries) {
      return
    }

    for (const sessionId of Object.keys(summaryTimeoutsRef.current)) {
      clearSummaryTimer(sessionId)
    }
    summaryRerunRef.current.clear()
  }, [appSettings.enableRollingSummaries])

  /**
   * Clean up background summary timers when the app unmounts.
   */
  useEffect(() => {
    return () => {
      for (const sessionId of Object.keys(summaryTimeoutsRef.current)) {
        const timerId = summaryTimeoutsRef.current[sessionId]
        if (typeof timerId === 'number') {
          window.clearTimeout(timerId)
        }
      }
    }
  }, [])

  /**
   * Keep the composer character valid as the campaign character list changes.
   * Prefer a player-controlled character, then fall back to none.
   */
  useEffect(() => {
    if (characters.length === 0) {
      if (composerCharacterId !== null) {
        setComposerCharacterId(null)
      }
      return
    }

    const stillExists = characters.some((character) => character.id === composerCharacterId)
    if (stillExists) {
      return
    }

    const defaultCharacter =
      characters.find((character) => character.controlledBy === 'user') ?? null

    setComposerCharacterId(defaultCharacter?.id ?? null)
  }, [characters, composerCharacterId])

  /**
   * Keep the active session selection valid whenever the campaign changes.
   */
  useEffect(() => {
    if (!campaign) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      return
    }

    if (campaign.sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      return
    }

    const hasActiveSession = campaign.sessions.some((session) => session.id === activeSessionId)
    if (!hasActiveSession) {
      setActiveSessionId(campaign.sessions[0].id)
    }
  }, [activeSessionId, campaign])

  /**
   * Rebuild missing avatar data whenever a session is opened for display.
   */
  useEffect(() => {
    if (!campaign || !activeSessionId || characters.length === 0) {
      return
    }

    setCampaign((prev) => {
      if (!prev) {
        return prev
      }

      const nextCampaign = hydrateCampaignMessageAvatars(prev, characters)
      return nextCampaign
    })
  }, [activeSessionId, campaign, characters])

  /**
   * Autosave the active campaign whenever its contents change after load.
   */
  useEffect(() => {
    if (!campaign || !campaignPath) {
      return
    }

    if (lastSavedCampaignRef.current === campaign) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void window.api.saveCampaign(campaignPath, campaign)
        .then(() => {
          lastSavedCampaignRef.current = campaign
        })
        .catch((err) => {
          console.error('[Aethra] Could not save campaign:', err)
          setCampaignStatusMessage('Could not save the active campaign.')
        })
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [campaign, campaignPath])

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  /**
   * Replace the current campaign with an updated copy and refresh metadata.
   *
   * @param updater - Receives the previous campaign and returns the next one.
   */
  function updateCampaign(updater: (prev: Campaign) => Campaign): void {
    setCampaign((prev) => {
      if (!prev) {
        return prev
      }

      const nextCampaign = updater(prev)
      return {
        ...nextCampaign,
        updatedAt: Date.now(),
      }
    })
  }

  /**
   * Refresh the stored campaign catalog shown in the launcher.
   */
  async function refreshCampaigns(): Promise<void> {
    try {
      const campaigns = await window.api.listCampaigns()
      setAvailableCampaigns(campaigns)
    } catch (err) {
      console.error('[Aethra] Could not list campaigns:', err)
      setCampaignStatusMessage('Could not load saved campaigns.')
    }
  }

  /**
   * Refresh the stored characters for the active campaign.
   *
   * @param path - Absolute campaign folder path.
   */
  async function refreshCharacters(path: string): Promise<void> {
    try {
      const nextCharacters = await window.api.listCharacters(path)
      setCharacters(nextCharacters)
      setActiveCharacterId((prev) =>
        nextCharacters.some((character) => character.id === prev)
          ? prev
          : (nextCharacters[0]?.id ?? null),
      )
      setCampaign((prev) => prev ? hydrateCampaignMessageAvatars(prev, nextCharacters) : prev)
    } catch (err) {
      console.error('[Aethra] Could not load characters:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Could not load campaign characters.')
    }
  }

  /**
   * Append or update a message inside a specific session.
   * If a message with `msg.id` already exists it is replaced; otherwise appended.
   * @param sessionId - Target session.
   * @param msg       - Message to upsert.
   */
  function upsertMessage(sessionId: string, msg: Message): void {
    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const exists = s.messages.some((m) => m.id === msg.id)
        const messages = exists
          ? s.messages.map((m) => (m.id === msg.id ? msg : m))
          : [...s.messages, msg]
        return { ...s, messages, updatedAt: Date.now() }
      }),
    }))
  }

  /**
   * Replace the current streamed assistant bubble set with the latest segments.
   *
   * @param sessionId - Target session receiving the assistant reply.
   * @param messageIds - Stable IDs allocated for the streamed assistant bubbles.
   * @param contents - Bubble text content in visual order.
   * @param timestamp - Timestamp applied to all streamed assistant bubbles.
   */
  function syncStreamedAssistantMessages(
    sessionId: string,
    messageIds: string[],
    bubbles: StreamedAssistantBubble[],
    timestamp: number,
  ): void {
      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session
        }

        const keepMessages = session.messages.filter((message) => !messageIds.includes(message.id))
        const streamedMessages = bubbles.map((bubble, index) => {
          const matchedCharacter = bubble.characterName
            ? characters.find((character) => character.name === bubble.characterName) ?? null
            : null

          return {
            id: messageIds[index],
            role: 'assistant' as const,
            characterId: matchedCharacter?.id,
            characterName: bubble.characterName,
            ...getMessageAvatarSnapshot(matchedCharacter),
            content: bubble.content,
            timestamp,
          }
        })

        return {
          ...session,
          messages: [...keepMessages, ...streamedMessages],
          updatedAt: Date.now(),
        }
        }),
      }))

    }

  /**
   * Ensure there is an active session to receive messages.
   *
   * @returns Active session ID, creating a new session if necessary.
   */
  function ensureActiveSession(): string {
    if (activeSessionId) {
      return activeSessionId
    }

    const now = Date.now()
    const newSession: Session = {
      id: uid(),
      title: 'New Chat',
      messages: [],
      rollingSummary: '',
      summarizedMessageCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    updateCampaign((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
    }))
    setActiveSessionId(newSession.id)
    return newSession.id
  }

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty session, add it to the list, and make it active.
   */
  function handleNewSession(): void {
    const now = Date.now()
    const newSession: Session = {
      id:        uid(),
      title:     `Session ${sessions.length + 1}`,
      messages:  [],
      rollingSummary: '',
      summarizedMessageCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    updateCampaign((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
    }))
    setActiveSessionId(newSession.id)
  }

  /**
   * Switch the active session.
   * @param id - ID of the session to activate.
   */
  function handleSelectSession(id: string) {
    setActiveSessionId(id)
  }

  /**
   * Delete a session after explicit user confirmation.
   *
   * @param sessionId - ID of the session to remove.
   */
  function handleDeleteSession(sessionId: string): void {
    if (!campaign || isStreaming) {
      return
    }

    const sessionIndex = campaign.sessions.findIndex((session) => session.id === sessionId)
    if (sessionIndex === -1) {
      return
    }

    setPendingDeleteSessionId(sessionId)
  }

  /**
   * Close the session deletion confirmation dialog.
   */
  function handleCancelDeleteSession(): void {
    setPendingDeleteSessionId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Permanently delete the currently selected session.
   */
  function handleConfirmDeleteSession(): void {
    if (!campaign || !pendingDeleteSessionId || isStreaming) {
      return
    }

    const sessionIndex = campaign.sessions.findIndex((session) => session.id === pendingDeleteSessionId)
    if (sessionIndex === -1) {
      setPendingDeleteSessionId(null)
      return
    }

    const remainingSessions = campaign.sessions.filter((candidate) => candidate.id !== pendingDeleteSessionId)
    clearSummaryTimer(pendingDeleteSessionId)
    summaryInFlightRef.current.delete(pendingDeleteSessionId)
    summaryRerunRef.current.delete(pendingDeleteSessionId)

    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((candidate) => candidate.id !== pendingDeleteSessionId),
    }))

    if (activeSessionId === pendingDeleteSessionId) {
      const nextSession = remainingSessions[sessionIndex] ?? remainingSessions[sessionIndex - 1] ?? null
      setActiveSessionId(nextSession?.id ?? null)
    }

    setPendingDeleteSessionId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Delete a single message from the active session after explicit confirmation.
   *
   * @param messageId - ID of the message to remove.
   */
  function handleDeleteMessage(messageId: string): void {
    if (!activeSession || isStreaming) {
      return
    }

    const message = activeSession.messages.find((candidate) => candidate.id === messageId)
    if (!message) {
      return
    }

    setPendingDeleteMessageId(messageId)
  }

  /**
   * Close the message deletion confirmation dialog.
   */
  function handleCancelDeleteMessage(): void {
    setPendingDeleteMessageId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Permanently remove the currently selected message.
   */
  function handleConfirmDeleteMessage(): void {
    if (!activeSession || !pendingDeleteMessageId) {
      return
    }

    const messageId = pendingDeleteMessageId
    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== activeSession.id) {
          return session
        }

        const nextMessages = session.messages.filter((candidate) => candidate.id !== messageId)
        const firstUserMessage = nextMessages.find((candidate) => candidate.role === 'user')
        return {
          ...session,
          messages: nextMessages,
          title: firstUserMessage ? buildSessionTitle(firstUserMessage.content) : 'New Chat',
          rollingSummary: '',
          summarizedMessageCount: 0,
          updatedAt: Date.now(),
        }
        }),
      }))

    setPendingDeleteMessageId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Open the create campaign dialog.
   */
  function handleCreateCampaign(): void {
    setCampaignStatusMessage(null)
    setIsCampaignModalOpen(false)
    setIsCreateCampaignOpen(true)
  }

  /**
   * Create a new campaign from modal input and load it into the workspace.
   *
   * @param name - Campaign name entered by the user.
   * @param description - Campaign description entered by the user.
   */
  async function handleCreateCampaignSubmit(name: string, description: string): Promise<void> {
    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)

    try {
      const created = await window.api.createCampaign(name, description)
      setCampaign(created.campaign)
      setCampaignPath(created.path)
      setActiveSessionId(created.campaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = created.campaign
      setActiveTab('campaign')
      setIsCampaignModalOpen(false)
      setIsCreateCampaignOpen(false)
      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not create campaign:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not create campaign.')
    } finally {
      setIsCampaignBusy(false)
    }
  }

  /**
   * Open an existing stored campaign and load it into the workspace.
   *
   * @param path - Absolute campaign folder path selected in the launcher.
   */
  async function handleOpenCampaign(path: string): Promise<void> {
    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)
    setCharacters([])
    setActiveCharacterId(null)
    setComposerCharacterId(null)

    try {
      const opened = await window.api.openCampaign(path)
      const nextCharacters = await window.api.listCharacters(opened.path)
      const hydratedCampaign = hydrateCampaignMessageAvatars(opened.campaign, nextCharacters)
      setCharacters(nextCharacters)
      setActiveCharacterId(nextCharacters[0]?.id ?? null)
      setCampaign(hydratedCampaign)
      setCampaignPath(opened.path)
      setActiveSessionId(hydratedCampaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = hydratedCampaign
      setActiveTab('campaign')
      setIsCampaignModalOpen(false)
      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not open campaign:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not open campaign.')
    } finally {
      setIsCampaignBusy(false)
    }
  }

  /**
   * Save edited metadata for the currently loaded campaign.
   *
   * @param name - Updated campaign name.
   * @param description - Updated campaign description.
   */
  async function handleSaveCurrentCampaign(name: string, description: string): Promise<void> {
    if (!campaign || !campaignPath) {
      return
    }

    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)

    const nextCampaign: Campaign = {
      ...campaign,
      name,
      description,
      updatedAt: Date.now(),
    }

    try {
      await window.api.saveCampaign(campaignPath, nextCampaign)
      setCampaign(nextCampaign)
      lastSavedCampaignRef.current = nextCampaign
      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not save campaign changes:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not save campaign changes.')
    } finally {
      setIsCampaignBusy(false)
    }
  }

  /**
   * Open the campaign picker and load the selected campaign, if any.
   */
  async function handleOpenCampaignFromFile(): Promise<void> {
    setIsCampaignBusy(true)
    setCampaignStatusMessage(null)

    try {
      const selectedPath = await window.api.pickCampaignFile()
      if (!selectedPath) {
        return
      }

      await handleOpenCampaign(selectedPath)
    } catch (err) {
      console.error('[Aethra] Could not pick campaign file:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not open campaign file.')
    } finally {
      setIsCampaignBusy(false)
    }
  }

  /**
   * Persist settings to the main process and keep local state in sync.
   *
   * @param nextSettings - Fully updated app settings object.
   */
  async function persistSettings(nextSettings: AppSettings): Promise<void> {
    setAppSettings(nextSettings)
    await window.api.saveSettings(nextSettings)
  }

  /**
   * Handle top-level ribbon tab changes.
   * Opens the settings modal instead of navigating away from the chat layout.
   *
   * @param tabId - Selected tab identifier.
   */
  function handleTabChange(tabId: string): void {
    if (tabId === 'campaign') {
      setCampaignStatusMessage(null)
      setActiveTab(tabId)
      setIsCampaignModalOpen(true)
      return
    }

    if (tabId === 'characters') {
      setCharactersStatusKind(null)
      setCharactersStatusMessage(null)
      setIsCharactersOpen(true)
      return
    }

    if (tabId === 'settings') {
      setSettingsStatusKind(null)
      setSettingsStatusMessage(null)
      setIsSettingsOpen(true)
      return
    }

    setActiveTab(tabId)
  }

  /**
   * Close the settings modal.
   */
  function handleCloseSettings(): void {
    setIsSettingsOpen(false)
  }

  /**
   * Close the characters modal.
   */
  function handleCloseCharacters(): void {
    setIsCharactersOpen(false)
  }

  /**
   * Open the current session summary modal.
   */
  function handleOpenSummaryModal(): void {
    setSummaryModalStatusKind(null)
    setSummaryModalStatusMessage(null)
    setIsSummaryModalOpen(true)
  }

  /**
   * Close the current session summary modal.
   */
  function handleCloseSummaryModal(): void {
    setIsSummaryModalOpen(false)
  }

  /**
   * Rebuild the active session summary from as much raw transcript as the
   * current model context should allow in one request.
   */
  async function handleRebuildSummary(): Promise<void> {
    if (!activeSession || isRebuildingSummary) {
      return
    }

    const visibleMessages = getVisiblePromptMessages(activeSession.messages)
    if (visibleMessages.length === 0) {
      setSummaryModalStatusKind('error')
      setSummaryModalStatusMessage('No conversation history is available to summarize.')
      return
    }

    clearSummaryTimer(activeSession.id)
    summaryRerunRef.current.delete(activeSession.id)
    setIsRebuildingSummary(true)
    setSummaryModalStatusKind(null)
    setSummaryModalStatusMessage('Rebuilding summary...')

    try {
      const contextWindowTokens = activeModel?.contextWindowTokens ?? null
      const transcriptBudget = contextWindowTokens === null || contextWindowTokens <= 0
        ? Number.POSITIVE_INFINITY
        : Math.max(
          1024,
          Math.floor(contextWindowTokens * SUMMARY_REBUILD_CONTEXT_FRACTION),
        )

      let nextSummary = ''
      let startIndex = 0
      let passNumber = 0

      while (startIndex < visibleMessages.length) {
        passNumber += 1
        const endIndex = Number.isFinite(transcriptBudget)
          ? findSummaryChunkEnd(visibleMessages, startIndex, nextSummary, transcriptBudget)
          : visibleMessages.length
        const transcriptChunk = visibleMessages.slice(startIndex, endIndex)

        setSummaryModalStatusMessage(
          `Rebuilding summary... pass ${passNumber}, processing messages ${(
            startIndex + 1
          ).toLocaleString()}-${endIndex.toLocaleString()} of ${visibleMessages.length.toLocaleString()}.`,
        )

        const normalizedPassSummary = await requestRollingSummary(nextSummary, transcriptChunk)
        if (!normalizedPassSummary) {
          throw new Error('The model returned an empty summary.')
        }

        nextSummary = normalizedPassSummary
        startIndex = endIndex
      }

      const normalizedSummary = nextSummary.trim()
      if (!normalizedSummary) {
        throw new Error('The model returned an empty summary.')
      }

      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === activeSession.id
            ? {
              ...session,
              rollingSummary: normalizedSummary,
              summarizedMessageCount: visibleMessages.length,
              updatedAt: Date.now(),
            }
            : session,
        ),
      }))

      setSummaryModalStatusKind('success')
      setSummaryModalStatusMessage(
        passNumber > 1
          ? `Summary rebuilt from ${visibleMessages.length.toLocaleString()} visible messages across ${passNumber.toLocaleString()} passes.`
          : `Summary rebuilt from ${visibleMessages.length.toLocaleString()} visible messages in a single pass.`,
      )
    } catch (err) {
      console.error('[Aethra] Could not rebuild session summary:', err)
      setSummaryModalStatusKind('error')
      setSummaryModalStatusMessage(
        err instanceof Error ? err.message : 'Could not rebuild the session summary.',
      )
    } finally {
      setIsRebuildingSummary(false)
    }
  }

  /**
   * Open the AI debug modal.
   */
  function handleOpenAiDebug(): void {
    setIsAiDebugOpen(true)
  }

  /**
   * Open the model loader modal for text-generation-webui.
   * For llama.cpp servers, also runs a binary check so the modal can show
   * the install banner if llama-server is missing.
   */
  function handleOpenModelLoader(): void {
    setModelLoaderStatusKind(null)
    setModelLoaderStatusMessage(null)
    setIsModelLoaderOpen(true)
    const activeServer = appSettings.servers.find((s) => s.id === appSettings.activeServerId)
    if (activeServer?.kind === 'llama.cpp') {
      window.api.checkLlamaBinary(activeServer.id)
        .then((result) => { setModelLoaderBinaryCheck(result) })
        .catch(() => { setModelLoaderBinaryCheck(null) })
    } else {
      setModelLoaderBinaryCheck(null)
    }
  }

  /**
   * Open the runtime model parameters modal for the active model preset.
   */
  function handleOpenModelParameters(): void {
    setModelParametersStatusKind(null)
    setModelParametersStatusMessage(null)
    setIsModelParametersOpen(true)
  }

  /**
   * Close the AI debug modal.
   */
  function handleCloseAiDebug(): void {
    setIsAiDebugOpen(false)
  }

  /**
   * Close the model loader modal.
   */
  function handleCloseModelLoader(): void {
    setIsModelLoaderOpen(false)
  }

  /**
   * Close the runtime model parameters modal.
   */
  function handleCloseModelParameters(): void {
    setIsModelParametersOpen(false)
  }

  /**
   * Clear the in-memory AI debug log in both processes.
   */
  async function handleClearAiDebug(): Promise<void> {
    try {
      await window.api.clearAiDebugLog()
      setAiDebugEntries([])
    } catch (err) {
      console.error('[Aethra] Could not clear AI debug log:', err)
    }
  }

  /**
   * Append a renderer-side AI debug event to the shared log.
   *
   * @param direction - High-level category for the event.
   * @param label - Short event label.
   * @param payload - Structured payload to record.
   */
  async function appendAiDebugEntry(
    direction: AiDebugEntry['direction'],
    label: string,
    payload: unknown,
  ): Promise<void> {
    try {
      await window.api.appendAiDebugEntry({
        timestamp: Date.now(),
        direction,
        label,
        payload,
      })
    } catch (err) {
      console.error('[Aethra] Could not append AI debug entry:', err)
    }
  }

  /**
   * Clear any delayed summary timer for a session.
   *
   * @param sessionId - Target session.
   */
  function clearSummaryTimer(sessionId: string): void {
    const timerId = summaryTimeoutsRef.current[sessionId]
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
      delete summaryTimeoutsRef.current[sessionId]
    }
  }

  /**
   * Start a background refresh of the rolling summary for a session.
   *
   * @param sessionId - Target session.
   */
  async function runRollingSummary(sessionId: string): Promise<void> {
    const settings = appSettingsRef.current
    if (!settings.enableRollingSummaries) {
      return
    }

    if (summaryInFlightRef.current.has(sessionId)) {
      summaryRerunRef.current.add(sessionId)
      return
    }

    if (isStreamingRef.current) {
      scheduleRollingSummary(sessionId)
      return
    }

    const currentCampaign = campaignRef.current
    const session = currentCampaign?.sessions.find((candidate) => candidate.id === sessionId) ?? null
    if (!session) {
      return
    }

    const snapshot = createSessionSummarySnapshot(session)
    if (!snapshot) {
      return
    }

    summaryInFlightRef.current.add(sessionId)
    try {
      const normalizedSummary = await requestRollingSummary(snapshot.previousSummary, snapshot.transcript)
      if (!normalizedSummary) {
        return
      }

      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((candidate) => {
          if (candidate.id !== sessionId) {
            return candidate
          }

          if (candidate.summarizedMessageCount !== snapshot.baseSummarizedCount) {
            return candidate
          }

          return {
            ...candidate,
            rollingSummary: normalizedSummary,
            summarizedMessageCount: snapshot.nextSummarizedCount,
            updatedAt: Date.now(),
          }
        }),
      }))
    } catch (err) {
      console.error('[Aethra] Could not refresh rolling summary:', err)
    } finally {
      summaryInFlightRef.current.delete(sessionId)
      if (summaryRerunRef.current.has(sessionId)) {
        summaryRerunRef.current.delete(sessionId)
        scheduleRollingSummary(sessionId)
      }
    }
  }

  /**
   * Queue a delayed rolling-summary refresh so live play can continue first.
   *
   * @param sessionId - Target session.
   */
  function scheduleRollingSummary(sessionId: string): void {
    if (!appSettingsRef.current.enableRollingSummaries) {
      return
    }

    clearSummaryTimer(sessionId)
    summaryTimeoutsRef.current[sessionId] = window.setTimeout(() => {
      delete summaryTimeoutsRef.current[sessionId]
      void runRollingSummary(sessionId)
    }, SUMMARY_IDLE_DELAY_MS)
  }

  /**
   * Reset a session summary when the transcript is edited in a way that can
   * invalidate archived continuity.
   *
   * @param sessionId - Target session.
   */
  function resetRollingSummary(sessionId: string): void {
    clearSummaryTimer(sessionId)
    summaryRerunRef.current.delete(sessionId)

    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, rollingSummary: '', summarizedMessageCount: 0, updatedAt: Date.now() }
          : session,
      ),
    }))
  }

  /**
   * Select and persist the active app theme.
   *
   * @param themeId - Built-in or imported theme ID.
   */
  async function handleThemeSelect(themeId: string): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      activeThemeId: themeId,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Theme updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected theme:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save theme selection.')
    }
  }

  /**
   * Persist the selected chat bubble text size preset.
   *
   * @param textSize - Selected chat text size preset.
   */
  async function handleChatTextSizeSelect(textSize: AppSettings['chatTextSize']): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      chatTextSize: textSize,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Chat text size updated.')
    } catch (err) {
      console.error('[Aethra] Could not save chat text size:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the chat text size.')
    }
  }

  /**
   * Enable or disable rolling scene summaries for campaign prompts.
   *
   * @param enabled - Whether the prompt should use rolling summaries.
   */
  async function handleRollingSummariesToggle(enabled: boolean): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      enableRollingSummaries: enabled,
    }

    try {
      await persistSettings(nextSettings)
      if (!enabled && activeSession) {
        clearSummaryTimer(activeSession.id)
      }
      if (enabled && activeSession) {
        scheduleRollingSummary(activeSession.id)
      }
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        enabled
          ? 'Rolling summaries enabled.'
          : 'Rolling summaries disabled.',
      )
    } catch (err) {
      console.error('[Aethra] Could not update rolling summary setting:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the rolling summary setting.')
    }
  }

  /**
   * Select and persist the active AI server, falling back to that server's
   * first available model if the current model does not belong to it.
   *
   * @param serverId - ID of the selected server profile.
   */
  async function handleServerSelect(serverId: string): Promise<void> {
    const selectedServer = appSettings.servers.find((server) => server.id === serverId)
    if (!selectedServer) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected server.')
      return
    }

    const serverModels = appSettings.models.filter((model) => model.serverId === selectedServer.id)
    const nextModelSlug = serverModels.some((model) => model.slug === appSettings.activeModelSlug)
      ? appSettings.activeModelSlug
      : (serverModels[0]?.slug ?? null)

    const nextSettings: AppSettings = {
      ...appSettings,
      activeServerId: selectedServer.id,
      activeModelSlug: nextModelSlug,
    }

    try {
      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.server.selected', {
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        baseUrl: selectedServer.baseUrl,
        selectedModelSlug: nextModelSlug,
        availableModels: serverModels.map((model) => ({
          id: model.id,
          slug: model.slug,
          name: model.name,
          contextWindowTokens: model.contextWindowTokens ?? null,
        })),
      })
      setSettingsStatusKind('success')
      setSettingsStatusMessage('AI server updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected server:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save AI server selection.')
    }
  }

  /**
   * Select and persist the active AI model.
   *
   * @param modelSlug - Slug of the selected model preset.
   */
  async function handleModelSelect(modelSlug: string): Promise<void> {
    const selectedModel = (activeServer
      ? appSettings.models.find((model) => model.serverId === activeServer.id && model.slug === modelSlug)
      : null) ?? appSettings.models.find((model) => model.slug === modelSlug)
    if (!selectedModel) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected model.')
      return
    }

    const nextSettings: AppSettings = {
      ...appSettings,
      activeServerId: selectedModel.serverId,
      activeModelSlug: selectedModel.slug,
    }

    try {
      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.model.selected', {
        serverId: selectedModel.serverId,
        modelId: selectedModel.id,
        modelSlug: selectedModel.slug,
        modelName: selectedModel.name,
        contextWindowTokens: selectedModel.contextWindowTokens ?? null,
      })
      setSettingsStatusKind('success')
      setSettingsStatusMessage('AI model updated.')
    } catch (err) {
      console.error('[Aethra] Could not save selected model:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save AI model selection.')
    }
  }

  /**
   * Query the active server for its available models and persist the catalog
   * into settings so it remains selectable on future launches.
   */
  async function handleBrowseModels(): Promise<void> {
    if (!activeServer) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select a server before browsing models.')
      return
    }

    setIsBrowsingModels(true)

    try {
      await appendAiDebugEntry('info', 'ai.models.browse.start', {
        serverId: activeServer.id,
        serverName: activeServer.name,
        baseUrl: activeServer.baseUrl,
      })

      const discoveredModels = await window.api.browseModels(activeServer.id)
      await appendAiDebugEntry('response', 'ai.models.browse.result', {
        serverId: activeServer.id,
        count: discoveredModels.length,
        models: discoveredModels.map((model) => ({
          id: model.id,
          slug: model.slug,
          name: model.name,
          contextWindowTokens: model.contextWindowTokens ?? null,
        })),
      })
      const persistedModels = discoveredModels.map((model) => {
        const existingModel = appSettings.models.find(
          (candidate) => candidate.serverId === model.serverId && candidate.slug === model.slug,
        )

        return {
          id: model.id,
          serverId: model.serverId,
          name: model.name,
          slug: model.slug,
          source: model.source ?? existingModel?.source,
          localPath: model.localPath ?? existingModel?.localPath,
          huggingFaceRepo: model.huggingFaceRepo ?? existingModel?.huggingFaceRepo,
          huggingFaceFile: model.huggingFaceFile ?? existingModel?.huggingFaceFile,
          fileSizeBytes: model.fileSizeBytes ?? existingModel?.fileSizeBytes,
          parameterSizeBillions: model.parameterSizeBillions ?? existingModel?.parameterSizeBillions,
          quantization: model.quantization ?? existingModel?.quantization,
          contextWindowTokens: model.contextWindowTokens ?? existingModel?.contextWindowTokens,
          gpuLayers: model.gpuLayers ?? existingModel?.gpuLayers,
          threads: model.threads ?? existingModel?.threads,
          batchSize: model.batchSize ?? existingModel?.batchSize,
          microBatchSize: model.microBatchSize ?? existingModel?.microBatchSize,
          flashAttention: model.flashAttention ?? existingModel?.flashAttention,
          temperature: model.temperature ?? existingModel?.temperature,
          topP: model.topP ?? existingModel?.topP,
          topK: model.topK ?? existingModel?.topK,
          repeatPenalty: model.repeatPenalty ?? existingModel?.repeatPenalty,
          seed: model.seed ?? existingModel?.seed,
          maxOutputTokens: model.maxOutputTokens ?? existingModel?.maxOutputTokens,
          presencePenalty: model.presencePenalty ?? existingModel?.presencePenalty,
          frequencyPenalty: model.frequencyPenalty ?? existingModel?.frequencyPenalty,
        }
      })

      const nextModels = [
        ...appSettings.models.filter((model) => model.serverId !== activeServer.id),
        ...persistedModels,
      ]

      const nextActiveModelSlug = discoveredModels.some((model) => model.slug === appSettings.activeModelSlug)
        ? appSettings.activeModelSlug
        : (discoveredModels[0]?.slug ?? null)

      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
        activeServerId: activeServer.id,
        activeModelSlug: nextActiveModelSlug,
      }

      setAvailableModels(discoveredModels)
      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.models.persisted', {
        serverId: activeServer.id,
        activeModelSlug: nextActiveModelSlug,
        persistedModels: persistedModels.map((model) => ({
          id: model.id,
          slug: model.slug,
          name: model.name,
          contextWindowTokens: model.contextWindowTokens ?? null,
        })),
      })
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        discoveredModels.length > 0
          ? `Loaded ${discoveredModels.length} model${discoveredModels.length === 1 ? '' : 's'} from ${activeServer.name}.`
          : `No models were reported by ${activeServer.name}.`,
      )
    } catch (err) {
      await appendAiDebugEntry('error', 'ai.models.browse.error', {
        serverId: activeServer.id,
        message: err instanceof Error ? err.message : String(err),
      })
      console.error('[Aethra] Could not browse models:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not browse models.')
    } finally {
      setIsBrowsingModels(false)
    }
  }

  /**
   * Persist a context budget override for the selected model preset.
   *
   * @param modelSlug - Slug of the model preset to update.
   * @param contextWindowTokens - Explicit context window override, or null to clear it.
   */
  async function handleSaveModelContext(modelSlug: string, contextWindowTokens: number | null): Promise<void> {
    const normalizedContextWindowTokens =
      contextWindowTokens === null
        ? undefined
        : (Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
            ? Math.floor(contextWindowTokens)
            : null)

    if (normalizedContextWindowTokens === null) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Context budget must be a whole number greater than zero.')
      throw new Error('Invalid context budget.')
    }

    const selectedModel = (activeServer
      ? appSettings.models.find((model) => model.serverId === activeServer.id && model.slug === modelSlug)
      : null) ?? appSettings.models.find((model) => model.slug === modelSlug)
    if (!selectedModel) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected model.')
      throw new Error('Selected model could not be found.')
    }

    const nextModels = appSettings.models.map((model) =>
      model.slug === modelSlug && model.serverId === selectedModel.serverId
        ? { ...model, contextWindowTokens: normalizedContextWindowTokens }
        : model,
    )

    const nextSettings: AppSettings = {
      ...appSettings,
      models: nextModels,
    }

    try {
      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.model.context.updated', {
        serverId: selectedModel.serverId,
        modelId: selectedModel.id,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens ?? null,
      })
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Context budget updated.')
    } catch (err) {
      console.error('[Aethra] Could not save model context budget:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the context budget.')
      throw err
    }
  }

  /**
   * Persist runtime chat parameters for the selected model preset.
   *
   * @param modelSlug - Selected model slug to update.
   * @param values - Runtime parameter overrides to persist.
   */
  async function handleSaveModelParameters(
    modelSlug: string,
    values: {
      contextWindowTokens: number | null
      temperature: number | null
      topP: number | null
      topK: number | null
      repeatPenalty: number | null
      gpuLayers: number | null
      threads: number | null
      batchSize: number | null
      microBatchSize: number | null
      flashAttention: boolean
      maxOutputTokens: number | null
      presencePenalty: number | null
      frequencyPenalty: number | null
    },
  ): Promise<void> {
    if (!activeServer) {
      setModelParametersStatusKind('error')
      setModelParametersStatusMessage('Select an AI server before editing runtime parameters.')
      return
    }

    const selectedModel = activeServerModels.find((model) => model.slug === modelSlug)
    if (!selectedModel) {
      setModelParametersStatusKind('error')
      setModelParametersStatusMessage('Select a model before saving runtime parameters.')
      return
    }

    const normalizeRange = (
      value: number | null,
      minimum: number,
      maximum: number,
      label: string,
    ): number | null => {
      if (value === null) {
        return null
      }

      if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
      }

      return Number(value.toFixed(2))
    }

    const normalizeInteger = (value: number | null, minimum: number, label: string): number | null => {
      if (value === null) {
        return null
      }

      if (!Number.isFinite(value) || value < minimum) {
        throw new Error(`${label} must be at least ${minimum}.`)
      }

      return Math.floor(value)
    }

    try {
      setIsModelParametersSaving(true)
      const normalizedContextWindowTokens = normalizeInteger(values.contextWindowTokens, 1, 'Context length')
      const normalizedTemperature = normalizeRange(values.temperature, 0, 5, 'Temperature')
      const normalizedTopP = normalizeRange(values.topP, 0, 1, 'Top P')
      const normalizedTopK = normalizeInteger(values.topK, 0, 'Top K')
      const normalizedRepeatPenalty = normalizeRange(values.repeatPenalty, 0, 5, 'Repeat penalty')
      const normalizedGpuLayers = normalizeInteger(values.gpuLayers, 0, 'GPU layers')
      const normalizedThreads = normalizeInteger(values.threads, 1, 'Threads')
      const normalizedBatchSize = normalizeInteger(values.batchSize, 1, 'Batch size')
      const normalizedMicroBatchSize = normalizeInteger(values.microBatchSize, 1, 'Micro-batch size')
      const normalizedMaxOutputTokens = normalizeInteger(values.maxOutputTokens, 1, 'Max output tokens')
      const normalizedPresencePenalty = normalizeRange(values.presencePenalty, -2, 2, 'Presence penalty')
      const normalizedFrequencyPenalty = normalizeRange(values.frequencyPenalty, -2, 2, 'Frequency penalty')

      const nextModels = appSettings.models.map((model) =>
        model.serverId === selectedModel.serverId && model.slug === selectedModel.slug
          ? {
            ...model,
            contextWindowTokens: normalizedContextWindowTokens ?? undefined,
            temperature: normalizedTemperature ?? undefined,
            topP: normalizedTopP ?? undefined,
            topK: normalizedTopK ?? undefined,
            repeatPenalty: normalizedRepeatPenalty ?? undefined,
            gpuLayers: normalizedGpuLayers ?? undefined,
            threads: normalizedThreads ?? undefined,
            batchSize: normalizedBatchSize ?? undefined,
            microBatchSize: normalizedMicroBatchSize ?? undefined,
            flashAttention: values.flashAttention,
            maxOutputTokens: normalizedMaxOutputTokens ?? undefined,
            presencePenalty: normalizedPresencePenalty ?? undefined,
            frequencyPenalty: normalizedFrequencyPenalty ?? undefined,
          }
          : model,
      )
      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
      }

      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.model.parameters.updated', {
        serverId: selectedModel.serverId,
        modelId: selectedModel.id,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens,
        temperature: normalizedTemperature,
        topP: normalizedTopP,
        topK: normalizedTopK,
        repeatPenalty: normalizedRepeatPenalty,
        gpuLayers: normalizedGpuLayers,
        threads: normalizedThreads,
        batchSize: normalizedBatchSize,
        microBatchSize: normalizedMicroBatchSize,
        flashAttention: values.flashAttention,
        maxOutputTokens: normalizedMaxOutputTokens,
        presencePenalty: normalizedPresencePenalty,
        frequencyPenalty: normalizedFrequencyPenalty,
      })
      setModelParametersStatusKind('success')
      setModelParametersStatusMessage('Runtime parameters updated.')
    } catch (err) {
      console.error('[Aethra] Could not save model parameters:', err)
      setModelParametersStatusKind('error')
      setModelParametersStatusMessage(err instanceof Error ? err.message : 'Could not save runtime parameters.')
    } finally {
      setIsModelParametersSaving(false)
    }
  }

  /**
   * Load a model into text-generation-webui and persist the chosen runtime options.
   *
   * @param modelSlug - Selected model slug to load.
   * @param contextWindowTokens - Requested context window size in tokens.
   * @param temperature - Sampling temperature used for future completions.
   */
  async function handleLoadModel(modelSlug: string, contextWindowTokens: number, temperature: number): Promise<void> {
    if (!activeServer || !canLoadModel) {
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage('Model loading is not available for the selected provider.')
      return
    }

    const selectedModel = activeServerModels.find((model) => model.slug === modelSlug)
    if (!selectedModel) {
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage('Select a model before sending the load request.')
      return
    }

    if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage('Context length must be a whole number greater than zero.')
      return
    }

    if (!Number.isFinite(temperature) || temperature < 0) {
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage('Temperature must be zero or greater.')
      return
    }

    const normalizedContextWindowTokens = Math.floor(contextWindowTokens)
    const normalizedTemperature = Number(temperature.toFixed(2))
    setIsModelLoading(true)

    try {
      const nextModels = appSettings.models.map((model) =>
        model.serverId === selectedModel.serverId && model.slug === selectedModel.slug
          ? { ...model, contextWindowTokens: normalizedContextWindowTokens, temperature: normalizedTemperature }
          : model,
      )
      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
        activeServerId: activeServer.id,
        activeModelSlug: selectedModel.slug,
      }

      await appendAiDebugEntry('request', 'ai.model.load.request', {
        serverId: activeServer.id,
        serverName: activeServer.name,
        baseUrl: activeServer.baseUrl,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens,
        temperature: normalizedTemperature,
      })

      await persistSettings(nextSettings)
      if (activeServer.kind === 'llama.cpp') {
        const status = await window.api.loadLocalModel(activeServer.id, selectedModel.slug)
        setLocalRuntimeStatus(status)
      } else {
        await window.api.loadModel(activeServer.id, selectedModel.slug, normalizedContextWindowTokens)
      }
      await appendAiDebugEntry('response', 'ai.model.load.success', {
        serverId: activeServer.id,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens,
        temperature: normalizedTemperature,
      })
      setModelLoaderStatusKind('success')
      setModelLoaderStatusMessage(
        activeServer.kind === 'llama.cpp'
          ? `Started ${selectedModel.name} in llama.cpp with ${normalizedContextWindowTokens.toLocaleString()} tokens.`
          : `Loaded ${selectedModel.name} with ${normalizedContextWindowTokens.toLocaleString()} tokens and temperature ${normalizedTemperature.toFixed(1)}.`,
      )
    } catch (err) {
      await appendAiDebugEntry('error', 'ai.model.load.error', {
        serverId: activeServer.id,
        modelSlug: selectedModel.slug,
        temperature: normalizedTemperature,
        message: err instanceof Error ? err.message : String(err),
      })
      console.error('[Aethra] Could not load model:', err)
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage(err instanceof Error ? err.message : 'Could not load the selected model.')
    } finally {
      setIsModelLoading(false)
    }
  }

  /**
   * Persist an updated base URL for the selected AI server profile.
   *
   * @param serverId - ID of the server profile to update.
   * @param baseUrl  - New OpenAI-compatible base URL.
   */
  async function handleServerAddressSave(serverId: string, baseUrl: string): Promise<void> {
    const trimmedBaseUrl = baseUrl.trim()
    if (!trimmedBaseUrl) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Server address cannot be empty.')
      return
    }

    const nextServers = appSettings.servers.map((server) =>
      server.id === serverId ? { ...server, baseUrl: trimmedBaseUrl } : server,
    )

    const nextSettings: AppSettings = {
      ...appSettings,
      servers: nextServers,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Server address updated.')
    } catch (err) {
      console.error('[Aethra] Could not save server address:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the server address.')
      throw err
    }
  }

  /**
   * Persist local llama.cpp-specific server configuration fields.
   *
   * @param serverId - ID of the local server profile to update.
   * @param values - Local runtime configuration fields to persist.
   */
  async function handleLocalServerConfigSave(
    serverId: string,
    values: {
      modelsDirectory: string
      executablePath: string
      host: string
      port: number
      huggingFaceToken: string
    },
  ): Promise<void> {
    const normalizedModelsDirectory = values.modelsDirectory.trim()
    const normalizedHost = values.host.trim() || '127.0.0.1'
    const normalizedPort = Math.floor(values.port)

    if (!normalizedModelsDirectory) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Models directory cannot be empty.')
      throw new Error('Models directory cannot be empty.')
    }

    if (!Number.isFinite(normalizedPort) || normalizedPort <= 0) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Port must be a whole number greater than zero.')
      throw new Error('Invalid llama.cpp port.')
    }

    const nextServers = appSettings.servers.map((server) =>
      server.id === serverId
        ? {
          ...server,
          modelsDirectory: normalizedModelsDirectory,
          executablePath: values.executablePath.trim() || null,
          host: normalizedHost,
          port: normalizedPort,
          huggingFaceToken: values.huggingFaceToken,
          baseUrl: `http://${normalizedHost}:${normalizedPort}/v1`,
        }
        : server,
    )

    const nextSettings: AppSettings = {
      ...appSettings,
      servers: nextServers,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Local llama.cpp settings updated.')
    } catch (err) {
      console.error('[Aethra] Could not save local llama.cpp settings:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save local llama.cpp settings.')
      throw err
    }
  }

  /**
   * Open a native folder picker and store the selected models directory.
   */
  async function handlePickModelsDirectory(): Promise<string | null> {
    try {
      return await window.api.pickModelsDirectory()
    } catch (err) {
      console.error('[Aethra] Could not choose models directory:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not open the models directory picker.')
      return null
    }
  }

  /**
   * Open a native file picker for the llama-server executable.
   */
  async function handlePickLlamaExecutable(): Promise<string | null> {
    try {
      return await window.api.pickLlamaExecutable()
    } catch (err) {
      console.error('[Aethra] Could not choose llama-server executable:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not open the llama-server file picker.')
      return null
    }
  }

  /**
   * Browse GGUF files in a Hugging Face repository for the local llama.cpp provider.
   *
   * @param repoId - Hugging Face repository identifier to inspect.
   */
  async function handleBrowseHuggingFaceModels(repoId: string): Promise<void> {
    if (!activeServer || activeServer.kind !== 'llama.cpp') {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select the local llama.cpp provider before browsing Hugging Face.')
      return
    }

    setIsBrowsingHuggingFace(true)
    try {
      const files = await window.api.browseHuggingFaceModels(activeServer.id, repoId)
      setHuggingFaceFiles(files)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        files.length > 0
          ? `Found ${files.length} GGUF file${files.length === 1 ? '' : 's'} in ${repoId}.`
          : `No GGUF files were found in ${repoId}.`,
      )
    } catch (err) {
      console.error('[Aethra] Could not browse Hugging Face models:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not browse Hugging Face models.')
      setHuggingFaceFiles([])
    } finally {
      setIsBrowsingHuggingFace(false)
    }
  }

  /**
   * Download a GGUF file from Hugging Face and refresh the local model catalog.
   *
   * @param repoId - Hugging Face repository identifier.
   * @param fileName - Repository-relative GGUF path.
   */
  async function handleDownloadHuggingFaceModel(repoId: string, fileName: string): Promise<void> {
    if (!activeServer || activeServer.kind !== 'llama.cpp') {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select the local llama.cpp provider before downloading models.')
      return
    }

    setIsDownloadingModel(true)
    try {
      await window.api.downloadHuggingFaceModel(activeServer.id, repoId, fileName)
      await handleBrowseModels()
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Downloaded ${fileName} from ${repoId}.`)
    } catch (err) {
      console.error('[Aethra] Could not download Hugging Face model:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not download the selected model.')
    } finally {
      setIsDownloadingModel(false)
    }
  }

  /**
   * Import a user-downloaded theme JSON file, save it, and make it active.
   *
   * @param file - Uploaded theme file chosen in the settings modal.
   */
  async function handleImportTheme(file: File): Promise<void> {
    try {
      const rawText = await file.text()
      const parsed = parseImportedTheme(JSON.parse(rawText) as unknown)
      const nextSettings: AppSettings = {
        ...appSettings,
        customThemes: upsertCustomTheme(appSettings.customThemes, parsed),
        activeThemeId: parsed.id,
      }

      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Imported "${parsed.name}" and applied it.`)
    } catch (err) {
      console.error('[Aethra] Theme import failed:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Theme import failed.')
    }
  }

  /**
   * Create a new in-memory character draft and select it.
   */
  async function handleCreateCharacter(): Promise<void> {
    if (!campaignPath) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Open a campaign before creating characters.')
      return
    }

    try {
      const now = Date.now()
      const character: CharacterProfile = {
        id: uid(),
        name: 'New Character',
        folderName: '',
        role: '',
        gender: 'non-specific',
        pronouns: 'they/them',
        description: '',
        personality: '',
        speakingStyle: '',
        goals: '',
        avatarImageData: null,
        avatarCrop: { x: 0, y: 0, scale: 1 },
        controlledBy: 'ai',
        createdAt: now,
        updatedAt: now,
      }
      const nextCharacters = [character, ...characters]
      setCharacters(nextCharacters)
      setActiveCharacterId(character.id)
      setCharactersStatusKind(null)
      setCharactersStatusMessage(null)
    } catch (err) {
      console.error('[Aethra] Could not create character:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage(err instanceof Error ? err.message : 'Could not create character.')
    }
  }

  /**
   * Persist the currently edited character details.
   *
   * @param character - Character profile to save.
   */
  async function handleSaveCharacter(character: CharacterProfile): Promise<void> {
    if (!campaignPath) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Open a campaign before saving characters.')
      return
    }

    if (!character.name.trim()) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Character name cannot be empty.')
      return
    }

    setIsCharactersBusy(true)

    try {
      const savedCharacter = await window.api.saveCharacter(campaignPath, character)
      setCharacters((prev) =>
        prev
          .map((candidate) => candidate.id === savedCharacter.id ? savedCharacter : candidate)
          .sort((first, second) => second.updatedAt - first.updatedAt),
      )
      setActiveCharacterId(savedCharacter.id)
      setCharactersStatusKind('success')
      setCharactersStatusMessage(`Saved ${savedCharacter.name}.`)
    } catch (err) {
      console.error('[Aethra] Could not save character:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage(err instanceof Error ? err.message : 'Could not save character.')
    } finally {
      setIsCharactersBusy(false)
    }
  }

  /**
   * Append the current input as a user message, then stream the AI response.
   * The assistant message is created immediately with empty content and updated
   * chunk-by-chunk as the stream arrives.
   */
  function handleSend() {
    if (!campaign || !inputValue.trim() || isStreaming) return

    const trimmedInput = inputValue.trim()
    const normalizedInput = trimmedInput === '***' ? '*continue*' : trimmedInput
    const sessionId = ensureActiveSession()
    const targetSession = campaign?.sessions.find((session) => session.id === sessionId) ?? null

    const userMessage: Message = {
      id:        uid(),
      role:      'user',
      characterId: composerCharacter?.id,
      characterName: composerCharacter?.name,
      ...getMessageAvatarSnapshot(composerCharacter),
      content:   normalizedInput,
      timestamp: Date.now(),
    }

    // Snapshot the message history *before* appending the user message so we
    // can build the API payload without relying on stale state.
    const sessionForPrompt: Session = targetSession ?? {
      id: sessionId,
      title: 'New Chat',
      messages: [],
      rollingSummary: '',
      summarizedMessageCount: 0,
      createdAt: userMessage.timestamp,
      updatedAt: userMessage.timestamp,
    }
    const historySnapshot = buildRequestMessages(
      campaign,
      characters,
      appSettingsRef.current,
      sessionForPrompt,
      [userMessage],
    )

    if (targetSession && targetSession.messages.length === 0) {
      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, title: buildSessionTitle(normalizedInput), updatedAt: Date.now() }
            : session,
        ),
      }))
    }

    upsertMessage(sessionId, userMessage)
    setInputValue('')
    setIsStreaming(true)
    setLastTokenUsage(null)

    // Create a placeholder assistant message that will be filled by the stream.
    const assistantTimestamp = Date.now()
    const assistantIds = [uid()]
    const assistantMessage: Message = {
      id:        assistantIds[0],
      role:      'assistant',
      content:   '',
      timestamp: assistantTimestamp,
    }
    upsertMessage(sessionId, assistantMessage)

    // Accumulate streamed text outside React state to avoid excessive re-renders,
    // then push the full string on each chunk.
    let accumulated = ''
    let pendingAnimationFrameId: number | null = null
    const playerControlledNames = new Set(
      characters
        .filter((character) => character.controlledBy === 'user')
        .map((character) => character.name.trim().toLocaleLowerCase())
        .filter((name) => name.length > 0),
    )

    /**
     * Push the latest parsed assistant bubbles into state at most once per frame.
     */
    function flushStreamedAssistantMessages(): void {
      pendingAnimationFrameId = null

      const segments = splitStreamedAssistantBubbles(accumulated, playerControlledNames)

      while (assistantIds.length < segments.length) {
        assistantIds.push(uid())
      }

      syncStreamedAssistantMessages(sessionId, assistantIds, segments, assistantTimestamp)
    }

    /**
     * Schedule the streamed assistant UI update for the next animation frame.
     */
    function scheduleStreamedAssistantSync(): void {
      if (pendingAnimationFrameId !== null) {
        return
      }

      pendingAnimationFrameId = requestAnimationFrame(() => {
        flushStreamedAssistantMessages()
      })
    }

    /**
     * Stream one assistant attempt. Replies without a leading character tag
     * are discarded and retried up to the configured limit.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    function streamAssistantAttempt(attemptNumber: number): void {
      accumulated = ''

      streamCompletion(
        historySnapshot,
        /* onToken */ (chunk) => {
          accumulated += chunk
          scheduleStreamedAssistantSync()
        },
        /* onUsage */ (usage) => {
          setLastTokenUsage(usage)
        },
        /* onDone */ () => {
          if (pendingAnimationFrameId !== null) {
            cancelAnimationFrame(pendingAnimationFrameId)
          }
          flushStreamedAssistantMessages()

          const finalSegments = splitStreamedAssistantBubbles(accumulated, playerControlledNames)
          const hasNamedBubble = hasNamedAssistantBubble(finalSegments)

          if (!hasNamedBubble && attemptNumber < MAX_UNTAGGED_ASSISTANT_ATTEMPTS) {
            syncStreamedAssistantMessages(sessionId, assistantIds, [{ content: '' }], assistantTimestamp)
            streamAssistantAttempt(attemptNumber + 1)
            return
          }

          setIsStreaming(false)
          scheduleRollingSummary(sessionId)
        },
        /* onError */ (err) => {
          if (pendingAnimationFrameId !== null) {
            cancelAnimationFrame(pendingAnimationFrameId)
            pendingAnimationFrameId = null
          }

          console.error('[Aethra] AI stream error:', err)
          upsertMessage(sessionId, {
            ...assistantMessage,
            content: `${TRANSIENT_ERROR_MARKER} Could not reach the selected AI server. Check that it is running and the server address is correct.`,
          })
          setIsStreaming(false)
        },
      )
    }

    streamAssistantAttempt(1)
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="app-root">
      <TitleBar title="Aethra" />

      {campaign ? (
        <RibbonBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenModelLoader={handleOpenModelLoader}
          canLoadModel={canLoadModel}
          onOpenAiDebug={handleOpenAiDebug}
          onOpenModelParameters={handleOpenModelParameters}
          canEditModelParameters={canEditModelParameters}
        />
      ) : null}

      {campaign ? (
        <div className="app-layout">
          {/* Left column: session navigator */}
          <Sidebar
            campaignName={campaign.name}
            activeModelName={activeModel?.name ?? null}
            usedTokens={usedTokens}
            usedTokensIsExact={usedTokensIsExact}
            totalContextTokens={totalContextTokens}
            remainingTokens={remainingTokens}
            remainingTokensIsExact={remainingTokensIsExact}
            sessions={sessions}
            activeSessionId={activeSessionId}
            activeSessionSummary={activeSession?.rollingSummary ?? null}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onNewSession={handleNewSession}
            onOpenSummary={handleOpenSummaryModal}
            isBusy={isStreaming}
          />

          {/* Centre column: chat feed + composer */}
          <main className="panel panel--chat">
            <ChatArea
              messages={messages}
              characters={characters}
              textSize={appSettings.chatTextSize}
              onDeleteMessage={handleDeleteMessage}
              isBusy={isStreaming}
            />
            <InputBar
              value={inputValue}
              characters={characters}
              selectedCharacterId={composerCharacterId}
              onChange={setInputValue}
              onSelectCharacter={setComposerCharacterId}
              onSend={handleSend}
              focusRequestKey={composerFocusRequestKey}
              disabled={isStreaming}
            />
          </main>

          {/* Right column: session details */}
          <DetailsPanel
            activeSession={activeSession}
            activeServerName={activeServer?.name ?? null}
            activeModelName={activeModel?.name ?? null}
          />
        </div>
      ) : (
        <CampaignLauncher
          campaigns={availableCampaigns}
          isBusy={isCampaignBusy}
          statusMessage={campaignStatusMessage}
          onCreateCampaign={handleCreateCampaign}
          onOpenFromFile={() => {
            void handleOpenCampaignFromFile()
          }}
          onOpenCampaign={(path) => {
            void handleOpenCampaign(path)
          }}
        />
      )}

      {isSettingsOpen ? (
        <SettingsModal
          servers={appSettings.servers}
          models={appSettings.models}
          activeServerId={activeServer?.id ?? null}
          activeModelSlug={activeModel?.slug ?? null}
          availableModels={availableModels}
          isBrowsingModels={isBrowsingModels}
          hardwareInfo={hardwareInfo}
          localRuntimeStatus={localRuntimeStatus}
          modelDownloadProgress={modelDownloadProgress}
          binaryInstallProgress={binaryInstallProgress}
          huggingFaceFiles={huggingFaceFiles}
          isBrowsingHuggingFace={isBrowsingHuggingFace}
          isDownloadingModel={isDownloadingModel}
          activeThemeId={appSettings.activeThemeId}
          chatTextSize={appSettings.chatTextSize}
          enableRollingSummaries={appSettings.enableRollingSummaries}
          customThemes={appSettings.customThemes}
          statusMessage={settingsStatusMessage}
          statusKind={settingsStatusKind}
          onClose={handleCloseSettings}
          onServerSelect={(serverId) => {
            void handleServerSelect(serverId)
          }}
          onModelSelect={(modelSlug) => {
            void handleModelSelect(modelSlug)
          }}
          onSaveModelContext={(modelSlug, contextWindowTokens) => handleSaveModelContext(modelSlug, contextWindowTokens)}
          onBrowseModels={() => {
            void handleBrowseModels()
          }}
          onSaveServerAddress={(serverId, baseUrl) => handleServerAddressSave(serverId, baseUrl)}
          onSaveLocalServerConfig={(serverId, values) => handleLocalServerConfigSave(serverId, values)}
          onPickModelsDirectory={() => handlePickModelsDirectory()}
          onPickLlamaExecutable={() => handlePickLlamaExecutable()}
          onBrowseHuggingFaceModels={(repoId) => {
            void handleBrowseHuggingFaceModels(repoId)
          }}
          onDownloadHuggingFaceModel={(repoId, fileName) => {
            void handleDownloadHuggingFaceModel(repoId, fileName)
          }}
          onThemeSelect={(themeId) => {
            void handleThemeSelect(themeId)
          }}
          onChatTextSizeSelect={(textSize) => {
            void handleChatTextSizeSelect(textSize)
          }}
          onRollingSummariesToggle={(enabled) => {
            void handleRollingSummariesToggle(enabled)
          }}
          onImportTheme={(file) => {
            void handleImportTheme(file)
          }}
        />
      ) : null}

      {isAiDebugOpen ? (
        <AiDebugModal
          entries={aiDebugEntries}
          onClose={handleCloseAiDebug}
          onClear={() => {
            void handleClearAiDebug()
          }}
        />
      ) : null}

      {isModelLoaderOpen ? (
        <ModelLoaderModal
          serverKind={activeServer?.kind ?? null}
          models={activeServerModels}
          activeModelSlug={activeModel?.slug ?? null}
          fitEstimate={activeLocalModelFit}
          localRuntimeStatus={localRuntimeStatus}
          binaryInstallProgress={binaryInstallProgress}
          binaryCheckResult={modelLoaderBinaryCheck}
          statusMessage={modelLoaderStatusMessage}
          statusKind={modelLoaderStatusKind}
          isBusy={isModelLoading}
          onClose={handleCloseModelLoader}
          onLoadModel={(modelSlug, contextWindowTokens, temperature) => handleLoadModel(modelSlug, contextWindowTokens, temperature)}
          onInstallBinary={() => {
            const server = appSettings.servers.find((s) => s.id === appSettings.activeServerId)
            if (server?.kind === 'llama.cpp') void window.api.installLlamaBinary(server.id)
          }}
        />
      ) : null}

      {isModelParametersOpen ? (
        <ModelParametersModal
          model={activeModel}
          statusMessage={modelParametersStatusMessage}
          statusKind={modelParametersStatusKind}
          isBusy={isModelParametersSaving}
          onClose={handleCloseModelParameters}
          onSaveParameters={(modelSlug, values) => handleSaveModelParameters(modelSlug, values)}
        />
      ) : null}

      {isCharactersOpen ? (
        <CharactersModal
          characters={characters}
          activeCharacterId={activeCharacterId}
          statusMessage={charactersStatusMessage}
          statusKind={charactersStatusKind}
          isBusy={isCharactersBusy}
          onClose={handleCloseCharacters}
          onSelectCharacter={setActiveCharacterId}
          onCreateCharacter={() => {
            void handleCreateCharacter()
          }}
          onSaveCharacter={(character) => handleSaveCharacter(character)}
        />
      ) : null}
      {isSummaryModalOpen ? (
        <Modal
          title="Current Summary"
          onClose={handleCloseSummaryModal}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  void handleRebuildSummary()
                }}
                disabled={!activeSession || isRebuildingSummary}
                style={{
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--surface-bg)',
                  color: 'var(--text-color-primary)',
                  fontWeight: 600,
                }}
              >
                {isRebuildingSummary ? 'Rebuilding Summary...' : 'Rebuild Summary'}
              </button>
            </div>
            {summaryModalStatusMessage ? (
              <div
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${summaryModalStatusKind === 'error' ? 'var(--status-border-error)' : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-md)',
                  color: summaryModalStatusKind === 'error' ? 'var(--status-color-error)' : 'var(--text-color-secondary)',
                  backgroundColor: 'var(--surface-bg)',
                  lineHeight: 1.5,
                }}
              >
                {summaryModalStatusMessage}
              </div>
            ) : null}
          {activeSession ? (
            activeSession.rollingSummary.trim().length > 0 ? (
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-color-primary)', lineHeight: 1.6 }}>
                {activeSession.rollingSummary}
              </div>
            ) : (
              <p style={{ color: 'var(--text-color-secondary)', lineHeight: 1.6 }}>
                No rolling summary has been generated for this session yet.
              </p>
            )
          ) : (
            <p style={{ color: 'var(--text-color-secondary)', lineHeight: 1.6 }}>
              Select a session to view its rolling summary.
            </p>
          )}
          </div>
        </Modal>
      ) : null}
      {isCreateCampaignOpen ? (
        <CreateCampaignModal
          isBusy={isCampaignBusy}
          onClose={() => {
            setIsCreateCampaignOpen(false)
          }}
          onSubmit={(name, description) => {
            void handleCreateCampaignSubmit(name, description)
          }}
          />
        ) : null}
      {isCampaignModalOpen ? (
        <CampaignModal
          campaign={campaign}
          campaignPath={campaignPath}
          recentCampaigns={availableCampaigns}
          isBusy={isCampaignBusy}
          statusMessage={campaignStatusMessage}
          onClose={() => {
            setIsCampaignModalOpen(false)
          }}
          onSaveCurrent={(name, description) => {
            void handleSaveCurrentCampaign(name, description)
          }}
          onCreateCampaign={handleCreateCampaign}
          onOpenFromFile={() => {
            void handleOpenCampaignFromFile()
          }}
          onOpenRecent={(path) => {
            void handleOpenCampaign(path)
          }}
        />
      ) : null}
      {pendingDeleteMessageId ? (
        <Modal
          title="Delete Message"
          onClose={handleCancelDeleteMessage}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p>This will permanently remove the chat bubble from the current session.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" className="characters-modal__footer-btn" onClick={handleCancelDeleteMessage}>
                Cancel
              </button>
              <button
                type="button"
                className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                onClick={handleConfirmDeleteMessage}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {pendingDeleteSessionId ? (
        <Modal
          title="Delete Chat"
          onClose={handleCancelDeleteSession}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p>This will permanently remove the selected chat and its full message history.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" className="characters-modal__footer-btn" onClick={handleCancelDeleteSession}>
                Cancel
              </button>
              <button
                type="button"
                className="characters-modal__footer-btn characters-modal__footer-btn--primary"
                onClick={handleConfirmDeleteSession}
              >
                Delete Chat
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
