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
import { NewSessionModal } from './components/NewSessionModal'
import { SessionCharactersModal } from './components/SessionCharactersModal'
import { ConfirmModal } from './components/ConfirmModal'
import { SummaryModal } from './components/SummaryModal'
import { RelationshipReviewModal } from './components/RelationshipReviewModal'
import { useConfirm } from './hooks/useConfirm'

import { streamCompletion } from './services/aiService'
import { estimateLocalModelFit } from './services/modelFitService'
import {
  buildCampaignBasePrompt,
  buildRollingSummarySystemPrompt,
  DEFAULT_CAMPAIGN_BASE_PROMPT,
  DEFAULT_CHAT_FORMATTING_RULES,
  DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
} from './prompts/campaignPrompts'
import { applyTheme, parseImportedTheme, upsertCustomTheme } from './services/themeService'

import type {
  AppSettings,
  AvailableModel,
  AiDebugEntry,
  BinaryInstallProgress,
  Campaign,
  CampaignLoadProgress,
  CampaignSummary,
  CharacterProfile,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeLoadProgress,
  LocalRuntimeStatus,
  Message,
  ChatMessage,
  ModelDownloadProgress,
  ModelPreset,
  RelationshipGraph,
  ReusableAvatar,
  ReusableCharacter,
  Session,
  TokenUsage,
} from './types'

const DEFAULT_ASSISTANT_RESPONSE_REVEAL_DELAY_MS = 1500
const ASSISTANT_RESPONSE_REVEAL_DELAY_RANGE_MS = {
  min: 0,
  max: 10000,
} as const

const DEFAULT_SETTINGS: AppSettings = {
  servers: [],
  models: [],
  activeServerId: null,
  activeModelSlug: null,
  systemPrompt: 'You are a roleplaying agent responding naturally to the user.',
  campaignBasePrompt: DEFAULT_CAMPAIGN_BASE_PROMPT,
  formattingRules: DEFAULT_CHAT_FORMATTING_RULES,
  rollingSummarySystemPrompt: DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
  enableRollingSummaries: false,
  showChatMarkup: false,
  chatTextSize: 'small',
  assistantResponseRevealDelayMs: DEFAULT_ASSISTANT_RESPONSE_REVEAL_DELAY_MS,
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
const CHAT_LOADING_MIN_DURATION_MS = 220
const CAMPAIGN_LAUNCHER_COMPLETION_HOLD_MS = 480
const MODEL_LOADER_SERVER_KINDS = new Set(['lmstudio', 'text-generation-webui', 'llama.cpp'])
const DIRECTOR_COMPOSER_ID = '__director__'
const DIRECTOR_SPEAKER_NAME = 'Director'

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
 * Determine whether a transcript message is authored by the Director helper.
 *
 * @param message - Message candidate.
 * @returns True when the message should stay out of the live recent-chat prompt window.
 */
function isDirectorMessage(message: Message): boolean {
  return message.role === 'user' && (message.characterName?.trim() ?? '') === DIRECTOR_SPEAKER_NAME
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
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1] ?? null
  const allowTrailingDirectorMessage = lastVisibleMessage !== null && isDirectorMessage(lastVisibleMessage)
  const livePromptMessages = visibleMessages.filter((message, index) => {
    if (!isDirectorMessage(message)) {
      return true
    }

    return allowTrailingDirectorMessage && index === visibleMessages.length - 1
  })

  if (!useRollingSummary) {
    return livePromptMessages
  }

  const recentStartIndex = Math.max(livePromptMessages.length - SUMMARY_RECENT_MESSAGE_COUNT, 0)
  const summarizedCount = session.rollingSummary.trim().length > 0
    ? Math.max(0, Math.floor(session.summarizedMessageCount))
    : 0
  const windowStartIndex = Math.min(summarizedCount, recentStartIndex)

  return livePromptMessages.slice(windowStartIndex)
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
          ? (
            message.characterName?.trim().length
              ? `[${message.characterName.trim()}] ${message.content}`
              : message.content
          )
          : message.content,
    }))
}

/**
 * Normalize a Director note into the required action-style transcript format.
 *
 * @param content - User-authored composer text.
 * @returns Content wrapped in a single pair of asterisks.
 */
function formatDirectorContent(content: string): string {
  const trimmedContent = content.trim()
  if (trimmedContent.startsWith('*') && trimmedContent.endsWith('*') && trimmedContent.length >= 2) {
    return trimmedContent
  }

  return `*${trimmedContent}*`
}

/**
 * Build the inline Relationships block for one character's prompt entry.
 * Returns null when no qualifying relationship entries exist.
 *
 * @param character - Character whose perspective to render.
 * @param activeCharacterIds - IDs of all characters enabled in the current session.
 * @param characterNamesById - Lookup map from character ID to display name.
 * @param graph - Campaign relationship graph, or null when unavailable.
 * @returns Formatted "Relationships:\n→ ..." block, or null.
 */
function buildCharacterRelationshipBlock(
  character: CharacterProfile,
  activeCharacterIds: Set<string>,
  characterNamesById: Map<string, string>,
  graph: RelationshipGraph | null,
): string | null {
  if (!graph || graph.entries.length === 0) return null

  const entries = graph.entries.filter(
    (entry) =>
      entry.fromCharacterId === character.id &&
      activeCharacterIds.has(entry.toCharacterId),
  )
  if (entries.length === 0) return null

  const lines = entries.map((entry) => {
    const targetName = characterNamesById.get(entry.toCharacterId) ?? entry.toCharacterId
    const notesSuffix = entry.manualNotes.trim() ? ` [Note: ${entry.manualNotes.trim()}]` : ''
    return `→ ${targetName} [trust: ${entry.trustScore}/100 | ${entry.affinityLabel}] ${entry.summary}${notesSuffix}`
  })

  return `Relationships:\n${lines.join('\n')}`
}

/**
 * Build the deterministic system-message context sent with every request.
 *
 * @param campaign - Active campaign metadata.
 * @param characters - Characters available in the active campaign.
 * @param session - Session-specific setup and continuity metadata.
 * @param campaignBasePrompt - Persisted base prompt template for campaign play.
 * @param formattingRules - Persisted formatting rules appended after the base prompt.
 * @param customSystemPrompt - User-configured system prompt text.
 * @param sceneSummary - Rolling scene summary, if one exists for the session.
 * @param relationshipGraph - Campaign relationship graph, if available.
 */
function buildSystemContext(
  campaign: Campaign,
  characters: CharacterProfile[],
  session: Session,
  campaignBasePrompt: string,
  formattingRules: string,
  customSystemPrompt: string,
  sceneSummary: string | null,
  relationshipGraph: RelationshipGraph | null = null,
): ChatMessage[] {
  const normalizedCampaignBasePrompt =
    typeof campaignBasePrompt === 'string' ? campaignBasePrompt : DEFAULT_CAMPAIGN_BASE_PROMPT
  const normalizedFormattingRules =
    typeof formattingRules === 'string' ? formattingRules : DEFAULT_CHAT_FORMATTING_RULES
  const normalizedCustomSystemPrompt = typeof customSystemPrompt === 'string' ? customSystemPrompt : ''
  const baseInstruction: ChatMessage = {
    role: 'system',
    content: buildCampaignBasePrompt(normalizedCampaignBasePrompt, normalizedFormattingRules),
  }

  const customInstruction = normalizedCustomSystemPrompt.trim()
    ? `Additional Instructions:\n${normalizedCustomSystemPrompt.trim()}`
    : null

  const campaignContext: ChatMessage = {
    role: 'system',
    content: `Campaign: ${campaign.name}. Setting: ${campaign.description || 'No campaign setting provided.'}`,
  }
  const normalizedSessionTitle =
    typeof session.title === 'string' && session.title.trim().length > 0
      ? session.title.trim()
      : 'New Chat'
  const normalizedSceneSetup =
    typeof session.sceneSetup === 'string'
      ? session.sceneSetup.trim()
      : ''
  const normalizedOpeningNotes =
    typeof session.openingNotes === 'string'
      ? session.openingNotes.trim()
      : ''
  const normalizedContinuitySummary =
    typeof session.continuitySummary === 'string'
      ? session.continuitySummary.trim()
      : ''
  const sessionContextSections = [`Session Title: ${normalizedSessionTitle}`]

  if (normalizedSceneSetup) {
    sessionContextSections.push(`Scene Setup:\n${normalizedSceneSetup}`)
  }

  if (normalizedOpeningNotes) {
    sessionContextSections.push(`Opening Notes:\n${normalizedOpeningNotes}`)
  }

  if (normalizedContinuitySummary) {
    sessionContextSections.push(`Continuity From Previous Session:\n${normalizedContinuitySummary}`)
  }

  sessionContextSections.push(
    'Continuity Rules:\nTreat Session Setup as the starting frame for this session. Treat any previous-session continuity and rolling scene summary as canon context. If the recent transcript conflicts with older context, the recent transcript wins.',
  )

  const sessionContext: ChatMessage = {
    role: 'system',
    content: sessionContextSections.join('\n\n'),
  }

  // Precompute for relationship injection — hoist outside the map loop
  const activeCharacterIds = new Set(characters.map((c) => c.id))
  const characterNamesById = new Map(characters.map((c) => [c.id, c.name]))

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

        // Build relationship block for this character (injected last, after Goals)
        const relationshipBlock = buildCharacterRelationshipBlock(
          character,
          activeCharacterIds,
          characterNamesById,
          relationshipGraph,
        )
        if (relationshipBlock) {
          sections.push(`\n${relationshipBlock}`)
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
      sessionContext.content,
      charactersContext.content,
      summaryContext,
    ].filter((section): section is string => Boolean(section)).join('\n\n'),
  }]
}

/**
 * Read the explicitly active character list for one session as a stable
 * de-duplicated array when available.
 *
 * @param session - Session whose disabled character list should be read.
 * @returns Stable array of active character IDs, or null when no explicit list exists.
 */
function getSessionActiveCharacterIds(session: Session | null): string[] | null {
  if (!session?.activeCharacterIds) {
    return null
  }

  return [...new Set(session.activeCharacterIds.filter((characterId) => characterId.trim().length > 0))]
}

/**
 * Read the disabled character list for one session as a stable de-duplicated
 * array. Missing data is treated as "all campaign characters enabled".
 *
 * @param session - Session whose disabled character list should be read.
 * @returns Stable array of disabled character IDs.
 */
function getSessionDisabledCharacterIds(session: Session | null): string[] {
  if (!session?.disabledCharacterIds) {
    return []
  }

  return [...new Set(session.disabledCharacterIds.filter((characterId) => characterId.trim().length > 0))]
}

/**
 * Return the campaign characters currently enabled for a specific session.
 *
 * @param session - Active session, if any.
 * @param characters - Campaign roster.
 * @returns Characters enabled for that session.
 */
function getEnabledSessionCharacters(
  session: Session | null,
  characters: CharacterProfile[],
): CharacterProfile[] {
  const activeCharacterIds = getSessionActiveCharacterIds(session)
  if (activeCharacterIds) {
    const enabledCharacterIds = new Set(activeCharacterIds)
    return characters.filter((character) => enabledCharacterIds.has(character.id))
  }

  const disabledCharacterIds = new Set(getSessionDisabledCharacterIds(session))
  return characters.filter((character) => !disabledCharacterIds.has(character.id))
}

/**
 * Mark one newly added campaign character as inactive in every existing
 * session so session membership stays opt-in.
 *
 * @param campaign - Campaign whose sessions should be updated.
 * @param characterId - Campaign character ID that was just introduced.
 * @returns Campaign copy with existing sessions updated when needed.
 */
function disableCharacterInExistingSessions(campaign: Campaign, characterId: string): Campaign {
  let didChange = false
  const nextSessions = campaign.sessions.map((session) => {
    const activeCharacterIds = getSessionActiveCharacterIds(session)
    if (activeCharacterIds) {
      return session
    }

    const disabledCharacterIds = new Set(getSessionDisabledCharacterIds(session))
    if (disabledCharacterIds.has(characterId)) {
      return session
    }

    didChange = true
    disabledCharacterIds.add(characterId)
    return {
      ...session,
      disabledCharacterIds: [...disabledCharacterIds],
      updatedAt: Date.now(),
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
 * Determine whether a character appears anywhere in a session transcript.
 *
 * @param session - Session to inspect.
 * @param character - Campaign character to match.
 * @returns True when the character appears in that session.
 */
function hasCharacterAppearedInSession(session: Session, character: CharacterProfile): boolean {
  const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
  return session.messages.some((message) => (
    message.characterId === character.id ||
    message.characterName?.trim().toLocaleLowerCase() === normalizedCharacterName
  ))
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

/** Renderer-side loading state shown on the launcher while a campaign opens. */
interface CampaignLauncherLoadingState {
  /** Headline describing the current open flow. */
  title: string
  /** Human-readable detail for the current phase. */
  detail: string
  /** Approximate completion percentage for the staged progress bar. */
  percent: number | null
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
  trailingInstructions: ChatMessage[] = [],
  relationshipGraph: RelationshipGraph | null = null,
): ChatMessage[] {
  return [
    ...buildSystemContext(
      campaign,
      characters,
      session,
      settings.campaignBasePrompt,
      settings.formattingRules,
      settings.systemPrompt,
      getPromptSceneSummary(session, settings.enableRollingSummaries),
      relationshipGraph,
    ),
    ...toApiMessages(getPromptWindowMessages(session, settings.enableRollingSummaries, pendingMessages)),
    ...trailingInstructions,
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
  rollingSummarySystemPrompt: string,
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
      content: buildRollingSummarySystemPrompt(rollingSummarySystemPrompt),
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
async function requestRollingSummary(
  rollingSummarySystemPrompt: string,
  previousSummary: string,
  transcript: Message[],
): Promise<string> {
  let retryReason: string | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let nextSummary = ''
    await new Promise<void>((resolve, reject) => {
      streamCompletion(
        buildRollingSummaryUpdateMessages(rollingSummarySystemPrompt, previousSummary, transcript, retryReason),
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
  rollingSummarySystemPrompt: string,
  previousSummary: string,
  transcriptBudget: number,
): number {
  let endIndex = startIndex + 1

  while (endIndex <= messages.length) {
    const prompt = buildRollingSummaryUpdateMessages(
      rollingSummarySystemPrompt,
      previousSummary,
      messages.slice(startIndex, endIndex),
    )
    if (estimateTokenCount(prompt) > transcriptBudget) {
      return endIndex === startIndex + 1 ? endIndex : endIndex - 1
    }

    endIndex += 1
  }

  return messages.length
}

/**
 * Rebuild a session summary from the full visible transcript, chunking requests
 * to fit within the current model context window when necessary.
 *
 * @param session - Session whose transcript should be rebuilt.
 * @param onProgress - Optional callback notified before each rebuild pass.
 * @returns Rebuilt summary text plus the covered visible-message count.
 */
async function rebuildSessionSummaryFromTranscript(
  session: Session,
  rollingSummarySystemPrompt: string,
  activeModelContextWindowTokens: number | null,
  onProgress?: (passNumber: number, startIndex: number, endIndex: number, totalCount: number) => void,
): Promise<{
  summary: string
  summarizedMessageCount: number
  passCount: number
}> {
  const visibleMessages = getVisiblePromptMessages(session.messages)
  if (visibleMessages.length === 0) {
    throw new Error('No conversation history is available to summarize.')
  }

  const transcriptBudget = activeModelContextWindowTokens === null || activeModelContextWindowTokens <= 0
    ? Number.POSITIVE_INFINITY
    : Math.max(
      1024,
      Math.floor(activeModelContextWindowTokens * SUMMARY_REBUILD_CONTEXT_FRACTION),
    )

  let nextSummary = ''
  let startIndex = 0
  let passCount = 0

  while (startIndex < visibleMessages.length) {
    passCount += 1
    const endIndex = Number.isFinite(transcriptBudget)
      ? findSummaryChunkEnd(
        visibleMessages,
        startIndex,
        rollingSummarySystemPrompt,
        nextSummary,
        transcriptBudget,
      )
      : visibleMessages.length
    const transcriptChunk = visibleMessages.slice(startIndex, endIndex)

    onProgress?.(passCount, startIndex, endIndex, visibleMessages.length)

    const normalizedPassSummary = await requestRollingSummary(
      rollingSummarySystemPrompt,
      nextSummary,
      transcriptChunk,
    )
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

  return {
    summary: normalizedSummary,
    summarizedMessageCount: visibleMessages.length,
    passCount,
  }
}

/** Parsed assistant bubble content plus optional speaker metadata. */
interface StreamedAssistantBubble {
  /** Bubble text rendered for the assistant message. */
  content: string
  /** Parsed speaker name from the leading marker, if present. */
  characterName?: string
}

/**
 * Restore missing character avatars from the reusable avatar library when a
 * character still knows which reusable avatar it came from.
 *
 * @param characters - Campaign or reusable character list to repair.
 * @param reusableAvatars - Global reusable avatar library.
 * @returns Character list with missing avatar payloads reattached when possible.
 */
function restoreCharacterAvatarsFromLibrary<T extends CharacterProfile | ReusableCharacter>(
  characters: T[],
  reusableAvatars: ReusableAvatar[],
): T[] {
  if (characters.length === 0 || reusableAvatars.length === 0) {
    return characters
  }

  const avatarsById = new Map(reusableAvatars.map((avatar) => [avatar.id, avatar]))
  let didChange = false
  const nextCharacters = characters.map((character) => {
    if (character.avatarImageData || !character.avatarSourceId) {
      return character
    }

    const avatar = avatarsById.get(character.avatarSourceId) ?? null
    if (!avatar) {
      return character
    }

    didChange = true
    return {
      ...character,
      avatarImageData: avatar.imageData,
      avatarCrop: {
        x: avatar.crop.x,
        y: avatar.crop.y,
        scale: avatar.crop.scale,
      },
    }
  })

  return didChange ? nextCharacters : characters
}

/**
 * Remove italic markdown wrapped around bracketed speaker markers so they can
 * be parsed and rendered consistently during streaming.
 *
 * @param content - Raw assistant text accumulated so far.
 * @returns Content with `*[Name]*` rewritten to `[Name]`.
 */
function stripEmphasisFromBracketMarkers(content: string): string {
  return content.replace(/\*\[([^\]\r\n]+)\]\*/g, '[$1]')
}

/**
 * Normalize one streamed assistant marker before bubble parsing continues.
 * Bracket payloads longer than four words are treated as scene narration.
 *
 * @param marker - Raw matched marker including brackets.
 * @param segment - Full segment beginning at the marker.
 * @returns Rewritten segment plus normalized speaker metadata.
 */
function normalizeStreamedAssistantMarker(
  marker: string,
  segment: string,
): {
  segment: string
  speaker: string | null
  normalizedSpeaker: string | null
} {
  const rawSpeaker = marker.slice(1, -1).trim() || null
  if (!rawSpeaker) {
    return {
      segment,
      speaker: null,
      normalizedSpeaker: null,
    }
  }

  const wordCount = rawSpeaker.split(/\s+/).filter(Boolean).length
  if (wordCount <= 4) {
    return {
      segment,
      speaker: rawSpeaker,
      normalizedSpeaker: rawSpeaker.toLocaleLowerCase(),
    }
  }

  return {
    segment: `[Scene] ${rawSpeaker}${segment.slice(marker.length)}`,
    speaker: 'Scene',
    normalizedSpeaker: 'scene',
  }
}

/**
 * Split a streamed assistant reply into discrete bubble payloads.
 * Each bracketed entry like `[Name]` starts a new bubble. Bracket payloads
 * longer than four words are rewritten to `[Scene] ...`. Consecutive entries
 * from the same character remain grouped in a single bubble. PLAYER-controlled
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
  const normalizedContent = stripEmphasisFromBracketMarkers(content)

  if (normalizedContent.length === 0) {
    return [{ content: '' }]
  }

  const segments: StreamedAssistantBubble[] = []
  const markerRegex = /\[[^\]\r\n]+\]/g
  let previousIndex = 0
  let match = markerRegex.exec(normalizedContent)
  let previousSpeaker: string | null = null

  while (match) {
    if (match.index > previousIndex) {
      const leading = normalizedContent.slice(previousIndex, match.index)
      if (leading.trim().length > 0) {
        segments.push({ content: leading })
      } else if (segments.length > 0) {
        segments[segments.length - 1].content += leading
      }
    }

    const nextMatch = markerRegex.exec(normalizedContent)
    const segmentEnd = nextMatch ? nextMatch.index : normalizedContent.length
    const rawSegment = normalizedContent.slice(match.index, segmentEnd)
    const normalizedMarker = normalizeStreamedAssistantMarker(match[0], rawSegment)
    const segment = normalizedMarker.segment
    const speaker = normalizedMarker.speaker
    const normalizedSpeaker = normalizedMarker.normalizedSpeaker

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

  if (previousIndex < normalizedContent.length) {
    const trailing = normalizedContent.slice(previousIndex)
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
 * Attach the best available character ID to one message.
 *
 * @param message - Message to hydrate.
 * @param charactersById - Character lookup by ID.
 * @param charactersByName - Character lookup by normalized name.
 * @returns Original message when unchanged, otherwise a copy with `characterId`.
 */
function hydrateMessageCharacterId(
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
  if (message.characterId === nextCharacterId) {
    return message
  }

  return {
    ...message,
    characterId: nextCharacterId,
  }
}

/**
 * Reattach character IDs and session character toggle state using the active
 * campaign character roster.
 *
 * @param campaign - Campaign whose session messages should be hydrated.
 * @param characters - Character roster available for matching.
 * @returns Campaign copy with message character IDs filled where possible.
 */
function hydrateCampaignMessageCharacterIds(campaign: Campaign, characters: CharacterProfile[]): Campaign {
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const charactersByName = new Map(
    characters.map((character) => [character.name.trim().toLocaleLowerCase(), character]),
  )

  let didChange = false
  const nextSessions = campaign.sessions.map((session) => {
    let sessionChanged = false
    const storedActiveCharacterIds = getSessionActiveCharacterIds(session)
    const nextActiveCharacterIds = storedActiveCharacterIds
      ? storedActiveCharacterIds
      : characters
        .filter((character) => !getSessionDisabledCharacterIds(session).includes(character.id))
        .map((character) => character.id)
    const nextDisabledCharacterIds = getSessionDisabledCharacterIds(session)
    const activeIdsChanged =
      !session.activeCharacterIds ||
      nextActiveCharacterIds.length !== session.activeCharacterIds.length ||
      nextActiveCharacterIds.some((characterId, index) => characterId !== session.activeCharacterIds?.[index])
    const disabledIdsChanged =
      !session.disabledCharacterIds ||
      nextDisabledCharacterIds.length !== session.disabledCharacterIds.length ||
      nextDisabledCharacterIds.some((characterId, index) => characterId !== session.disabledCharacterIds?.[index])

    const nextMessages = characters.length > 0
      ? session.messages.map((message) => {
        const nextMessage = hydrateMessageCharacterId(message, charactersById, charactersByName)
        if (nextMessage !== message) {
          sessionChanged = true
        }
        return nextMessage
      })
      : session.messages

    if (!sessionChanged && !activeIdsChanged && !disabledIdsChanged) {
      return session
    }

    didChange = true
    return {
      ...session,
      activeCharacterIds: nextActiveCharacterIds,
      disabledCharacterIds: nextDisabledCharacterIds,
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
 * Convert main-process campaign-load progress into launcher loading copy.
 *
 * @param progress - Current disk-loading progress update.
 * @returns Launcher-friendly loading title, detail, and percent.
 */
function toCampaignLauncherLoadingState(progress: CampaignLoadProgress): CampaignLauncherLoadingState {
  if (progress.status === 'loading-chats') {
    const chatLabel = progress.totalSessions === 1 ? 'chat' : 'chats'
    return {
      title: progress.totalSessions > 0 ? 'Loading Chats' : 'Loading Campaign',
      detail: progress.totalSessions > 0
        ? `Loading ${chatLabel} ${progress.sessionsLoaded} of ${progress.totalSessions}…`
        : 'Reading campaign data from disk…',
      percent: progress.percent,
    }
  }

  if (progress.status === 'loading-characters') {
    const characterLabel = progress.totalSessions === 1 ? 'character' : 'characters'
    return {
      title: progress.totalSessions > 0 ? 'Loading Characters' : 'Finalizing Campaign',
      detail: progress.totalSessions > 0
        ? `Loading ${characterLabel} ${progress.sessionsLoaded} of ${progress.totalSessions}…`
        : 'No stored characters found. Finalizing campaign…',
      percent: progress.percent,
    }
  }

  if (progress.status === 'complete') {
    return {
      title: 'Campaign Ready',
      detail: progress.message,
      percent: progress.percent,
    }
  }

  if (progress.status === 'error') {
    return {
      title: 'Loading Campaign',
      detail: progress.message,
      percent: 0,
    }
  }

  return {
    title: 'Loading Campaign',
    detail: progress.message,
    percent: progress.percent,
  }
}

/**
 * Wait for the browser to paint one more frame so a loading-state update can
 * appear before the next async step begins.
 *
 * @returns Promise resolving after two animation frames.
 */
function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

/**
 * Delay for a fixed number of milliseconds.
 *
 * @param ms - Minimum time to wait.
 * @returns Promise resolving after the timeout elapses.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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

  /** Campaign-level character relationship graph; null until loaded. */
  const [relationshipGraph, setRelationshipGraph] = useState<RelationshipGraph | null>(null)

  /** True while a relationship refresh LLM call is in flight. */
  const [isRefreshingRelationships, setIsRefreshingRelationships] = useState(false)

  /** Inline error shown on the DetailsPanel refresh button. */
  const [refreshRelationshipsError, setRefreshRelationshipsError] = useState<string | null>(null)

  /** Merged graph returned by the LLM, pending user review in RelationshipReviewModal. */
  const [pendingRelationshipGraph, setPendingRelationshipGraph] = useState<RelationshipGraph | null>(null)

  /** Timestamp recorded when the most recent refresh call was dispatched. */
  const [refreshStartedAt, setRefreshStartedAt] = useState<number>(0)

  const { confirm, confirmState } = useConfirm()

  /** ID of the session currently displayed in the chat area. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  /** ID of the session currently highlighted in the sidebar. */
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  /** True while the chat panel is switching to a different session transcript. */
  const [isChatLoading, setIsChatLoading] = useState(false)

  /** Controlled value for the message composer textarea. */
  const [inputValue, setInputValue] = useState('')

  /** Incremented when the composer should reclaim keyboard focus. */
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0)

  /** True while a streaming AI response is in-flight. */
  const [isStreaming, setIsStreaming] = useState(false)

  /** Currently active ribbon navigation tab. */
  const [activeTab, setActiveTab] = useState('')

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
  /** Ref holding the latest campaign-load progress event emitted by the main process. */
  const campaignLoadProgressRef = useRef<CampaignLoadProgress | null>(null)
  /** Skip the next campaign-path-driven character refresh when characters were already loaded. */
  const skipNextCharacterRefreshRef = useRef(false)
  /** Tracks whether any modal or confirmation dialog was open in the previous render. */
  const wasModalOpenRef = useRef(false)
  /** Per-session delayed summary timers. */
  const summaryTimeoutsRef = useRef<Record<string, number | undefined>>({})
  /** Per-session rolling-summary jobs currently executing. */
  const summaryPromisesRef = useRef<Record<string, Promise<void> | undefined>>({})
  /** Sessions currently being summarized in the background. */
  const summaryInFlightRef = useRef<Set<string>>(new Set())
  /** Sessions that should be summarized again after the current pass finishes. */
  const summaryRerunRef = useRef<Set<string>>(new Set())
  /** Sessions whose transcript edits require a full summary rebuild before reuse. */
  const summaryDirtySessionsRef = useRef<Set<string>>(new Set())
  /** Pending animation-frame handles used to stage session switches. */
  const sessionSwitchFrameRef = useRef<number | null>(null)
  /** Timestamp marking when the current chat-loading overlay became visible. */
  const chatLoadingStartedAtRef = useRef<number | null>(null)
  /** Pending timeout used to keep the loading overlay visible long enough to register visually. */
  const chatLoadingTimeoutRef = useRef<number | null>(null)

  /** Timestamp recorded the moment a relationship refresh call is dispatched. Used to badge "updated" entries in the review modal. */
  const refreshStartedAtRef = useRef<number>(0)

  /** Detected local hardware inventory used for llama.cpp fit guidance. */
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null)

  /** Current managed local llama.cpp runtime status. */
  const [localRuntimeStatus, setLocalRuntimeStatus] = useState<LocalRuntimeStatus | null>(null)

  /** Current startup progress for the managed local llama.cpp runtime. */
  const [localRuntimeLoadProgress, setLocalRuntimeLoadProgress] = useState<LocalRuntimeLoadProgress | null>(null)

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
  /** True while the session character management modal is open. */
  const [isSessionCharactersOpen, setIsSessionCharactersOpen] = useState(false)
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
  /** Staged launcher loading state used while opening a campaign from the startup screen. */
  const [campaignLauncherLoadingState, setCampaignLauncherLoadingState] = useState<CampaignLauncherLoadingState | null>(null)
  /** Current main-process campaign-open progress, when one is active. */
  const [campaignLoadProgress, setCampaignLoadProgress] = useState<CampaignLoadProgress | null>(null)

  /** Campaign summaries available to open from the launcher. */
  const [availableCampaigns, setAvailableCampaigns] = useState<CampaignSummary[]>([])

  /** Characters available for the active campaign. */
  const [characters, setCharacters] = useState<CharacterProfile[]>([])
  /** Globally saved avatars available across campaigns. */
  const [reusableAvatars, setReusableAvatars] = useState<ReusableAvatar[]>([])
  /** Globally saved characters available across campaigns. */
  const [reusableCharacters, setReusableCharacters] = useState<ReusableCharacter[]>([])

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
  /** Status message shown in the avatar library modal. */
  const [avatarLibraryStatusMessage, setAvatarLibraryStatusMessage] = useState<string | null>(null)
  /** Visual state of the avatar library status message. */
  const [avatarLibraryStatusKind, setAvatarLibraryStatusKind] = useState<'error' | 'success' | null>(null)
  /** True while a reusable avatar operation is in progress. */
  const [isAvatarLibraryBusy, setIsAvatarLibraryBusy] = useState(false)
  /** Status message shown in the character library modal sections. */
  const [characterLibraryStatusMessage, setCharacterLibraryStatusMessage] = useState<string | null>(null)
  /** Visual state of the character library status text. */
  const [characterLibraryStatusKind, setCharacterLibraryStatusKind] = useState<'error' | 'success' | null>(null)
  /** True while a reusable character operation is in progress. */
  const [isCharacterLibraryBusy, setIsCharacterLibraryBusy] = useState(false)
  /** Status message shown in the new-session character picker. */
  const [newSessionStatusMessage, setNewSessionStatusMessage] = useState<string | null>(null)
  /** Visual state of the new-session status message. */
  const [newSessionStatusKind, setNewSessionStatusKind] = useState<'error' | 'success' | null>(null)
  /** True while importing characters and creating a new session. */
  const [isStartingSession, setIsStartingSession] = useState(false)

  /** True while the create campaign modal is open. */
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false)
  /** True while the campaign management modal is open. */
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false)
  /** True while the model loader modal is open. */
  const [isModelLoaderOpen, setIsModelLoaderOpen] = useState(false)
  /** True while the new-session character picker modal is open. */
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false)
  /** Server/source currently selected in the model loader modal. */
  const [modelLoaderServerId, setModelLoaderServerId] = useState<string | null>(null)
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
    const disposeRuntimeLoadProgressListener = window.api.onLocalRuntimeLoadProgress((progress) => {
      setLocalRuntimeLoadProgress(progress)
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
    const disposeCampaignLoadListener = window.api.onCampaignLoadProgress((progress) => {
      setCampaignLoadProgress(progress)
      setCampaignLauncherLoadingState(toCampaignLauncherLoadingState(progress))
    })

    return () => {
      cancelled = true
      disposeRuntimeListener()
      disposeRuntimeLoadProgressListener()
      disposeDownloadListener()
      disposeBinaryInstallListener()
      disposeCampaignLoadListener()
    }
  }, [])

  // Keep the settings ref in sync so event listeners in empty-dep useEffects can read current values.
  appSettingsRef.current = appSettings
  campaignRef.current = campaign
  campaignLoadProgressRef.current = campaignLoadProgress
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
    void refreshReusableAvatars()
    void refreshReusableCharacters()
  }, [])

  useEffect(() => {
    setCharacters((prev) => restoreCharacterAvatarsFromLibrary(prev, reusableAvatars))
    setReusableCharacters((prev) => restoreCharacterAvatarsFromLibrary(prev, reusableAvatars))
  }, [reusableAvatars])

  /**
   * Load campaign-scoped characters whenever the active campaign path changes.
   */
  useEffect(() => {
    if (!campaignPath) {
      setCharacters([])
      setActiveCharacterId(null)
      setComposerCharacterId(null)
      setRelationshipGraph(null)
      return
    }

    if (skipNextCharacterRefreshRef.current) {
      skipNextCharacterRefreshRef.current = false
      return
    }

    void refreshCharacters(campaignPath)
  }, [campaignPath])

  /**
   * Load the relationship graph when a campaign opens.
   */
  useEffect(() => {
    if (campaignPath && campaign?.id) {
      void window.api.getRelationships(campaignPath, campaign.id).then((graph) => {
        setRelationshipGraph(graph)
      }).catch((err: unknown) => {
        console.error('[Aethra] Could not load relationship graph:', err)
      })
    } else {
      setRelationshipGraph(null)
    }
  }, [campaignPath, campaign?.id])

  /* ── Derived values ─────────────────────────────────────────────────── */

  /** All roleplay sessions available in the sidebar. */
  const sessions = campaign?.sessions ?? []

  /** The full session object for the active session (or null). */
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  /** True while a campaign switch is showing the dedicated full-screen loading state. */
  const isCampaignSwitchLoading = campaignLauncherLoadingState !== null
  /** True when any modal or confirmation dialog is currently covering the workspace. */
  const isAnyModalOpen =
    isSettingsOpen ||
    isCharactersOpen ||
    isNewSessionModalOpen ||
    isSessionCharactersOpen ||
    isSummaryModalOpen ||
    isCreateCampaignOpen ||
    isCampaignModalOpen ||
    isModelLoaderOpen ||
    isModelParametersOpen ||
    isAiDebugOpen ||
    pendingDeleteMessageId !== null ||
    pendingDeleteSessionId !== null

  /**
   * Restore composer focus once the last open modal or confirmation dialog closes.
   */
  useEffect(() => {
    if (wasModalOpenRef.current && !isAnyModalOpen) {
      setComposerFocusRequestKey((prev) => prev + 1)
    }

    wasModalOpenRef.current = isAnyModalOpen
  }, [isAnyModalOpen])

  /** Messages belonging to the active session. */
  const messages: Message[] = activeSession?.messages ?? []
  /** Campaign characters currently enabled for the active session. */
  /**
   * Cancel any scheduled session activation that has not executed yet.
   */
  function clearScheduledSessionSwitch(): void {
    if (sessionSwitchFrameRef.current == null) {
      return
    }

    window.cancelAnimationFrame(sessionSwitchFrameRef.current)
    sessionSwitchFrameRef.current = null
  }

  /**
   * Cancel any pending delayed reveal for the chat transcript.
   */
  function clearScheduledChatReveal(): void {
    if (chatLoadingTimeoutRef.current == null) {
      return
    }

    window.clearTimeout(chatLoadingTimeoutRef.current)
    chatLoadingTimeoutRef.current = null
  }

  /**
   * Stage a session switch so the loading affordance can paint before a large
   * transcript render blocks the renderer for a moment.
   *
   * @param nextSessionId - Session to activate.
   */
  function scheduleSessionActivation(nextSessionId: string): void {
    if (nextSessionId === activeSessionId) {
      clearScheduledChatReveal()
      chatLoadingStartedAtRef.current = null
      setSelectedSessionId(nextSessionId)
      setIsChatLoading(false)
      return
    }

    clearScheduledSessionSwitch()
    clearScheduledChatReveal()
    setSelectedSessionId(nextSessionId)
    chatLoadingStartedAtRef.current = Date.now()
    setIsChatLoading(true)

    sessionSwitchFrameRef.current = window.requestAnimationFrame(() => {
      sessionSwitchFrameRef.current = window.requestAnimationFrame(() => {
        sessionSwitchFrameRef.current = null
        setActiveSessionId(nextSessionId)
      })
    })
  }

  const enabledSessionCharacters = useMemo(
    () => getEnabledSessionCharacters(activeSession, characters),
    [activeSession, characters],
  )

  /** The character currently selected for the next outgoing user message. */
  const composerCharacter =
    enabledSessionCharacters.find((character) => character.id === composerCharacterId) ?? null
  const isDirectorComposerSelected = composerCharacterId === DIRECTOR_COMPOSER_ID

  /** The currently selected AI server from persisted settings. */
  const activeServer =
    appSettings.servers.find((server) => server.id === appSettings.activeServerId) ??
    appSettings.servers[0] ??
    null

  /** Model presets available for the active server. */
  const activeServerModels: ModelPreset[] = activeServer
    ? appSettings.models.filter((model) => model.serverId === activeServer.id)
    : []

  /** Server profiles that can appear in the model loader source selector. */
  const modelLoaderServers = useMemo(
    () => appSettings.servers.filter((server) => MODEL_LOADER_SERVER_KINDS.has(server.kind)),
    [appSettings.servers],
  )

  /** Currently selected server/source inside the model loader modal. */
  const modelLoaderServer =
    modelLoaderServers.find((server) => server.id === modelLoaderServerId) ??
    modelLoaderServers[0] ??
    null

  /** Model presets available for the server/source currently selected in the model loader. */
  const modelLoaderServerModels: ModelPreset[] = modelLoaderServer
    ? appSettings.models.filter((model) => model.serverId === modelLoaderServer.id)
    : []

  /** Current model selection associated with the chosen model-loader source. */
  const modelLoaderCurrentModelSlug =
    modelLoaderServer && appSettings.activeServerId === modelLoaderServer.id
      ? appSettings.activeModelSlug
      : null

  /** Effective model preset shown as selected inside the model loader. */
  const modelLoaderActiveModel =
    modelLoaderServerModels.find((model) => model.slug === modelLoaderCurrentModelSlug) ??
    modelLoaderServerModels[0] ??
    null

  /** True when at least one compatible source is available in the model loader. */
  const canLoadModel = modelLoaderServers.length > 0

  /** True when the selected server is the managed local llama.cpp provider. */
  const isLocalLlamaActive = activeServer?.kind === 'llama.cpp'

  /** The currently selected AI model from persisted settings. */
  const activeModel =
    activeServerModels.find((model) => model.slug === appSettings.activeModelSlug) ??
    activeServerModels[0] ??
    null

  /** True when the active server has a model that is actually ready for chat. */
  const isChatModelReady = activeServer?.kind === 'llama.cpp'
    ? localRuntimeStatus?.serverId === activeServer.id &&
      localRuntimeStatus.state === 'running' &&
      localRuntimeStatus.modelSlug !== null
    : activeServer != null && appSettings.activeModelSlug !== null

  /** True when runtime parameters can be edited for the active model preset. */
  const canEditModelParameters = activeModel !== null

  /** Heuristic GPU fit guidance for the active local model, when applicable. */
  const activeLocalModelFit = useMemo(
    () => isLocalLlamaActive
      ? estimateLocalModelFit(activeModel, hardwareInfo, activeModel?.contextWindowTokens ?? null)
      : null,
    [activeModel, hardwareInfo, isLocalLlamaActive],
  )

  /** Heuristic GPU fit guidance for the selected model-loader source, when local llama.cpp is chosen. */
  const modelLoaderLocalModelFit = useMemo(
    () => modelLoaderServer?.kind === 'llama.cpp'
      ? estimateLocalModelFit(modelLoaderActiveModel, hardwareInfo, modelLoaderActiveModel?.contextWindowTokens ?? null)
      : null,
    [modelLoaderActiveModel, modelLoaderServer?.kind, hardwareInfo],
  )

  /** True when the selected model-loader source already has a model selected or running. */
  const modelLoaderHasLoadedModel = modelLoaderServer?.kind === 'llama.cpp'
    ? localRuntimeStatus?.serverId === modelLoaderServer.id &&
      localRuntimeStatus.state === 'running' &&
      localRuntimeStatus.modelSlug !== null
    : modelLoaderServer != null &&
      appSettings.activeServerId === modelLoaderServer.id &&
      appSettings.activeModelSlug !== null

  /**
   * Keep the model-loader source pinned to a valid compatible server profile.
   */
  useEffect(() => {
    if (modelLoaderServerId && modelLoaderServers.some((server) => server.id === modelLoaderServerId)) {
      return
    }

    setModelLoaderServerId(modelLoaderServers[0]?.id ?? null)
  }, [modelLoaderServerId, modelLoaderServers])

  /**
   * Refresh llama.cpp binary status whenever the model loader opens on an embedded source.
   */
  useEffect(() => {
    if (!isModelLoaderOpen) {
      return
    }

    if (modelLoaderServer?.kind === 'llama.cpp') {
      window.api.checkLlamaBinary(modelLoaderServer.id)
        .then((result) => { setModelLoaderBinaryCheck(result) })
        .catch(() => { setModelLoaderBinaryCheck(null) })
      return
    }

    setModelLoaderBinaryCheck(null)
  }, [isModelLoaderOpen, modelLoaderServer?.id, modelLoaderServer?.kind])

  /** Stable system-context payload for the active campaign. */
  const systemContextMessages = useMemo(() => {
    if (!campaign || !activeSession) {
      return []
    }

    return buildSystemContext(
      campaign,
      enabledSessionCharacters,
      activeSession,
      appSettings.campaignBasePrompt,
      appSettings.formattingRules,
      appSettings.systemPrompt,
      getPromptSceneSummary(activeSession, appSettings.enableRollingSummaries),
      relationshipGraph,
    )
  }, [
    activeSession,
    appSettings.campaignBasePrompt,
    appSettings.enableRollingSummaries,
    appSettings.formattingRules,
    appSettings.systemPrompt,
    relationshipGraph,
    campaign,
    enabledSessionCharacters,
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

  /** Tokens shown in the UI, preferring exact prompt usage from the last completed response. */
  const usedTokens = lastTokenUsage?.promptTokens ?? estimatedPromptTokens

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
  }, [activeSessionId, activeSession?.disabledCharacterIds, campaignPath, activeModel?.id, campaign?.id, characters])

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
    if (composerCharacterId === DIRECTOR_COMPOSER_ID) {
      return
    }

    if (enabledSessionCharacters.length === 0) {
      if (composerCharacterId !== null) {
        setComposerCharacterId(null)
      }
      return
    }

    const stillExists = enabledSessionCharacters.some((character) => character.id === composerCharacterId)
    if (stillExists) {
      return
    }

    const defaultCharacter =
      enabledSessionCharacters.find((character) => character.controlledBy === 'user') ??
      enabledSessionCharacters[0] ??
      null

    setComposerCharacterId(defaultCharacter?.id ?? null)
  }, [composerCharacterId, enabledSessionCharacters])

  /**
   * Keep the active session selection valid whenever the campaign changes.
   */
  useEffect(() => {
    return () => {
      clearScheduledSessionSwitch()
      clearScheduledChatReveal()
    }
  }, [])

  useEffect(() => {
    if (!campaign) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      if (selectedSessionId !== null) {
        setSelectedSessionId(null)
      }
      return
    }

    if (campaign.sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null)
      }
      if (selectedSessionId !== null) {
        setSelectedSessionId(null)
      }
      return
    }

    const hasActiveSession = campaign.sessions.some((session) => session.id === activeSessionId)
    if (!hasActiveSession) {
      setActiveSessionId(campaign.sessions[0].id)
    }

    const hasSelectedSession = campaign.sessions.some((session) => session.id === selectedSessionId)
    if (!hasSelectedSession) {
      setSelectedSessionId(hasActiveSession ? activeSessionId : campaign.sessions[0].id)
    }
  }, [activeSessionId, campaign, selectedSessionId])

  /**
   * Rebuild missing character IDs whenever a session is opened for display.
   */
  useEffect(() => {
    if (!campaign || !activeSessionId || characters.length === 0) {
      return
    }

    setCampaign((prev) => {
      if (!prev) {
        return prev
      }

      const nextCampaign = hydrateCampaignMessageCharacterIds(prev, characters)
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
   * Update the launcher loading screen and yield long enough for the renderer
   * to paint the next staged progress state.
   *
   * @param nextState - Loading title, detail, and progress percent.
   */
  async function stageCampaignLauncherLoading(nextState: CampaignLauncherLoadingState): Promise<void> {
    setCampaignLauncherLoadingState(nextState)
    await waitForNextPaint()
  }

  /**
   * Refresh the stored characters for the active campaign.
   *
   * @param path - Absolute campaign folder path.
   */
  async function refreshCharacters(path: string): Promise<void> {
    try {
      const nextCharacters = restoreCharacterAvatarsFromLibrary(await window.api.listCharacters(path), reusableAvatars)
      setCharacters(nextCharacters)
      setActiveCharacterId((prev) =>
        nextCharacters.some((character) => character.id === prev)
          ? prev
          : (nextCharacters[0]?.id ?? null),
      )
      setCampaign((prev) => prev ? hydrateCampaignMessageCharacterIds(prev, nextCharacters) : prev)
    } catch (err) {
      console.error('[Aethra] Could not load characters:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Could not load campaign characters.')
    }
  }

  /**
   * Append or update a message inside a specific session.
   * If a message with `msg.id` already exists it is replaced; otherwise appended.
   * New messages are summarized incrementally by the background rolling-summary
   * worker, so only destructive transcript edits should mark a session dirty.
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
            ? characters.find((character) => character.name.trim().toLocaleLowerCase() === bubble.characterName?.trim().toLocaleLowerCase()) ?? null
            : null
          return {
            id: messageIds[index],
            role: 'assistant' as const,
            characterId: matchedCharacter?.id,
            characterName: bubble.characterName ?? matchedCharacter?.name,
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
   * When no session is active, require the normal session-creation flow so
   * active characters are selected explicitly and persisted correctly.
   *
   * @returns Active session ID, or null when the user must create one first.
   */
  function ensureActiveSession(): string | null {
    if (activeSessionId) {
      return activeSessionId
    }

    setNewSessionStatusKind('error')
    setNewSessionStatusMessage('Start a session and choose its active characters before sending messages.')
    setIsNewSessionModalOpen(true)
    return null
  }

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty session, add it to the list, and make it active.
   */
  function handleNewSession(): void {
    setNewSessionStatusKind(null)
    setNewSessionStatusMessage(null)
    setIsNewSessionModalOpen(true)
  }

  /**
   * Switch the active session.
   * @param id - ID of the session to activate.
   */
  function handleSelectSession(id: string) {
    scheduleSessionActivation(id)
  }

  /**
   * Reveal the newly mounted transcript after the chat pane has jumped to the bottom.
   */
  function handleChatReady(): void {
    clearScheduledChatReveal()

    const startedAt = chatLoadingStartedAtRef.current
    if (startedAt == null) {
      setIsChatLoading(false)
      return
    }

    const remainingMs = Math.max(CHAT_LOADING_MIN_DURATION_MS - (Date.now() - startedAt), 0)
    if (remainingMs === 0) {
      chatLoadingStartedAtRef.current = null
      setIsChatLoading(false)
      return
    }

    chatLoadingTimeoutRef.current = window.setTimeout(() => {
      chatLoadingTimeoutRef.current = null
      chatLoadingStartedAtRef.current = null
      setIsChatLoading(false)
    }, remainingMs)
  }

  /**
   * Enable or disable one campaign character for the active session.
   *
   * If the character has already appeared in the transcript, disabling them
   * requires confirmation because it can change continuity.
   *
   * @param characterId - Character being toggled.
   */
  async function handleToggleSessionCharacter(characterId: string): Promise<void> {
    if (!activeSession || !campaign) {
      return
    }

    const character = characters.find((candidate) => candidate.id === characterId) ?? null
    if (!character) {
      return
    }

    const activeCharacterIds = new Set(
      getSessionActiveCharacterIds(activeSession) ?? characters.map((candidate) => candidate.id),
    )
    const disabledCharacterIds = new Set(getSessionDisabledCharacterIds(activeSession))
    const isCurrentlyEnabled = activeCharacterIds.has(characterId)

    if (isCurrentlyEnabled) {
      const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
      const appearsInSession = activeSession.messages.some((message) => (
        message.characterId === characterId ||
        message.characterName?.trim().toLocaleLowerCase() === normalizedCharacterName
      ))

      if (appearsInSession) {
        const confirmed = await confirm({
          title: 'Turn Off Character',
          message: `${character.name} already appears in this session's chat history. Turning them off may affect continuity and the flow of the session. Continue?`,
          confirmLabel: 'Turn Off',
        })

        if (!confirmed) {
          return
        }
      }

      disabledCharacterIds.add(characterId)
      activeCharacterIds.delete(characterId)
    } else {
      disabledCharacterIds.delete(characterId)
      activeCharacterIds.add(characterId)
    }

    const now = Date.now()
    const nextCampaign: Campaign = {
      ...campaign,
      updatedAt: now,
      sessions: campaign.sessions.map((session) => (
        session.id === activeSession.id
          ? {
            ...session,
            activeCharacterIds: characters
              .filter((candidate) => activeCharacterIds.has(candidate.id))
              .map((candidate) => candidate.id),
            disabledCharacterIds: [...disabledCharacterIds],
            updatedAt: now,
          }
          : session
      )),
    }

    setCampaign(nextCampaign)
    if (campaignPath) {
      void window.api.saveCampaign(campaignPath, nextCampaign)
        .then(() => {
          lastSavedCampaignRef.current = nextCampaign
        })
        .catch((err) => {
          console.error('[Aethra] Could not save session character changes:', err)
          setCampaignStatusMessage('Could not save the active session cast.')
        })
    }
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
      setSelectedSessionId(nextSession?.id ?? null)
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
    resetRollingSummary(activeSession.id)
    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== activeSession.id) {
          return session
        }

        const nextMessages = session.messages.filter((candidate) => candidate.id !== messageId)
        return {
          ...session,
          messages: nextMessages,
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
    setCharacters([])
    setActiveCharacterId(null)
    setComposerCharacterId(null)

    try {
      const created = await window.api.createCampaign(name, description)
      const nextCharacters = restoreCharacterAvatarsFromLibrary(await window.api.listCharacters(created.path), reusableAvatars)
      const hydratedCampaign = hydrateCampaignMessageCharacterIds(created.campaign, nextCharacters)
      skipNextCharacterRefreshRef.current = true
      setCharacters(nextCharacters)
      setActiveCharacterId(nextCharacters[0]?.id ?? null)
      setCampaign(hydratedCampaign)
      setCampaignPath(created.path)
      setActiveSessionId(hydratedCampaign.sessions[0]?.id ?? null)
      setSelectedSessionId(hydratedCampaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = hydratedCampaign
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
    setCampaignLoadProgress(null)
    setIsCampaignModalOpen(false)
    setCharacters([])
    setActiveCharacterId(null)
    setComposerCharacterId(null)

    try {
      await stageCampaignLauncherLoading({
        title: 'Loading Campaign',
        detail: 'Connecting to campaign storage…',
        percent: 2,
      })

      const opened = await window.api.openCampaign(path)
      const diskLoadState = campaignLoadProgressRef.current
        ? toCampaignLauncherLoadingState(campaignLoadProgressRef.current)
        : null
      if (diskLoadState) {
        await stageCampaignLauncherLoading(diskLoadState)
      }
      await wait(CAMPAIGN_LAUNCHER_COMPLETION_HOLD_MS)

      const nextCharacters = restoreCharacterAvatarsFromLibrary(opened.characters ?? [], reusableAvatars)
      const hydratedCampaign = hydrateCampaignMessageCharacterIds(opened.campaign, nextCharacters)

      skipNextCharacterRefreshRef.current = true
      setCharacters(nextCharacters)
      setActiveCharacterId(nextCharacters[0]?.id ?? null)
      setCampaign(hydratedCampaign)
      setCampaignPath(opened.path)
      setActiveSessionId(hydratedCampaign.sessions[0]?.id ?? null)
      setSelectedSessionId(hydratedCampaign.sessions[0]?.id ?? null)
      lastSavedCampaignRef.current = hydratedCampaign
      setCampaignLauncherLoadingState(null)

      await refreshCampaigns()
    } catch (err) {
      console.error('[Aethra] Could not open campaign:', err)
      setCampaignStatusMessage(err instanceof Error ? err.message : 'Could not open campaign.')
    } finally {
      setCampaignLoadProgress(null)
      setCampaignLauncherLoadingState(null)
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
      if (campaignRef.current === null && campaignLauncherLoadingState === null) {
        setIsCampaignBusy(false)
      }
    }
  }

  /**
   * Trigger an LLM relationship refresh for the active session.
   * On success, opens the RelationshipReviewModal with the merged graph.
   * Only analyzes characters active in the current session and its messages.
   */
  async function handleRefreshRelationships(): Promise<void> {
    if (!campaign || !campaignPath || !activeSession || characters.length < 2 || isRefreshingRelationships) return
    setIsRefreshingRelationships(true)
    setRefreshRelationshipsError(null)
    // Record the dispatch timestamp BEFORE the async call so entries updated
    // in this specific refresh can be identified in the review modal.
    const startedAt = Date.now()
    refreshStartedAtRef.current = startedAt
    setRefreshStartedAt(startedAt)
    try {
      const sessionCharacters = getEnabledSessionCharacters(activeSession, characters)
      const merged = await window.api.refreshRelationships(
        campaignPath,
        campaign.id,
        sessionCharacters,
        [activeSession],
      )
      setPendingRelationshipGraph(merged)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Refresh failed. Try again.'
      setRefreshRelationshipsError(message)
    } finally {
      setIsRefreshingRelationships(false)
    }
  }

  /**
   * Persist the given relationship graph to disk and update renderer state.
   *
   * @param graph - Graph to save.
   */
  async function handleSaveRelationships(graph: RelationshipGraph): Promise<void> {
    if (!campaignPath) return
    await window.api.saveRelationships(campaignPath, graph)
    setRelationshipGraph(graph)
  }

  /**
   * Delete both directions of a relationship pair (A→B and B→A) after confirmation.
   *
   * @param fromId - Source character ID.
   * @param toId - Target character ID.
   */
  async function handleDeleteRelationshipPair(fromId: string, toId: string): Promise<void> {
    if (!campaignPath || !relationshipGraph) return
    const fromName = characters.find((c) => c.id === fromId)?.name ?? fromId
    const toName = characters.find((c) => c.id === toId)?.name ?? toId
    const confirmed = await confirm({
      title: 'Delete Relationship Pair',
      message: `This will delete the relationship between ${fromName} and ${toName} in both directions.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) return
    const nextEntries = relationshipGraph.entries.filter(
      (entry) =>
        !(entry.fromCharacterId === fromId && entry.toCharacterId === toId) &&
        !(entry.fromCharacterId === toId && entry.toCharacterId === fromId),
    )
    const nextGraph: RelationshipGraph = { ...relationshipGraph, entries: nextEntries }
    await handleSaveRelationships(nextGraph)
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
      setIsCampaignModalOpen(true)
      return
    }

    if (tabId === 'characters') {
      setCharactersStatusKind(null)
      setCharactersStatusMessage(null)
      setAvatarLibraryStatusKind(null)
      setAvatarLibraryStatusMessage(null)
      setCharacterLibraryStatusKind(null)
      setCharacterLibraryStatusMessage(null)
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
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Close the new-session character picker modal.
   */
  function handleCloseNewSessionModal(): void {
    if (isStartingSession) {
      return
    }

    setIsNewSessionModalOpen(false)
    setNewSessionStatusKind(null)
    setNewSessionStatusMessage(null)
  }

  /**
   * Open the session character management modal.
   */
  function handleOpenSessionCharacters(): void {
    setIsSessionCharactersOpen(true)
  }

  /**
   * Close the session character management modal.
   */
  function handleCloseSessionCharacters(): void {
    setIsSessionCharactersOpen(false)
    setComposerFocusRequestKey((prev) => prev + 1)
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
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Rebuild the active session summary from as much raw transcript as the
   * current model context should allow in one request.
   * Also generates a relationship-focused narrative summary after rebuild completes.
   */
  async function handleRebuildSummary(): Promise<void> {
    if (!activeSession || isRebuildingSummary) {
      return
    }

    clearSummaryTimer(activeSession.id)
    summaryRerunRef.current.delete(activeSession.id)
    setIsRebuildingSummary(true)
    setSummaryModalStatusKind(null)
    setSummaryModalStatusMessage('Rebuilding summary...')

    try {
      const { summary, summarizedMessageCount, passCount } = await rebuildSessionSummaryFromTranscript(
        activeSession,
        appSettingsRef.current.rollingSummarySystemPrompt,
        activeModel?.contextWindowTokens ?? null,
        (passNumber, startIndex, endIndex, totalCount) => {
          setSummaryModalStatusMessage(
            `Rebuilding summary... pass ${passNumber}, processing messages ${(
              startIndex + 1
            ).toLocaleString()}-${endIndex.toLocaleString()} of ${totalCount.toLocaleString()}.`,
          )
        },
      )

      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === activeSession.id
            ? {
              ...session,
              rollingSummary: summary,
              summarizedMessageCount,
              updatedAt: Date.now(),
            }
            : session,
        ),
      }))
      summaryDirtySessionsRef.current.delete(activeSession.id)

      setSummaryModalStatusKind('success')

      // Generate relationship narrative
      if (campaign && campaignPath) {
        try {
          setSummaryModalStatusMessage('Generating relationship summary...')
          const sessionCharacters = getEnabledSessionCharacters(activeSession, characters)
          const narrative = await window.api.generateRelationshipNarrative(
            campaignPath,
            campaign.id,
            sessionCharacters,
            [activeSession],
          )
          // Save narrative to the session
          updateCampaign((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
              session.id === activeSession.id
                ? {
                  ...session,
                  relationshipNarrativeSummary: narrative,
                  updatedAt: Date.now(),
                }
                : session,
            ),
          }))
          setSummaryModalStatusMessage('Summary and relationship narrative complete.')
        } catch (err) {
          console.error('[Aethra] Could not generate relationship narrative:', err)
          setSummaryModalStatusMessage(
            `Summary rebuilt, but relationship narrative failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          )
        }
      } else {
        setSummaryModalStatusMessage(
          passCount > 1
            ? `Summary rebuilt from ${summarizedMessageCount.toLocaleString()} visible messages across ${passCount.toLocaleString()} passes.`
            : `Summary rebuilt from ${summarizedMessageCount.toLocaleString()} visible messages in a single pass.`,
        )
      }
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
   * Open the model loader modal and default the source selector to the active
   * provider when it is compatible.
   */
  function handleOpenModelLoader(): void {
    setModelLoaderStatusKind(null)
    setModelLoaderStatusMessage(null)
    const defaultModelLoaderServer =
      activeServer && MODEL_LOADER_SERVER_KINDS.has(activeServer.kind)
        ? activeServer
        : modelLoaderServers[0] ?? null
    setModelLoaderServerId(defaultModelLoaderServer?.id ?? null)
    setIsModelLoaderOpen(true)
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
   * Switch the active source shown inside the model loader modal.
   *
   * @param serverId - Compatible server profile chosen from the source dropdown.
   */
  function handleModelLoaderServerSelect(serverId: string): void {
    setModelLoaderStatusKind(null)
    setModelLoaderStatusMessage(null)
    setModelLoaderServerId(serverId)
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
  async function performRollingSummary(
    sessionId: string,
    options: { allowDuringStreaming?: boolean } = {},
  ): Promise<void> {
    const settings = appSettingsRef.current
    if (!settings.enableRollingSummaries) {
      return
    }

    if (summaryInFlightRef.current.has(sessionId)) {
      summaryRerunRef.current.add(sessionId)
      return
    }

    if (isStreamingRef.current && !options.allowDuringStreaming) {
      scheduleRollingSummary(sessionId)
      return
    }

    const currentCampaign = campaignRef.current
    const session = currentCampaign?.sessions.find((candidate) => candidate.id === sessionId) ?? null
    if (!session) {
      return
    }

    const isDirty = summaryDirtySessionsRef.current.has(sessionId)
    const visibleMessages = getVisiblePromptMessages(session.messages)
    if (isDirty && visibleMessages.length <= SUMMARY_RECENT_MESSAGE_COUNT) {
      summaryDirtySessionsRef.current.delete(sessionId)
      return
    }

    const snapshot = createSessionSummarySnapshot(session)
    if (!isDirty && !snapshot) {
      return
    }

    summaryInFlightRef.current.add(sessionId)
    try {
      const summaryResult = isDirty
        ? await rebuildSessionSummaryFromTranscript(
          session,
          appSettingsRef.current.rollingSummarySystemPrompt,
          activeModel?.contextWindowTokens ?? null,
        )
        : {
          summary: await requestRollingSummary(
            appSettingsRef.current.rollingSummarySystemPrompt,
            snapshot!.previousSummary,
            snapshot!.transcript,
          ),
          summarizedMessageCount: snapshot!.nextSummarizedCount,
        }

      const normalizedSummary = summaryResult.summary.trim()
      if (!normalizedSummary) {
        return
      }

      updateCampaign((prev) => ({
        ...prev,
        sessions: prev.sessions.map((candidate) => {
          if (candidate.id !== sessionId) {
            return candidate
          }

          if (!isDirty && candidate.summarizedMessageCount !== snapshot!.baseSummarizedCount) {
            return candidate
          }

          return {
            ...candidate,
            rollingSummary: normalizedSummary,
            summarizedMessageCount: summaryResult.summarizedMessageCount,
            updatedAt: Date.now(),
          }
        }),
      }))
      summaryDirtySessionsRef.current.delete(sessionId)
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
   * Start or join a rolling-summary refresh for a session.
   *
   * @param sessionId - Target session.
   * @param options - Execution options for the current caller.
   * @returns Promise resolving when the active summary pass completes.
   */
  function runRollingSummary(
    sessionId: string,
    options: { allowDuringStreaming?: boolean } = {},
  ): Promise<void> {
    const existingPromise = summaryPromisesRef.current[sessionId]
    if (existingPromise) {
      summaryRerunRef.current.add(sessionId)
      return existingPromise
    }

    const promise = performRollingSummary(sessionId, options).finally(() => {
      if (summaryPromisesRef.current[sessionId] === promise) {
        delete summaryPromisesRef.current[sessionId]
      }
    })
    summaryPromisesRef.current[sessionId] = promise
    return promise
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
   * Refresh a session summary until all pre-send archived transcript has been
   * folded into the rolling summary.
   *
   * @param sessionId - Target session.
   * @returns Latest session snapshot after catch-up completes.
   */
  async function catchUpRollingSummaryBeforeSend(sessionId: string): Promise<Session | null> {
    if (!appSettingsRef.current.enableRollingSummaries) {
      return campaignRef.current?.sessions.find((session) => session.id === sessionId) ?? null
    }

    while (true) {
      const session = campaignRef.current?.sessions.find((candidate) => candidate.id === sessionId) ?? null
      if (!session) {
        return null
      }

      if (summaryDirtySessionsRef.current.has(sessionId) && getVisiblePromptMessages(session.messages).length <= SUMMARY_RECENT_MESSAGE_COUNT) {
        summaryDirtySessionsRef.current.delete(sessionId)
        return session
      }

      if (summaryDirtySessionsRef.current.has(sessionId) || createSessionSummarySnapshot(session)) {
        clearSummaryTimer(sessionId)
        await runRollingSummary(sessionId, { allowDuringStreaming: true })
        continue
      }

      if (!createSessionSummarySnapshot(session)) {
        return session
      }
    }
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
    summaryDirtySessionsRef.current.add(sessionId)

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
   * Persist whether inline markup markers should remain visible in chat bubbles.
   *
   * @param enabled - Whether raw chat markup should be shown.
   */
  async function handleShowChatMarkupToggle(enabled: boolean): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      showChatMarkup: enabled,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        enabled
          ? 'Chat markup is now visible.'
          : 'Chat markup is now hidden.',
      )
    } catch (err) {
      console.error('[Aethra] Could not save chat markup setting:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the chat markup setting.')
    }
  }

  /**
   * Refresh the global reusable avatar library.
   */
  async function refreshReusableAvatars(): Promise<void> {
    try {
      setReusableAvatars(await window.api.listReusableAvatars())
    } catch (err) {
      console.error('[Aethra] Could not load reusable avatars:', err)
      setAvatarLibraryStatusKind('error')
      setAvatarLibraryStatusMessage('Could not load saved avatars.')
    }
  }

  /**
   * Refresh the global reusable character library.
   */
  async function refreshReusableCharacters(): Promise<void> {
    try {
      setReusableCharacters(restoreCharacterAvatarsFromLibrary(await window.api.listReusableCharacters(), reusableAvatars))
    } catch (err) {
      console.error('[Aethra] Could not load reusable characters:', err)
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage('Could not load saved characters.')
    }
  }

  /**
   * Persist the minimum assistant-response reveal delay.
   *
   * @param delayMs - Delay in milliseconds before assistant text may appear.
   */
  async function handleAssistantResponseRevealDelayChange(delayMs: number): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      assistantResponseRevealDelayMs: Math.max(
        ASSISTANT_RESPONSE_REVEAL_DELAY_RANGE_MS.min,
        Math.min(ASSISTANT_RESPONSE_REVEAL_DELAY_RANGE_MS.max, Math.round(delayMs)),
      ),
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Assistant reveal delay updated.')
    } catch (err) {
      console.error('[Aethra] Could not save assistant reveal delay:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the assistant reveal delay.')
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
   * Persist editable prompt templates used by campaign chat and summaries.
   *
   * @param prompts - Updated prompt template values.
   */
  async function handlePromptTemplatesSave(prompts: {
    campaignBasePrompt: string
    formattingRules: string
    rollingSummarySystemPrompt: string
  }): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      campaignBasePrompt: prompts.campaignBasePrompt,
      formattingRules: prompts.formattingRules,
      rollingSummarySystemPrompt: prompts.rollingSummarySystemPrompt,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage('Prompt templates updated.')
    } catch (err) {
      console.error('[Aethra] Could not save prompt templates:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the prompt templates.')
      throw err
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
      setModelParametersStatusMessage('Parameters Saved')
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
   */
  async function handleLoadModel(modelSlug: string, contextWindowTokens: number): Promise<void> {
    if (!modelLoaderServer || !canLoadModel) {
      setModelLoaderStatusKind('error')
      setModelLoaderStatusMessage('Model loading is not available for the selected source.')
      return
    }

    const selectedModel = modelLoaderServerModels.find((model) => model.slug === modelSlug)
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

    const normalizedContextWindowTokens = Math.floor(contextWindowTokens)
    setIsModelLoading(true)

    try {
      const nextModels = appSettings.models.map((model) =>
        model.serverId === selectedModel.serverId && model.slug === selectedModel.slug
          ? { ...model, contextWindowTokens: normalizedContextWindowTokens }
          : model,
      )
      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
        activeServerId: modelLoaderServer.id,
        activeModelSlug: selectedModel.slug,
      }

      await appendAiDebugEntry('request', 'ai.model.load.request', {
        serverId: modelLoaderServer.id,
        serverName: modelLoaderServer.name,
        baseUrl: modelLoaderServer.baseUrl,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens,
      })

      await persistSettings(nextSettings)
      if (modelLoaderServer.kind === 'llama.cpp') {
        const status = await window.api.loadLocalModel(modelLoaderServer.id, selectedModel.slug)
        setLocalRuntimeStatus(status)
      } else if (modelLoaderServer.kind === 'lmstudio') {
        // LM Studio does not expose an explicit "load model" API. Persist the selection so
        // future completions target the chosen model while the user manages loading in LM Studio.
      } else {
        await window.api.loadModel(modelLoaderServer.id, selectedModel.slug, normalizedContextWindowTokens)
      }
      await appendAiDebugEntry('response', 'ai.model.load.success', {
        serverId: modelLoaderServer.id,
        modelSlug: selectedModel.slug,
        contextWindowTokens: normalizedContextWindowTokens,
      })
      setModelLoaderStatusKind('success')
      setModelLoaderStatusMessage(
        modelLoaderServer.kind === 'llama.cpp'
          ? `Started ${selectedModel.name} in llama.cpp with ${normalizedContextWindowTokens.toLocaleString()} tokens.`
          : modelLoaderServer.kind === 'lmstudio'
            ? `Selected ${selectedModel.name} from LM Studio. Start or switch the model in LM Studio if it is not already active.`
            : `Loaded ${selectedModel.name} with ${normalizedContextWindowTokens.toLocaleString()} tokens.`,
      )
    } catch (err) {
      await appendAiDebugEntry('error', 'ai.model.load.error', {
        serverId: modelLoaderServer.id,
        modelSlug: selectedModel.slug,
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
      const isNewCharacter = !characters.some((candidate) => candidate.id === character.id)
      const savedCharacter = await window.api.saveCharacter(campaignPath, character)
      setCharacters((prev) =>
        [savedCharacter, ...prev.filter((candidate) => candidate.id !== savedCharacter.id)]
          .sort((first, second) => second.updatedAt - first.updatedAt),
      )
      if (isNewCharacter) {
        updateCampaign((prev) => disableCharacterInExistingSessions(prev, savedCharacter.id))
      }
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
   * Delete one campaign-scoped character from the active campaign.
   *
   * @param characterId - Stable character identifier to remove.
   */
  async function handleDeleteCharacter(characterId: string): Promise<void> {
    if (!campaignPath || !campaign) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Open a campaign before deleting characters.')
      return
    }

    const characterToDelete = characters.find((character) => character.id === characterId) ?? null
    if (!characterToDelete) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Could not find the selected character.')
      return
    }

    const affectedSessions = campaign.sessions.filter((session) => hasCharacterAppearedInSession(session, characterToDelete))
    const confirmed = await confirm({
      title: `Delete ${characterToDelete.name}?`,
      message: `Delete ${characterToDelete.name} from this campaign?`,
      warning: affectedSessions.length > 0
        ? `This character appears in ${affectedSessions.length} session${affectedSessions.length === 1 ? '' : 's'}. Deleting the character will also permanently delete those session${affectedSessions.length === 1 ? '' : 's'}.`
        : undefined,
      confirmLabel: 'Delete',
    })

    if (!confirmed) {
      return
    }

    setIsCharactersBusy(true)

    try {
      await window.api.deleteCharacter(campaignPath, characterId)
      const nextCharacters = characters.filter((character) => character.id !== characterId)
      const removedSessionIds = new Set(affectedSessions.map((session) => session.id))
      if (removedSessionIds.size > 0) {
        updateCampaign((prev) => ({
          ...prev,
          sessions: prev.sessions.filter((session) => !removedSessionIds.has(session.id)),
        }))
      }
      setCharacters(nextCharacters)
      setActiveCharacterId(nextCharacters[0]?.id ?? null)
      setComposerCharacterId((prev) => prev === characterId ? null : prev)
      if (removedSessionIds.size > 0) {
        const survivingSessions = campaign.sessions.filter((session) => !removedSessionIds.has(session.id))
        const nextSessionId = survivingSessions[0]?.id ?? null
        setActiveSessionId((prev) => prev && !removedSessionIds.has(prev) ? prev : nextSessionId)
        setSelectedSessionId((prev) => prev && !removedSessionIds.has(prev) ? prev : nextSessionId)
      }
      setCharactersStatusKind('success')
      setCharactersStatusMessage(
        removedSessionIds.size > 0
          ? `Character deleted from this campaign along with ${removedSessionIds.size} affected session${removedSessionIds.size === 1 ? '' : 's'}.`
          : 'Character deleted from this campaign.',
      )
    } catch (err) {
      console.error('[Aethra] Could not delete character:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage(err instanceof Error ? err.message : 'Could not delete character.')
    } finally {
      setIsCharactersBusy(false)
    }
  }

  /**
   * Persist one reusable avatar in the global avatar library.
   *
   * @param avatar - Avatar to save.
   */
  async function handleSaveReusableAvatar(avatar: ReusableAvatar): Promise<void> {
    if (!avatar.imageData) {
      setAvatarLibraryStatusKind('error')
      setAvatarLibraryStatusMessage('Upload an image before saving an avatar.')
      return
    }

    setIsAvatarLibraryBusy(true)

    try {
      const savedAvatar = await window.api.saveReusableAvatar(avatar)
      setReusableAvatars((prev) =>
        [savedAvatar, ...prev.filter((candidate) => candidate.id !== savedAvatar.id)]
          .sort((first, second) => second.updatedAt - first.updatedAt),
      )
      setAvatarLibraryStatusKind('success')
      setAvatarLibraryStatusMessage(`Saved ${savedAvatar.name}.`)
    } catch (err) {
      console.error('[Aethra] Could not save reusable avatar:', err)
      setAvatarLibraryStatusKind('error')
      setAvatarLibraryStatusMessage(err instanceof Error ? err.message : 'Could not save avatar.')
    } finally {
      setIsAvatarLibraryBusy(false)
    }
  }

  /**
   * Delete one reusable avatar from the global avatar library.
   *
   * @param avatarId - Stable avatar identifier to remove.
   */
  async function handleDeleteReusableAvatar(avatarId: string): Promise<void> {
    setIsAvatarLibraryBusy(true)

    try {
      await window.api.deleteReusableAvatar(avatarId)
      setReusableAvatars((prev) => prev.filter((avatar) => avatar.id !== avatarId))
      setAvatarLibraryStatusKind('success')
      setAvatarLibraryStatusMessage('Saved avatar deleted.')
    } catch (err) {
      console.error('[Aethra] Could not delete reusable avatar:', err)
      setAvatarLibraryStatusKind('error')
      setAvatarLibraryStatusMessage(err instanceof Error ? err.message : 'Could not delete avatar.')
    } finally {
      setIsAvatarLibraryBusy(false)
    }
  }

  /**
   * Persist one reusable character in the global character library.
   *
   * @param character - Character to save.
   */
  async function handleSaveReusableCharacter(character: ReusableCharacter): Promise<void> {
    setIsCharacterLibraryBusy(true)

    try {
      const savedCharacter = await window.api.saveReusableCharacter(character)
      setReusableCharacters((prev) =>
        [savedCharacter, ...prev.filter((candidate) => candidate.id !== savedCharacter.id)]
          .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
      )
      setCharacterLibraryStatusKind('success')
      setCharacterLibraryStatusMessage(`Saved ${savedCharacter.name}.`)
    } catch (err) {
      console.error('[Aethra] Could not save reusable character:', err)
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage(err instanceof Error ? err.message : 'Could not save character.')
    } finally {
      setIsCharacterLibraryBusy(false)
    }
  }

  /**
   * Delete one reusable character from the global character library.
   *
   * @param characterId - Stable character identifier to remove.
   */
  async function handleDeleteReusableCharacter(characterId: string): Promise<void> {
    setIsCharacterLibraryBusy(true)

    try {
      await window.api.deleteReusableCharacter(characterId)
      setReusableCharacters((prev) => prev.filter((character) => character.id !== characterId))
      setCharacterLibraryStatusKind('success')
      setCharacterLibraryStatusMessage('Saved character deleted.')
    } catch (err) {
      console.error('[Aethra] Could not delete reusable character:', err)
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage(err instanceof Error ? err.message : 'Could not delete character.')
    } finally {
      setIsCharacterLibraryBusy(false)
    }
  }

  /**
   * Import a reusable character into the active campaign and return the saved record.
   *
   * @param reusableCharacter - Saved reusable character to import.
   * @returns Imported campaign-scoped character.
   */
  async function importReusableCharacterToCampaign(reusableCharacter: ReusableCharacter): Promise<CharacterProfile> {
    if (!campaignPath) {
      throw new Error('Open a campaign before importing characters.')
    }

    const now = Date.now()
    const savedCharacter = await window.api.saveCharacter(campaignPath, {
      ...reusableCharacter,
      id: uid(),
      folderName: '',
      createdAt: now,
      updatedAt: now,
    })

    setCharacters((prev) =>
      [savedCharacter, ...prev.filter((candidate) => candidate.id !== savedCharacter.id)]
        .sort((first, second) => second.updatedAt - first.updatedAt),
    )
    updateCampaign((prev) => disableCharacterInExistingSessions(prev, savedCharacter.id))

    return savedCharacter
  }

  /**
   * Import a reusable character into the active campaign as a campaign-scoped character.
   *
   * @param reusableCharacter - Saved reusable character to import.
   */
  async function handleImportReusableCharacter(reusableCharacter: ReusableCharacter): Promise<void> {
    if (!campaignPath) {
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage('Open a campaign before importing characters.')
      return
    }

    setIsCharactersBusy(true)

    try {
      const savedCharacter = await importReusableCharacterToCampaign(reusableCharacter)
      setActiveCharacterId(savedCharacter.id)
      setCharacterLibraryStatusKind('success')
      setCharacterLibraryStatusMessage(`Imported ${savedCharacter.name} into this campaign.`)
    } catch (err) {
      console.error('[Aethra] Could not import reusable character:', err)
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage(err instanceof Error ? err.message : 'Could not import character.')
    } finally {
      setIsCharactersBusy(false)
    }
  }

  /**
   * Create a session from the selected campaign and global characters.
   *
   * @param selectedCampaignCharacterIds - Existing campaign characters to keep active.
   * @param selectedReusableCharacterIds - Global characters to import and activate.
   */
  async function handleStartNewSession(
    selectedCampaignCharacterIds: string[],
    selectedReusableCharacterIds: string[],
    title: string,
    sceneSetup: string,
    continuitySourceSessionId: string | null,
    openingNotes: string,
  ): Promise<void> {
    if (!campaign) {
      setNewSessionStatusKind('error')
      setNewSessionStatusMessage('Open a campaign before starting a session.')
      return
    }

    const hasSelectedCampaignPlayer = characters.some((character) =>
      selectedCampaignCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )
    const hasSelectedReusablePlayer = reusableCharacters.some((character) =>
      selectedReusableCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )
    if (!hasSelectedCampaignPlayer && !hasSelectedReusablePlayer) {
      setNewSessionStatusKind('error')
      setNewSessionStatusMessage('Select at least one player character before starting a session.')
      return
    }
    if (title.trim().length === 0) {
      setNewSessionStatusKind('error')
      setNewSessionStatusMessage('Enter a session name before starting the session.')
      return
    }
    if (sceneSetup.trim().length === 0) {
      setNewSessionStatusKind('error')
      setNewSessionStatusMessage('Write a scene setup before starting the session.')
      return
    }

    setIsStartingSession(true)
    setNewSessionStatusKind(null)
    setNewSessionStatusMessage(null)

    try {
      const selectedReusableCharacters = reusableCharacters.filter((character) => selectedReusableCharacterIds.includes(character.id))
      const importedCharacters: CharacterProfile[] = []

      for (const reusableCharacter of selectedReusableCharacters) {
        importedCharacters.push(await importReusableCharacterToCampaign(reusableCharacter))
      }

      const selectedCharacterIds = new Set([
        ...selectedCampaignCharacterIds,
        ...importedCharacters.map((character) => character.id),
      ])
      const nextCharacters = [
        ...characters,
        ...importedCharacters,
      ]
      const disabledCharacterIds = nextCharacters
        .filter((character) => !selectedCharacterIds.has(character.id))
        .map((character) => character.id)

      const now = Date.now()
      const selectedContinuitySession = continuitySourceSessionId
        ? sessions.find((session) => session.id === continuitySourceSessionId) ?? null
        : null
      const newSession: Session = {
        id: uid(),
        title,
        sceneSetup,
        openingNotes,
        continuitySourceSessionId: selectedContinuitySession?.id,
        continuitySummary: selectedContinuitySession?.rollingSummary.trim() ?? '',
        activeCharacterIds: [...selectedCharacterIds],
        disabledCharacterIds,
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
      setSelectedSessionId(newSession.id)
      setIsNewSessionModalOpen(false)
      setComposerFocusRequestKey((prev) => prev + 1)
      setNewSessionStatusKind(null)
      setNewSessionStatusMessage(null)
    } catch (err) {
      console.error('[Aethra] Could not start session:', err)
      setNewSessionStatusKind('error')
      setNewSessionStatusMessage(err instanceof Error ? err.message : 'Could not start session.')
    } finally {
      setIsStartingSession(false)
    }
  }

  /**
   * Append one user message, then stream the AI response using the latest
   * active session state or an explicit session override.
   *
   * @param options - Message content plus optional session and speaker overrides.
   */
  async function sendUserMessage(options: {
    content: string
    sessionId?: string
    sessionOverride?: Session | null
    characterId?: string
    characterName?: string
    clearComposer?: boolean
  }): Promise<void> {
    const currentCampaign = campaignRef.current
    if (!currentCampaign || isStreaming) {
      return
    }

    const trimmedInput = options.content.trim()
    if (trimmedInput.length === 0) {
      return
    }

    const isContinueShortcut = trimmedInput === '***'
    const normalizedInput = isContinueShortcut ? '*continue*' : trimmedInput
    const sessionId = options.sessionId ?? ensureActiveSession()
    if (!sessionId) {
      return
    }
    const targetSession = options.sessionOverride
      ?? currentCampaign.sessions.find((session) => session.id === sessionId)
      ?? null

    const shouldSendAsDirector = isContinueShortcut || isDirectorComposerSelected
    const resolvedCharacterId = options.characterId ?? (shouldSendAsDirector ? undefined : composerCharacter?.id)
    const resolvedCharacterName = options.characterName ?? (shouldSendAsDirector ? DIRECTOR_SPEAKER_NAME : composerCharacter?.name)
    const messageContent = resolvedCharacterName === DIRECTOR_SPEAKER_NAME && !resolvedCharacterId
      ? formatDirectorContent(normalizedInput)
      : normalizedInput

    const userMessage: Message = {
      id: uid(),
      role: 'user',
      characterId: resolvedCharacterId,
      characterName: resolvedCharacterName,
      content: messageContent,
      timestamp: Date.now(),
    }

    // Snapshot the message history *before* appending the user message so we
    // can build the API payload without relying on stale state.
    const sessionForPrompt: Session = targetSession ?? {
      id: sessionId,
      title: 'New Chat',
      sceneSetup: '',
      openingNotes: '',
      continuitySummary: '',
      activeCharacterIds: characters.map((character) => character.id),
      disabledCharacterIds: [],
      messages: [],
      rollingSummary: '',
      summarizedMessageCount: 0,
      createdAt: userMessage.timestamp,
      updatedAt: userMessage.timestamp,
    }

    const summaryReadySession = options.sessionOverride
      ? sessionForPrompt
      : await catchUpRollingSummaryBeforeSend(sessionId)
    const latestSessionForPrompt = summaryReadySession ?? sessionForPrompt

    upsertMessage(sessionId, userMessage)
    if (options.clearComposer !== false) {
      setInputValue('')
    }
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

    // Generate relationship narrative alongside the summary (catchUpRollingSummaryBeforeSend already rebuilt the summary)
    if (
      appSettingsRef.current.enableRollingSummaries
      && latestSessionForPrompt
      && campaign
      && campaignPath
    ) {
      try {
        const sessionCharacters = getEnabledSessionCharacters(latestSessionForPrompt, characters)
        const relationshipNarrative = await window.api.generateRelationshipNarrative(
          campaignPath,
          campaign.id,
          sessionCharacters,
          [latestSessionForPrompt],
        )
        // Update session with relationship narrative
        updateCampaign((prev) => ({
          ...prev,
          sessions: prev.sessions.map((session) =>
            session.id === sessionId
              ? {
                ...session,
                relationshipNarrativeSummary: relationshipNarrative,
                updatedAt: Date.now(),
              }
              : session,
          ),
        }))
      } catch (err) {
        console.error('[Aethra] Could not generate relationship narrative before sending:', err)
      }
    }

    // Accumulate streamed text outside React state to avoid excessive re-renders,
    // then push the full string on each chunk.
    let accumulated = ''
    let pendingAnimationFrameId: number | null = null
    let revealTimeoutId: number | null = null
    let canRenderAssistantText = false
    let streamFinished = false
    let requestSession = latestSessionForPrompt
    let baseHistorySnapshot = buildRequestMessages(
      currentCampaign,
      enabledSessionCharacters,
      appSettingsRef.current,
      requestSession,
      [userMessage],
      undefined,
      relationshipGraph,
    )
    const playerControlledNames = new Set(
      enabledSessionCharacters
        .filter((character) => character.controlledBy === 'user')
        .map((character) => character.name.trim().toLocaleLowerCase())
        .filter((name) => name.length > 0),
    )

    /**
     * Clear the pending assistant-text reveal timer, if any.
     */
    function clearAssistantRevealTimer(): void {
      if (revealTimeoutId === null) {
        return
      }

      window.clearTimeout(revealTimeoutId)
      revealTimeoutId = null
    }

    /**
     * Return the remaining delay before assistant text is allowed to render.
     *
     * @returns Milliseconds remaining in the reveal gate.
     */
    function getAssistantRevealDelayRemaining(): number {
      return Math.max(
        appSettingsRef.current.assistantResponseRevealDelayMs - (Date.now() - assistantTimestamp),
        0,
      )
    }

    /**
     * Push the latest parsed assistant bubbles into state at most once per frame.
     */
    function flushStreamedAssistantMessages(): void {
      pendingAnimationFrameId = null
      if (!canRenderAssistantText) {
        return
      }

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
      if (!canRenderAssistantText) {
        return
      }

      if (pendingAnimationFrameId !== null) {
        return
      }

      pendingAnimationFrameId = requestAnimationFrame(() => {
        flushStreamedAssistantMessages()
      })
    }

    /**
     * Finalize the current assistant attempt once the reveal gate has opened.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    function finishAssistantAttempt(attemptNumber: number): void {
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
    }

    /**
     * Open the assistant-text reveal gate immediately or after the remaining
     * minimum typing-indicator delay has elapsed.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    function ensureAssistantReveal(attemptNumber: number): void {
      if (canRenderAssistantText) {
        if (streamFinished) {
          finishAssistantAttempt(attemptNumber)
        }
        return
      }

      const remainingDelay = getAssistantRevealDelayRemaining()
      if (remainingDelay <= 0) {
        canRenderAssistantText = true
        if (accumulated.length > 0) {
          scheduleStreamedAssistantSync()
        }
        if (streamFinished) {
          finishAssistantAttempt(attemptNumber)
        }
        return
      }

      if (revealTimeoutId !== null) {
        return
      }

      revealTimeoutId = window.setTimeout(() => {
        revealTimeoutId = null
        canRenderAssistantText = true
        if (accumulated.length > 0) {
          scheduleStreamedAssistantSync()
        }
        if (streamFinished) {
          finishAssistantAttempt(attemptNumber)
        }
      }, remainingDelay)
    }

    /**
     * Stream one assistant attempt. Replies without a leading character tag
     * are discarded and retried up to the configured limit.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    function streamAssistantAttempt(attemptNumber: number): void {
      if (!currentCampaign || !campaignPath || !sessionId) return

      accumulated = ''
      streamFinished = false
      const historySnapshot = attemptNumber === 1
        ? baseHistorySnapshot
        : buildRequestMessages(
          currentCampaign,
          enabledSessionCharacters,
          appSettingsRef.current,
          requestSession,
          [userMessage],
          [{
            role: 'user',
            content: 'Your previous reply was invalid. Retry and output only lines beginning with [Name]. Every line must start with [Scene] or the exact name of an AI-controlled character. Do not write any content for player-controlled characters.',
          }],
          relationshipGraph,
        )

      streamCompletion(
        historySnapshot,
        /* onToken */ (chunk) => {
          accumulated += chunk
          ensureAssistantReveal(attemptNumber)
          if (canRenderAssistantText) {
            scheduleStreamedAssistantSync()
          }
        },
        /* onUsage */ (usage) => {
          setLastTokenUsage(usage)
        },
        /* onDone */ () => {
          if (pendingAnimationFrameId !== null) {
            cancelAnimationFrame(pendingAnimationFrameId)
            pendingAnimationFrameId = null
          }
          streamFinished = true
          ensureAssistantReveal(attemptNumber)
        },
        /* onError */ (err) => {
          if (pendingAnimationFrameId !== null) {
            cancelAnimationFrame(pendingAnimationFrameId)
            pendingAnimationFrameId = null
          }
          clearAssistantRevealTimer()
          canRenderAssistantText = true
          streamFinished = false

          console.error('[Aethra] AI stream error:', err)
          updateCampaign((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) => {
              if (session.id !== sessionId) {
                return session
              }

              return {
                ...session,
                messages: [
                  ...session.messages.filter((message) => !assistantIds.includes(message.id)),
                  {
                    ...assistantMessage,
                    content: `${TRANSIENT_ERROR_MARKER} Could not reach the selected AI server. Check that it is running and the server address is correct.`,
                  },
                ],
                updatedAt: Date.now(),
              }
            }),
          }))
          setIsStreaming(false)
        },
      )
    }

    /**
     * Stream one assistant attempt. Replies without a leading character tag
     * are discarded and retried up to the configured limit.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    streamAssistantAttempt(1)
  }

  /**
   * Append the current input as a user message, then stream the AI response.
   * The assistant message is created immediately with empty content and updated
   * chunk-by-chunk as the stream arrives.
   */
  async function handleSend(): Promise<void> {
    if (!campaign || !inputValue.trim() || isStreaming) {
      return
    }

    await sendUserMessage({ content: inputValue })
  }

  /**
   * Delete the selected user message and every later message, then resend the
   * selected message after forcing the session summary to rebuild.
   *
   * @param messageId - User message that should become the new branch point.
   */
  async function handleReplayFromMessage(messageId: string): Promise<void> {
    if (!activeSession || isStreaming) {
      return
    }

    const messageIndex = activeSession.messages.findIndex((candidate) => candidate.id === messageId)
    if (messageIndex === -1) {
      return
    }

    const message = activeSession.messages[messageIndex]
    if (message.role !== 'user') {
      return
    }

    const confirmed = await confirm({
      title: 'Replay From This Message',
      message: 'This will delete this message and every message after it, rebuild the session summary, and resend this message using the current model settings.',
      warning: 'This permanently replaces the later transcript branch in the current chat.',
      confirmLabel: 'Replay Message',
      cancelLabel: 'Keep Chat',
    })

    if (!confirmed) {
      return
    }

    clearSummaryTimer(activeSession.id)
    summaryRerunRef.current.delete(activeSession.id)
    summaryDirtySessionsRef.current.add(activeSession.id)

    const nextSession: Session = {
      ...activeSession,
      messages: activeSession.messages.slice(0, messageIndex),
      rollingSummary: '',
      summarizedMessageCount: 0,
      updatedAt: Date.now(),
    }

    updateCampaign((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (
        session.id === activeSession.id
          ? nextSession
          : session
      )),
    }))

    await sendUserMessage({
      content: message.content,
      sessionId: activeSession.id,
      sessionOverride: nextSession,
      characterId: message.characterId,
      characterName: message.characterName,
    })
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="app-root">
      <TitleBar title="Aethra" />

      {campaign && !isCampaignSwitchLoading ? (
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

      {isCampaignSwitchLoading ? (
        <CampaignLauncher
          campaigns={availableCampaigns}
          isBusy={isCampaignBusy}
          loadingState={campaignLauncherLoadingState}
          statusMessage={campaignStatusMessage}
          onCreateCampaign={handleCreateCampaign}
          onOpenFromFile={() => {
            void handleOpenCampaignFromFile()
          }}
          onOpenCampaign={(path) => {
            void handleOpenCampaign(path)
          }}
        />
      ) : campaign ? (
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
            activeSessionId={selectedSessionId}
            activeSessionSummary={activeSession?.rollingSummary ?? null}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onNewSession={handleNewSession}
            onOpenSummary={handleOpenSummaryModal}
            isBusy={isStreaming || isStartingSession}
          />

          {/* Centre column: chat feed + composer */}
          <main className="panel panel--chat">
            <ChatArea
              activeSessionId={activeSessionId}
              messages={messages}
              characters={characters}
              textSize={appSettings.chatTextSize}
              showMarkup={appSettings.showChatMarkup}
              onDeleteMessage={handleDeleteMessage}
              onReplayFromMessage={(messageId) => {
                void handleReplayFromMessage(messageId)
              }}
              onReady={handleChatReady}
              isLoading={isChatLoading}
              isBusy={isStreaming}
            />
            {isChatModelReady ? (
              <InputBar
                value={inputValue}
                characters={enabledSessionCharacters}
                selectedCharacterId={composerCharacterId}
                onChange={setInputValue}
                onSelectCharacter={setComposerCharacterId}
                onSend={handleSend}
                focusRequestKey={composerFocusRequestKey}
                disabled={isStreaming || isChatLoading}
              />
            ) : (
              <div className="chat-model-warning" role="status" aria-live="polite">
                <div className="chat-model-warning__copy">
                  <div className="chat-model-warning__title">No model loaded</div>
                  <div className="chat-model-warning__text">
                    Load a model to begin chatting in this session.
                  </div>
                </div>
                <button
                  type="button"
                  className="chat-model-warning__button"
                  onClick={handleOpenModelLoader}
                  disabled={!canLoadModel}
                >
                  Load Model
                </button>
              </div>
            )}
          </main>

          {/* Right column: session details */}
          <DetailsPanel
            activeSession={activeSession}
            activeCharacters={enabledSessionCharacters}
            totalCharacterCount={characters.length}
            onOpenSessionCharacters={handleOpenSessionCharacters}
            onRefreshRelationships={() => { void handleRefreshRelationships() }}
            isRefreshingRelationships={isRefreshingRelationships}
            refreshRelationshipsError={refreshRelationshipsError}
          />
        </div>
      ) : (
        <CampaignLauncher
          campaigns={availableCampaigns}
          isBusy={isCampaignBusy}
          loadingState={campaignLauncherLoadingState}
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

      {!isCampaignSwitchLoading && isSettingsOpen ? (
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
          showChatMarkup={appSettings.showChatMarkup}
          assistantResponseRevealDelayMs={appSettings.assistantResponseRevealDelayMs}
          campaignBasePrompt={appSettings.campaignBasePrompt}
          formattingRules={appSettings.formattingRules}
          rollingSummarySystemPrompt={appSettings.rollingSummarySystemPrompt}
          enableRollingSummaries={appSettings.enableRollingSummaries}
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
          onShowChatMarkupToggle={(enabled) => {
            void handleShowChatMarkupToggle(enabled)
          }}
          onAssistantResponseRevealDelayChange={(delayMs) => {
            void handleAssistantResponseRevealDelayChange(delayMs)
          }}
          onRollingSummariesToggle={(enabled) => {
            void handleRollingSummariesToggle(enabled)
          }}
          onSavePromptTemplates={handlePromptTemplatesSave}
          onSetStatus={(kind, message) => {
            setSettingsStatusKind(kind)
            setSettingsStatusMessage(message)
          }}
        />
      ) : null}

      {!isCampaignSwitchLoading && isAiDebugOpen ? (
        <AiDebugModal
          entries={aiDebugEntries}
          onClose={handleCloseAiDebug}
          onClear={() => {
            void handleClearAiDebug()
          }}
        />
      ) : null}

      {!isCampaignSwitchLoading && isModelLoaderOpen ? (
        <ModelLoaderModal
          servers={modelLoaderServers}
          selectedServerId={modelLoaderServer?.id ?? null}
          onSelectServer={handleModelLoaderServerSelect}
          serverKind={modelLoaderServer?.kind ?? null}
          models={modelLoaderServerModels}
          currentModelSlug={modelLoaderCurrentModelSlug}
          hasLoadedModel={modelLoaderHasLoadedModel}
          fitEstimate={modelLoaderLocalModelFit}
          localRuntimeStatus={localRuntimeStatus}
          localRuntimeLoadProgress={localRuntimeLoadProgress}
          binaryInstallProgress={binaryInstallProgress}
          binaryCheckResult={modelLoaderBinaryCheck}
          statusMessage={modelLoaderStatusMessage}
          statusKind={modelLoaderStatusKind}
          isBusy={isModelLoading}
          onClose={handleCloseModelLoader}
          onLoadModel={(modelSlug, contextWindowTokens) => handleLoadModel(modelSlug, contextWindowTokens)}
          onInstallBinary={() => {
            if (modelLoaderServer?.kind === 'llama.cpp') void window.api.installLlamaBinary(modelLoaderServer.id)
          }}
        />
      ) : null}

      {!isCampaignSwitchLoading && isModelParametersOpen ? (
        <ModelParametersModal
          model={activeModel}
          statusMessage={modelParametersStatusMessage}
          statusKind={modelParametersStatusKind}
          isBusy={isModelParametersSaving}
          onClose={handleCloseModelParameters}
          onSaveParameters={(modelSlug, values) => handleSaveModelParameters(modelSlug, values)}
        />
      ) : null}

      {!isCampaignSwitchLoading && isCharactersOpen ? (
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
          onDeleteCharacter={(characterId) => handleDeleteCharacter(characterId)}
          reusableAvatars={reusableAvatars}
          avatarLibraryStatusMessage={avatarLibraryStatusMessage}
          avatarLibraryStatusKind={avatarLibraryStatusKind}
          isAvatarLibraryBusy={isAvatarLibraryBusy}
          onSaveReusableAvatar={(avatar) => handleSaveReusableAvatar(avatar)}
          onDeleteReusableAvatar={(avatarId) => handleDeleteReusableAvatar(avatarId)}
          reusableCharacters={reusableCharacters}
          characterLibraryStatusMessage={characterLibraryStatusMessage}
          characterLibraryStatusKind={characterLibraryStatusKind}
          isCharacterLibraryBusy={isCharacterLibraryBusy}
          onSaveReusableCharacter={(character) => handleSaveReusableCharacter(character)}
          onDeleteReusableCharacter={(characterId) => handleDeleteReusableCharacter(characterId)}
          onImportReusableCharacter={(character) => handleImportReusableCharacter(character)}
          relationshipGraph={relationshipGraph}
          onSaveRelationships={handleSaveRelationships}
          onDeleteRelationshipPair={handleDeleteRelationshipPair}
        />
      ) : null}
      {!isCampaignSwitchLoading && isNewSessionModalOpen ? (
        <NewSessionModal
          sessions={sessions}
          campaignCharacters={characters}
          reusableCharacters={reusableCharacters}
          statusMessage={newSessionStatusMessage}
          statusKind={newSessionStatusKind}
          isBusy={isStartingSession}
          onClose={handleCloseNewSessionModal}
          onStartSession={(campaignCharacterIds, reusableCharacterIds, title, sceneSetup, continuitySourceSessionId, openingNotes) =>
            handleStartNewSession(
              campaignCharacterIds,
              reusableCharacterIds,
              title,
              sceneSetup,
              continuitySourceSessionId,
              openingNotes,
            )}
        />
      ) : null}
      {!isCampaignSwitchLoading && isSessionCharactersOpen ? (
        <SessionCharactersModal
          activeSession={activeSession}
          characters={characters}
          onToggleCharacter={handleToggleSessionCharacter}
          onClose={handleCloseSessionCharacters}
        />
      ) : null}
      {!isCampaignSwitchLoading && isSummaryModalOpen ? (
        <SummaryModal
          summary={activeSession?.rollingSummary ?? ''}
          relationshipNarrativeSummary={activeSession?.relationshipNarrativeSummary ?? null}
          isRebuilding={isRebuildingSummary}
          isRefreshingRelationships={false}
          statusMessage={summaryModalStatusMessage}
          statusKind={summaryModalStatusKind}
          onClose={handleCloseSummaryModal}
          onRebuild={() => { void handleRebuildSummary() }}
        />
      ) : null}
      {pendingRelationshipGraph && (
        <RelationshipReviewModal
          graph={pendingRelationshipGraph}
          characters={characters}
          refreshStartedAt={refreshStartedAt}
          onSave={async (graph: RelationshipGraph) => {
            await handleSaveRelationships(graph)
            setPendingRelationshipGraph(null)
          }}
          onDiscard={() => { setPendingRelationshipGraph(null) }}
        />
      )}
      {!isCampaignSwitchLoading && isCreateCampaignOpen ? (
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
      {!isCampaignSwitchLoading && isCampaignModalOpen ? (
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
      {!isCampaignSwitchLoading && pendingDeleteMessageId ? (
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
      {!isCampaignSwitchLoading && pendingDeleteSessionId ? (
        <ConfirmModal
          title="Delete Chat"
          message="This will permanently remove the selected chat and its full message history."
          confirmLabel="Delete Chat"
          onConfirm={handleConfirmDeleteSession}
          onCancel={handleCancelDeleteSession}
        />
      ) : null}
      {!isCampaignSwitchLoading && confirmState ? (
        <ConfirmModal {...confirmState} />
      ) : null}
    </div>
  )
}
