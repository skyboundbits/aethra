/**
 * src/App.tsx
 * Root application component for Aethra.
 *
 * Owns all top-level state:
 *   - scenes      : list of roleplay scenes
 *   - activeScene : which scene is currently open
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
import { ScenesModal } from './components/ScenesModal'
import { LoreBookModal } from './components/LoreBookModal'
import { AiDebugModal } from './components/AiDebugModal'
import { ModelLoaderModal } from './components/ModelLoaderModal'
import { ModelParametersModal } from './components/ModelParametersModal'
import { Modal } from './components/Modal'
import { NewSceneModal } from './components/NewSceneModal'
import { SceneCharactersModal } from './components/SceneCharactersModal'
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
  DEFAULT_RELATIONSHIP_SUMMARY_SYSTEM_PROMPT,
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
  AssistantResponseDisplayMode,
  ChatBubbleFormattingMode,
  CharacterProfile,
  HardwareInfo,
  HuggingFaceModelFile,
  LocalRuntimeLoadProgress,
  LocalRuntimeStatus,
  Message,
  ChatMessage,
  ModelDownloadProgress,
  ModelPreset,
  RelationshipEntry,
  RelationshipGraph,
  ReusableAvatar,
  ReusableCharacterBundleCharacter,
  ReusableCharacterRelationshipBundle,
  ReusableCharacter,
  Scene,
  TokenUsage,
} from './types'

const DEFAULT_ASSISTANT_RESPONSE_REVEAL_DELAY_MS = 1500
const ASSISTANT_RESPONSE_REVEAL_DELAY_RANGE_MS = {
  min: 0,
  max: 10000,
} as const
const RECENT_MESSAGES_WINDOW_RANGE = {
  min: 2,
  max: 100,
} as const
const DEFAULT_RECENT_MESSAGES_WINDOW = 10

const DEFAULT_SETTINGS: AppSettings = {
  servers: [],
  models: [],
  activeServerId: null,
  activeModelSlug: null,
  systemPrompt: 'You are a roleplaying agent responding naturally to the user.',
  campaignBasePrompt: DEFAULT_CAMPAIGN_BASE_PROMPT,
  formattingRules: DEFAULT_CHAT_FORMATTING_RULES,
  rollingSummarySystemPrompt: DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT,
  relationshipSummarySystemPrompt: DEFAULT_RELATIONSHIP_SUMMARY_SYSTEM_PROMPT,
  enableRollingSummaries: false,
  enableRollingRelationshipSummaries: false,
  recentMessagesWindow: DEFAULT_RECENT_MESSAGES_WINDOW,
  showChatMarkup: false,
  chatBubbleFormattingMode: 'emphasized',
  chatTextSize: 'small',
  assistantResponseDisplayMode: 'stream',
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

function toReusableBundleCharacter(
  character: CharacterProfile | ReusableCharacter | ReusableCharacterBundleCharacter,
): ReusableCharacterBundleCharacter {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    gender: character.gender,
    pronouns: character.pronouns,
    description: character.description,
    personality: character.personality,
    speakingStyle: character.speakingStyle,
    goals: character.goals,
    avatarImageData: character.avatarImageData,
    avatarSourceId: character.avatarSourceId,
    reusableCharacterId: 'reusableCharacterId' in character ? character.reusableCharacterId : undefined,
    avatarCrop: character.avatarCrop,
    controlledBy: character.controlledBy,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  }
}

const AWAITING_PLAYER_ACTION_MARKER = '[System] Awaiting player action...'
const TRANSIENT_ERROR_MARKER = '[System Error]'
const LEGACY_STREAM_ERROR_MESSAGE = '⚠️ Could not reach the selected AI server. Check that it is running and the server address is correct.'
const MAX_UNTAGGED_ASSISTANT_ATTEMPTS = 3
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
 * Remove hidden placeholder markers from a scene transcript.
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
 * @param scene - Scene whose prompt window is being computed.
 * @param useRollingSummary - Whether summary-backed context is active.
 * @param pendingMessages - Optional messages not yet committed to scene state.
 * @returns Messages to include verbatim in the outbound prompt.
 */
function getPromptWindowMessages(
  scene: Scene,
  useRollingSummary: boolean,
  recentMessagesWindow: number,
  pendingMessages: Message[] = [],
  forceRecentWindowOnly = false,
): Message[] {
  const visibleMessages = getVisiblePromptMessages([...scene.messages, ...pendingMessages])
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

  const normalizedRecentMessagesWindow = Math.max(
    RECENT_MESSAGES_WINDOW_RANGE.min,
    Math.floor(recentMessagesWindow || DEFAULT_RECENT_MESSAGES_WINDOW),
  )
  const recentStartIndex = Math.max(livePromptMessages.length - normalizedRecentMessagesWindow, 0)
  if (forceRecentWindowOnly) {
    return livePromptMessages.slice(recentStartIndex)
  }

  const summarizedCount = scene.rollingSummary.trim().length > 0
    ? Math.max(0, Math.floor(scene.summarizedMessageCount))
    : 0
  const windowStartIndex = Math.min(summarizedCount, recentStartIndex)

  return livePromptMessages.slice(windowStartIndex)
}

/**
 * Build the scene summary section for the prompt, when enabled.
 *
 * @param scene - Active scene.
 * @param useRollingSummary - Whether summary-backed context is active.
 * @returns Summary text or null when no summary should be sent.
 */
function getPromptSceneSummary(scene: Scene, useRollingSummary: boolean): string | null {
  if (!useRollingSummary || scene.summarizedMessageCount <= 0) {
    return null
  }

  const normalizedSummary = scene.rollingSummary.trim()
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
 * @param activeCharacterIds - IDs of all characters enabled in the current scene.
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
 * @param scene - Scene-specific setup and continuity metadata.
 * @param campaignBasePrompt - Persisted base prompt template for campaign play.
 * @param formattingRules - Persisted formatting rules appended after the base prompt.
 * @param customSystemPrompt - User-configured system prompt text.
 * @param sceneSummary - Rolling scene summary, if one exists for the scene.
 * @param relationshipGraph - Campaign relationship graph, if available.
 */
function buildSystemContext(
  campaign: Campaign,
  characters: CharacterProfile[],
  scene: Scene,
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
  const normalizedSceneTitle =
    typeof scene.title === 'string' && scene.title.trim().length > 0
      ? scene.title.trim()
      : 'New Chat'
  const normalizedSceneSetup =
    typeof scene.sceneSetup === 'string'
      ? scene.sceneSetup.trim()
      : ''
  const normalizedOpeningNotes =
    typeof scene.openingNotes === 'string'
      ? scene.openingNotes.trim()
      : ''
  const normalizedContinuitySummary =
    typeof scene.continuitySummary === 'string'
      ? scene.continuitySummary.trim()
      : ''
  const sceneContextSections = [`Scene Title: ${normalizedSceneTitle}`]

  if (normalizedSceneSetup) {
    sceneContextSections.push(`Scene Setup:\n${normalizedSceneSetup}`)
  }

  if (normalizedOpeningNotes) {
    sceneContextSections.push(`Opening Notes:\n${normalizedOpeningNotes}`)
  }

  if (normalizedContinuitySummary) {
    sceneContextSections.push(`Continuity From Previous Scene:\n${normalizedContinuitySummary}`)
  }

  sceneContextSections.push(
    'Continuity Rules:\nTreat Scene Setup as the starting frame for this scene. Treat any previous-scene continuity and rolling scene summary as canon context. If the recent transcript conflicts with older context, the recent transcript wins.',
  )

  const sceneContext: ChatMessage = {
    role: 'system',
    content: sceneContextSections.join('\n\n'),
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
      sceneContext.content,
      charactersContext.content,
      summaryContext,
    ].filter((section): section is string => Boolean(section)).join('\n\n'),
  }]
}

/**
 * Read the explicitly active character list for one scene as a stable
 * de-duplicated array when available.
 *
 * @param scene - Scene whose disabled character list should be read.
 * @returns Stable array of active character IDs, or null when no explicit list exists.
 */
function getsceneActiveCharacterIds(scene: Scene | null): string[] | null {
  if (!scene?.activeCharacterIds) {
    return null
  }

  return [...new Set(scene.activeCharacterIds.filter((characterId) => characterId.trim().length > 0))]
}

/**
 * Read the disabled character list for one scene as a stable de-duplicated
 * array. Missing data is treated as "all campaign characters enabled".
 *
 * @param scene - Scene whose disabled character list should be read.
 * @returns Stable array of disabled character IDs.
 */
function getsceneDisabledCharacterIds(scene: Scene | null): string[] {
  if (!scene?.disabledCharacterIds) {
    return []
  }

  return [...new Set(scene.disabledCharacterIds.filter((characterId) => characterId.trim().length > 0))]
}

/**
 * Return the campaign characters currently enabled for a specific scene.
 *
 * @param scene - Active scene, if any.
 * @param characters - Campaign roster.
 * @returns Characters enabled for that scene.
 */
function getEnabledSceneCharacters(
  scene: Scene | null,
  characters: CharacterProfile[],
): CharacterProfile[] {
  const activeCharacterIds = getsceneActiveCharacterIds(scene)
  if (activeCharacterIds) {
    const enabledCharacterIds = new Set(activeCharacterIds)
    return characters.filter((character) => enabledCharacterIds.has(character.id))
  }

  const disabledCharacterIds = new Set(getsceneDisabledCharacterIds(scene))
  return characters.filter((character) => !disabledCharacterIds.has(character.id))
}

/**
 * Mark one newly added campaign character as inactive in every existing
 * scene so scene membership stays opt-in.
 *
 * @param campaign - Campaign whose scenes should be updated.
 * @param characterId - Campaign character ID that was just introduced.
 * @returns Campaign copy with existing scenes updated when needed.
 */
function disableCharacterInExistingscenes(campaign: Campaign, characterId: string): Campaign {
  let didChange = false
  const nextScenes = campaign.scenes.map((scene) => {
    const activeCharacterIds = getsceneActiveCharacterIds(scene)
    if (activeCharacterIds) {
      return scene
    }

    const disabledCharacterIds = new Set(getsceneDisabledCharacterIds(scene))
    if (disabledCharacterIds.has(characterId)) {
      return scene
    }

    didChange = true
    disabledCharacterIds.add(characterId)
    return {
      ...scene,
      disabledCharacterIds: [...disabledCharacterIds],
      updatedAt: Date.now(),
    }
  })

  return didChange
    ? {
      ...campaign,
      scenes: nextScenes,
    }
    : campaign
}

/**
 * Determine whether a character appears anywhere in a scene transcript.
 *
 * @param scene - Scene to inspect.
 * @param character - Campaign character to match.
 * @returns True when the character appears in that scene.
 */
function hasCharacterAppearedInscene(scene: Scene, character: CharacterProfile): boolean {
  const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
  return scene.messages.some((message) => (
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
interface sceneSummarySnapshot {
  /** Scene being summarized. */
  sceneId: string
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
 * Build the outbound prompt payload for a scene.
 *
 * @param campaign - Active campaign metadata.
 * @param characters - Characters available in the campaign.
 * @param settings - Current persisted app settings.
 * @param scene - Scene being sent to the model.
 * @param pendingMessages - Optional messages not yet written into scene state.
 * @returns Full chat payload for the model.
 */
function buildRequestMessages(
  campaign: Campaign,
  characters: CharacterProfile[],
  settings: AppSettings,
  scene: Scene,
  pendingMessages: Message[] = [],
  trailingInstructions: ChatMessage[] = [],
  relationshipGraph: RelationshipGraph | null = null,
  forceRecentWindowOnly = false,
): ChatMessage[] {
  return [
    ...buildSystemContext(
      campaign,
      characters,
      scene,
      settings.campaignBasePrompt,
      settings.formattingRules,
      settings.systemPrompt,
      getPromptSceneSummary(scene, settings.enableRollingSummaries),
      relationshipGraph,
    ),
    ...toApiMessages(
      getPromptWindowMessages(
        scene,
        settings.enableRollingSummaries,
        settings.recentMessagesWindow,
        pendingMessages,
        forceRecentWindowOnly,
      ),
    ),
    ...trailingInstructions,
  ]
}

/**
 * Determine whether a scene currently has enough archived content to summarize.
 *
 * @param scene - Scene candidate.
 * @returns Snapshot describing the next summary pass, or null when no work is needed.
 */
function createsceneSummarySnapshot(
  scene: Scene,
  recentMessagesWindow: number,
): sceneSummarySnapshot | null {
  const visibleMessages = getVisiblePromptMessages(scene.messages)
  const normalizedRecentMessagesWindow = Math.max(
    RECENT_MESSAGES_WINDOW_RANGE.min,
    Math.floor(recentMessagesWindow || DEFAULT_RECENT_MESSAGES_WINDOW),
  )
  const nextSummarizedCount = Math.max(visibleMessages.length - normalizedRecentMessagesWindow, 0)
  const currentSummary = scene.rollingSummary.trim()
  const baseSummarizedCount = currentSummary.length > 0
    ? Math.max(0, Math.min(scene.summarizedMessageCount, nextSummarizedCount))
    : 0

  if (nextSummarizedCount <= baseSummarizedCount) {
    return null
  }

  const transcript = visibleMessages.slice(baseSummarizedCount, nextSummarizedCount)
  if (transcript.length === 0) {
    return null
  }

  return {
    sceneId: scene.id,
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
 * Rebuild a scene summary from the full visible transcript, chunking requests
 * to fit within the current model context window when necessary.
 *
 * @param scene - Scene whose transcript should be rebuilt.
 * @param onProgress - Optional callback notified before each rebuild pass.
 * @returns Rebuilt summary text plus the covered visible-message count.
 */
async function rebuildsceneSummaryFromTranscript(
  scene: Scene,
  rollingSummarySystemPrompt: string,
  activeModelContextWindowTokens: number | null,
  onProgress?: (passNumber: number, startIndex: number, endIndex: number, totalCount: number) => void,
): Promise<{
  summary: string
  summarizedMessageCount: number
  passCount: number
}> {
  const visibleMessages = getVisiblePromptMessages(scene.messages)
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
 * Reattach character IDs and scene character toggle state using the active
 * campaign character roster.
 *
 * @param campaign - Campaign whose scene messages should be hydrated.
 * @param characters - Character roster available for matching.
 * @returns Campaign copy with message character IDs filled where possible.
 */
function hydrateCampaignMessageCharacterIds(campaign: Campaign, characters: CharacterProfile[]): Campaign {
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const charactersByName = new Map(
    characters.map((character) => [character.name.trim().toLocaleLowerCase(), character]),
  )

  let didChange = false
  const nextScenes = campaign.scenes.map((scene) => {
    let sceneChanged = false
    const storedActiveCharacterIds = getsceneActiveCharacterIds(scene)
    const nextActiveCharacterIds = storedActiveCharacterIds
      ? storedActiveCharacterIds
      : characters
        .filter((character) => !getsceneDisabledCharacterIds(scene).includes(character.id))
        .map((character) => character.id)
    const nextDisabledCharacterIds = getsceneDisabledCharacterIds(scene)
    const activeIdsChanged =
      !scene.activeCharacterIds ||
      nextActiveCharacterIds.length !== scene.activeCharacterIds.length ||
      nextActiveCharacterIds.some((characterId, index) => characterId !== scene.activeCharacterIds?.[index])
    const disabledIdsChanged =
      !scene.disabledCharacterIds ||
      nextDisabledCharacterIds.length !== scene.disabledCharacterIds.length ||
      nextDisabledCharacterIds.some((characterId, index) => characterId !== scene.disabledCharacterIds?.[index])

    const nextMessages = characters.length > 0
      ? scene.messages.map((message) => {
        const nextMessage = hydrateMessageCharacterId(message, charactersById, charactersByName)
        if (nextMessage !== message) {
          sceneChanged = true
        }
        return nextMessage
      })
      : scene.messages

    if (!sceneChanged && !activeIdsChanged && !disabledIdsChanged) {
      return scene
    }

    didChange = true
    return {
      ...scene,
      activeCharacterIds: nextActiveCharacterIds,
      disabledCharacterIds: nextDisabledCharacterIds,
      messages: nextMessages,
    }
  })

  return didChange
    ? {
      ...campaign,
      scenes: nextScenes,
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
    const chatLabel = progress.totalScenes === 1 ? 'chat' : 'chats'
    return {
      title: progress.totalScenes > 0 ? 'Loading Chats' : 'Loading Campaign',
      detail: progress.totalScenes > 0
        ? `Loading ${chatLabel} ${progress.scenesLoaded} of ${progress.totalScenes}…`
        : 'Reading campaign data from disk…',
      percent: progress.percent,
    }
  }

  if (progress.status === 'loading-characters') {
    const characterLabel = progress.totalScenes === 1 ? 'character' : 'characters'
    return {
      title: progress.totalScenes > 0 ? 'Loading Characters' : 'Finalizing Campaign',
      detail: progress.totalScenes > 0
        ? `Loading ${characterLabel} ${progress.scenesLoaded} of ${progress.totalScenes}…`
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

  /** ID of the scene currently displayed in the chat area. */
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  /** ID of the scene currently highlighted in the sidebar. */
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  /** True while the chat panel is switching to a different scene transcript. */
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
  /** Latest model download progress snapshot for close/unload cancellation. */
  const modelDownloadProgressRef = useRef<ModelDownloadProgress | null>(null)

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
  /** Per-scene delayed summary timers. */
  const summaryTimeoutsRef = useRef<Record<string, number | undefined>>({})
  /** Per-scene rolling-summary jobs currently executing. */
  const summaryPromisesRef = useRef<Record<string, Promise<void> | undefined>>({})
  /** scenes currently being summarized in the background. */
  const summaryInFlightRef = useRef<Set<string>>(new Set())
  /** scenes that should be summarized again after the current pass finishes. */
  const summaryRerunRef = useRef<Set<string>>(new Set())
  /** scenes whose transcript edits require a full summary rebuild before reuse. */
  const summaryDirtyScenesRef = useRef<Set<string>>(new Set())
  /** Pending animation-frame handles used to stage scene switches. */
  const sceneSwitchFrameRef = useRef<number | null>(null)
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
  /** True while the scenes workspace modal is open. */
  const [isScenesOpen, setIsScenesOpen] = useState(false)
  /** True while the lore book workspace modal is open. */
  const [isLoreBookOpen, setIsLoreBookOpen] = useState(false)

  /** True while the system prompt editor modal is open. */
  const [isCharactersOpen, setIsCharactersOpen] = useState(false)
  /** True while the scene character management modal is open. */
  const [isSceneCharactersOpen, setIsSceneCharactersOpen] = useState(false)
  /** True while the current scene summary modal is open. */
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
  /** Scene currently awaiting delete confirmation. */
  const [pendingDeleteSceneId, setPendingDeleteSceneId] = useState<string | null>(null)

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
  /** Status message shown in the new-scene character picker. */
  const [newSceneStatusMessage, setNewSceneStatusMessage] = useState<string | null>(null)
  /** Visual state of the new-scene status message. */
  const [newSceneStatusKind, setNewSceneStatusKind] = useState<'error' | 'success' | null>(null)
  /** True while importing characters and creating a new scene. */
  const [isStartingScene, setIsStartingScene] = useState(false)

  /** True while the create campaign modal is open. */
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false)
  /** True while the campaign management modal is open. */
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false)
  /** True while the model loader modal is open. */
  const [isModelLoaderOpen, setIsModelLoaderOpen] = useState(false)
  /** True while the new-scene character picker modal is open. */
  const [isNewSceneModalOpen, setIsNewSceneModalOpen] = useState(false)
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

  /** Pre-authored app characters. */
  const [appCharacters, setAppCharacters] = useState<Array<{
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
  }>>([])

  /** Pre-authored app avatars. */
  const [appAvatars, setAppAvatars] = useState<Array<{
    id: string
    name: string
    imageData: string
    crop: { x: number; y: number; scale: number }
  }>>([])

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
   * Fetch app content (pre-authored characters and avatars) on mount.
   */
  useEffect(() => {
    window.api.getAppContent().then(content => {
      setAppCharacters(content.characters)
      setAppAvatars(content.avatars)
    }).catch(error => {
      console.error('Failed to load app content:', error)
    })
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
      modelDownloadProgressRef.current = progress
      setIsDownloadingModel(progress.status === 'starting' || progress.status === 'downloading')
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
   * Cancel the currently active GGUF download when one is in flight.
   */
  async function cancelActiveModelDownloadIfNeeded(): Promise<void> {
    const activeDownload = modelDownloadProgressRef.current
    const activeServerState = appSettingsRef.current.servers.find((server) => server.id === appSettingsRef.current.activeServerId) ?? null

    if (
      !activeDownload ||
      (activeDownload.status !== 'starting' && activeDownload.status !== 'downloading') ||
      !activeServerState ||
      activeServerState.kind !== 'llama.cpp'
    ) {
      return
    }

    try {
      await window.api.cancelHuggingFaceModelDownload(
        activeServerState.id,
        activeDownload.repoId,
        activeDownload.fileName,
      )
    } catch {
      // Best-effort cancellation during close/unload.
    }
  }

  /**
   * Best-effort cancellation for window close/reload while a model download is active.
   */
  useEffect(() => {
    function handleBeforeUnload(): void {
      void cancelActiveModelDownloadIfNeeded()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

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

  /** All roleplay scenes available in the sidebar. */
  const scenes = campaign?.scenes ?? []

  /** The full scene object for the active scene (or null). */
  const activeScene = scenes.find((s) => s.id === activeSceneId) ?? null
  /** True while a campaign switch is showing the dedicated full-screen loading state. */
  const isCampaignSwitchLoading = campaignLauncherLoadingState !== null
  /** True when any modal or confirmation dialog is currently covering the workspace. */
  const isAnyModalOpen =
    isSettingsOpen ||
    isScenesOpen ||
    isLoreBookOpen ||
    isCharactersOpen ||
    isNewSceneModalOpen ||
    isSceneCharactersOpen ||
    isSummaryModalOpen ||
    isCreateCampaignOpen ||
    isCampaignModalOpen ||
    isModelLoaderOpen ||
    isModelParametersOpen ||
    isAiDebugOpen ||
    pendingDeleteMessageId !== null ||
    pendingDeleteSceneId !== null

  /**
   * Restore composer focus once the last open modal or confirmation dialog closes.
   */
  useEffect(() => {
    if (wasModalOpenRef.current && !isAnyModalOpen) {
      setComposerFocusRequestKey((prev) => prev + 1)
    }

    wasModalOpenRef.current = isAnyModalOpen
  }, [isAnyModalOpen])

  /** Messages belonging to the active scene. */
  const messages: Message[] = activeScene?.messages ?? []
  /** Campaign characters currently enabled for the active scene. */
  /**
   * Cancel any scheduled scene activation that has not executed yet.
   */
  function clearScheduledSceneSwitch(): void {
    if (sceneSwitchFrameRef.current == null) {
      return
    }

    window.cancelAnimationFrame(sceneSwitchFrameRef.current)
    sceneSwitchFrameRef.current = null
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
   * Stage a scene switch so the loading affordance can paint before a large
   * transcript render blocks the renderer for a moment.
   *
   * @param nextSceneId - Scene to activate.
   */
  function scheduleSceneActivation(nextSceneId: string): void {
    if (nextSceneId === activeSceneId) {
      clearScheduledChatReveal()
      chatLoadingStartedAtRef.current = null
      setSelectedSceneId(nextSceneId)
      setIsChatLoading(false)
      return
    }

    clearScheduledSceneSwitch()
    clearScheduledChatReveal()
    setSelectedSceneId(nextSceneId)
    chatLoadingStartedAtRef.current = Date.now()
    setIsChatLoading(true)

    sceneSwitchFrameRef.current = window.requestAnimationFrame(() => {
      sceneSwitchFrameRef.current = window.requestAnimationFrame(() => {
        sceneSwitchFrameRef.current = null
        setActiveSceneId(nextSceneId)
      })
    })
  }

  const enabledSceneCharacters = useMemo(
    () => getEnabledSceneCharacters(activeScene, characters),
    [activeScene, characters],
  )

  /** The character currently selected for the next outgoing user message. */
  const composerCharacter =
    enabledSceneCharacters.find((character) => character.id === composerCharacterId) ?? null
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
    if (!campaign || !activeScene) {
      return []
    }

    return buildSystemContext(
      campaign,
      enabledSceneCharacters,
      activeScene,
      appSettings.campaignBasePrompt,
      appSettings.formattingRules,
      appSettings.systemPrompt,
      getPromptSceneSummary(activeScene, appSettings.enableRollingSummaries),
      relationshipGraph,
    )
  }, [
    activeScene,
    appSettings.campaignBasePrompt,
    appSettings.enableRollingSummaries,
    appSettings.formattingRules,
    appSettings.systemPrompt,
    relationshipGraph,
    campaign,
    enabledSceneCharacters,
  ])

  /** Stable chat-history payload for the active scene. */
  const apiMessages = useMemo(() => {
    if (!activeScene) {
      return []
    }

    return toApiMessages(
      getPromptWindowMessages(
        activeScene,
        appSettings.enableRollingSummaries,
        appSettings.recentMessagesWindow,
      ),
    )
  }, [activeScene, appSettings.enableRollingSummaries, appSettings.recentMessagesWindow])

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
  }, [activeSceneId, activeScene?.disabledCharacterIds, campaignPath, activeModel?.id, campaign?.id, characters])

  /**
   * Cancel delayed summary work whenever rolling summaries are disabled.
   */
  useEffect(() => {
    if (appSettings.enableRollingSummaries) {
      return
    }

    for (const sceneId of Object.keys(summaryTimeoutsRef.current)) {
      clearSummaryTimer(sceneId)
    }
    summaryRerunRef.current.clear()
  }, [appSettings.enableRollingSummaries])

  /**
   * Clean up background summary timers when the app unmounts.
   */
  useEffect(() => {
    return () => {
      for (const sceneId of Object.keys(summaryTimeoutsRef.current)) {
        const timerId = summaryTimeoutsRef.current[sceneId]
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

    if (enabledSceneCharacters.length === 0) {
      if (composerCharacterId !== null) {
        setComposerCharacterId(null)
      }
      return
    }

    const stillExists = enabledSceneCharacters.some((character) => character.id === composerCharacterId)
    if (stillExists) {
      return
    }

    const defaultCharacter =
      enabledSceneCharacters.find((character) => character.controlledBy === 'user') ??
      enabledSceneCharacters[0] ??
      null

    setComposerCharacterId(defaultCharacter?.id ?? null)
  }, [composerCharacterId, enabledSceneCharacters])

  /**
   * Keep the active scene selection valid whenever the campaign changes.
   */
  useEffect(() => {
    return () => {
      clearScheduledSceneSwitch()
      clearScheduledChatReveal()
    }
  }, [])

  useEffect(() => {
    if (!campaign) {
      if (activeSceneId !== null) {
        setActiveSceneId(null)
      }
      if (selectedSceneId !== null) {
        setSelectedSceneId(null)
      }
      return
    }

    if (campaign.scenes.length === 0) {
      if (activeSceneId !== null) {
        setActiveSceneId(null)
      }
      if (selectedSceneId !== null) {
        setSelectedSceneId(null)
      }
      return
    }

    const hasActiveScene = campaign.scenes.some((scene) => scene.id === activeSceneId)
    if (!hasActiveScene) {
      setActiveSceneId(campaign.scenes[0].id)
    }

    const hasSelectedScene = campaign.scenes.some((scene) => scene.id === selectedSceneId)
    if (!hasSelectedScene) {
      setSelectedSceneId(hasActiveScene ? activeSceneId : campaign.scenes[0].id)
    }
  }, [activeSceneId, campaign, selectedSceneId])

  /**
   * Rebuild missing character IDs whenever a scene is opened for display.
   */
  useEffect(() => {
    if (!campaign || !activeSceneId || characters.length === 0) {
      return
    }

    setCampaign((prev) => {
      if (!prev) {
        return prev
      }

      const nextCampaign = hydrateCampaignMessageCharacterIds(prev, characters)
      return nextCampaign
    })
  }, [activeSceneId, campaign, characters])

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
   * Append or update a message inside a specific scene.
   * If a message with `msg.id` already exists it is replaced; otherwise appended.
   * New messages are summarized incrementally by the background rolling-summary
   * worker, so only destructive transcript edits should mark a scene dirty.
   * @param sceneId - Target scene.
   * @param msg       - Message to upsert.
   */
  function upsertMessage(sceneId: string, msg: Message): void {
    updateCampaign((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => {
        if (s.id !== sceneId) return s
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
   * @param sceneId - Target scene receiving the assistant reply.
   * @param messageIds - Stable IDs allocated for the streamed assistant bubbles.
   * @param contents - Bubble text content in visual order.
   * @param timestamp - Timestamp applied to all streamed assistant bubbles.
   */
function syncStreamedAssistantMessages(
    sceneId: string,
    messageIds: string[],
    bubbles: StreamedAssistantBubble[],
    timestamp: number,
  ): void {
      updateCampaign((prev) => ({
        ...prev,
        scenes: prev.scenes.map((scene) => {
        if (scene.id !== sceneId) {
          return scene
        }

        const keepMessages = scene.messages.filter((message) => !messageIds.includes(message.id))
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
          ...scene,
          messages: [...keepMessages, ...streamedMessages],
          updatedAt: Date.now(),
        }
        }),
      }))

    }

  /**
   * Ensure there is an active scene to receive messages.
   *
   * When no scene is active, require the normal scene-creation flow so
   * active characters are selected explicitly and persisted correctly.
   *
   * @returns Active scene ID, or null when the user must create one first.
   */
  function ensureActiveScene(): string | null {
    if (activeSceneId) {
      return activeSceneId
    }

    setNewSceneStatusKind('error')
    setNewSceneStatusMessage('Start a scene and choose its active characters before sending messages.')
    setIsNewSceneModalOpen(true)
    return null
  }

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty scene, add it to the list, and make it active.
   */
  function handleNewScene(): void {
    setNewSceneStatusKind(null)
    setNewSceneStatusMessage(null)
    setIsNewSceneModalOpen(true)
  }

  /**
   * Switch the active scene.
   * @param id - ID of the scene to activate.
   */
  function handleSelectScene(id: string) {
    scheduleSceneActivation(id)
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
   * Enable or disable one campaign character for the active scene.
   *
   * If the character has already appeared in the transcript, disabling them
   * requires confirmation because it can change continuity.
   *
   * @param characterId - Character being toggled.
   */
  async function handleToggleSceneCharacter(characterId: string): Promise<void> {
    if (!activeScene || !campaign) {
      return
    }

    const character = characters.find((candidate) => candidate.id === characterId) ?? null
    if (!character) {
      return
    }

    const activeCharacterIds = new Set(
      getsceneActiveCharacterIds(activeScene) ?? characters.map((candidate) => candidate.id),
    )
    const disabledCharacterIds = new Set(getsceneDisabledCharacterIds(activeScene))
    const isCurrentlyEnabled = activeCharacterIds.has(characterId)

    if (isCurrentlyEnabled) {
      const normalizedCharacterName = character.name.trim().toLocaleLowerCase()
      const appearsInscene = activeScene.messages.some((message) => (
        message.characterId === characterId ||
        message.characterName?.trim().toLocaleLowerCase() === normalizedCharacterName
      ))

      if (appearsInscene) {
        const confirmed = await confirm({
          title: 'Turn Off Character',
          message: `${character.name} already appears in this scene's chat history. Turning them off may affect continuity and the flow of the scene. Continue?`,
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
      scenes: campaign.scenes.map((scene) => (
        scene.id === activeScene.id
          ? {
            ...scene,
            activeCharacterIds: characters
              .filter((candidate) => activeCharacterIds.has(candidate.id))
              .map((candidate) => candidate.id),
            disabledCharacterIds: [...disabledCharacterIds],
            updatedAt: now,
          }
          : scene
      )),
    }

    setCampaign(nextCampaign)
    if (campaignPath) {
      void window.api.saveCampaign(campaignPath, nextCampaign)
        .then(() => {
          lastSavedCampaignRef.current = nextCampaign
        })
        .catch((err) => {
          console.error('[Aethra] Could not save scene character changes:', err)
          setCampaignStatusMessage('Could not save the active scene cast.')
        })
    }
  }

  /**
   * Delete a scene after explicit user confirmation.
   *
   * @param sceneId - ID of the scene to remove.
   */
  function handleDeleteScene(sceneId: string): void {
    if (!campaign || isStreaming) {
      return
    }

    const sceneIndex = campaign.scenes.findIndex((scene) => scene.id === sceneId)
    if (sceneIndex === -1) {
      return
    }

    setPendingDeleteSceneId(sceneId)
  }

  /**
   * Close the scene deletion confirmation dialog.
   */
  function handleCancelDeletescene(): void {
    setPendingDeleteSceneId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Permanently delete the currently selected scene.
   */
  function handleConfirmDeletescene(): void {
    if (!campaign || !pendingDeleteSceneId || isStreaming) {
      return
    }

    const sceneIndex = campaign.scenes.findIndex((scene) => scene.id === pendingDeleteSceneId)
    if (sceneIndex === -1) {
      setPendingDeleteSceneId(null)
      return
    }

    const remainingScenes = campaign.scenes.filter((candidate) => candidate.id !== pendingDeleteSceneId)
    clearSummaryTimer(pendingDeleteSceneId)
    summaryInFlightRef.current.delete(pendingDeleteSceneId)
    summaryRerunRef.current.delete(pendingDeleteSceneId)

    updateCampaign((prev) => ({
      ...prev,
      scenes: prev.scenes.filter((candidate) => candidate.id !== pendingDeleteSceneId),
    }))

    if (activeSceneId === pendingDeleteSceneId) {
      const nextscene = remainingScenes[sceneIndex] ?? remainingScenes[sceneIndex - 1] ?? null
      setActiveSceneId(nextscene?.id ?? null)
      setSelectedSceneId(nextscene?.id ?? null)
    }

    setPendingDeleteSceneId(null)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Delete a single message from the active scene after explicit confirmation.
   *
   * @param messageId - ID of the message to remove.
   */
  function handleDeleteMessage(messageId: string): void {
    if (!activeScene || isStreaming) {
      return
    }

    const message = activeScene.messages.find((candidate) => candidate.id === messageId)
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
    if (!activeScene || !pendingDeleteMessageId) {
      return
    }

    const messageId = pendingDeleteMessageId
    resetRollingSummary(activeScene.id)
    updateCampaign((prev) => ({
      ...prev,
      scenes: prev.scenes.map((scene) => {
        if (scene.id !== activeScene.id) {
          return scene
        }

        const nextMessages = scene.messages.filter((candidate) => candidate.id !== messageId)
        return {
          ...scene,
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
      setActiveSceneId(hydratedCampaign.scenes[0]?.id ?? null)
      setSelectedSceneId(hydratedCampaign.scenes[0]?.id ?? null)
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
      setActiveSceneId(hydratedCampaign.scenes[0]?.id ?? null)
      setSelectedSceneId(hydratedCampaign.scenes[0]?.id ?? null)
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
   * Leave the active campaign workspace and return to the launcher screen.
   * Keeps persisted data intact while clearing campaign-scoped UI state.
   */
  async function handleExitCampaign(): Promise<void> {
    if (isStreaming || isCampaignBusy || isStartingScene) {
      return
    }

    const confirmed = await confirm({
      title: 'Exit Campaign',
      message: 'This will close the current campaign workspace and return to the home screen.',
      warning: 'Your campaign data will remain on disk. This does not delete the campaign.',
      confirmLabel: 'Exit Campaign',
      cancelLabel: 'Stay Here',
    })

    if (!confirmed) {
      return
    }

    for (const sceneId of Object.keys(summaryTimeoutsRef.current)) {
      clearSummaryTimer(sceneId)
    }
    summaryInFlightRef.current.clear()
    summaryRerunRef.current.clear()
    summaryDirtyScenesRef.current.clear()
    setCampaign(null)
    setCampaignPath(null)
    setCharacters([])
    setRelationshipGraph(null)
    setPendingRelationshipGraph(null)
    setRefreshRelationshipsError(null)
    setRefreshStartedAt(0)
    setActiveSceneId(null)
    setSelectedSceneId(null)
    setActiveCharacterId(null)
    setComposerCharacterId(null)
    setInputValue('')
    setLastTokenUsage(null)
    setCampaignStatusMessage(null)
    setCampaignLoadProgress(null)
    setCampaignLauncherLoadingState(null)
    setPendingDeleteMessageId(null)
    setPendingDeleteSceneId(null)
    setIsSettingsOpen(false)
    setIsScenesOpen(false)
    setIsLoreBookOpen(false)
    setIsCharactersOpen(false)
    setIsSceneCharactersOpen(false)
    setIsSummaryModalOpen(false)
    setIsCreateCampaignOpen(false)
    setIsCampaignModalOpen(false)
    setIsModelLoaderOpen(false)
    setIsNewSceneModalOpen(false)
    setIsModelParametersOpen(false)
    setIsAiDebugOpen(false)
    setActiveTab('')
    lastSavedCampaignRef.current = null
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Trigger an LLM relationship refresh for the active scene.
   * On success, opens the RelationshipReviewModal with the merged graph.
   * Only analyzes characters active in the current scene and its messages.
   */
  async function handleRefreshRelationships(): Promise<void> {
    if (!campaign || !campaignPath || !activeScene || characters.length < 2 || isRefreshingRelationships) return
    setIsRefreshingRelationships(true)
    setRefreshRelationshipsError(null)
    // Record the dispatch timestamp BEFORE the async call so entries updated
    // in this specific refresh can be identified in the review modal.
    const startedAt = Date.now()
    refreshStartedAtRef.current = startedAt
    setRefreshStartedAt(startedAt)
    try {
      const sceneCharacters = getEnabledSceneCharacters(activeScene, characters)
      const merged = await window.api.refreshRelationships(
        campaignPath,
        campaign.id,
        sceneCharacters,
        [activeScene],
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

    if (tabId === 'scenes') {
      setIsScenesOpen(true)
      return
    }

    if (tabId === 'lore-book') {
      setIsLoreBookOpen(true)
      return
    }

    setActiveTab(tabId)
  }

  /**
   * Close the settings modal.
   */
  function handleCloseSettings(): void {
    void cancelActiveModelDownloadIfNeeded()
    setIsSettingsOpen(false)
  }

  /**
   * Close the characters modal.
   */
  function handleCloseCharacters(): void {
    setCharactersStatusKind(null)
    setCharactersStatusMessage(null)
    setIsCharactersOpen(false)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Close the new-scene character picker modal.
   */
  function handleCloseNewSceneModal(): void {
    if (isStartingScene) {
      return
    }

    setIsNewSceneModalOpen(false)
    setNewSceneStatusKind(null)
    setNewSceneStatusMessage(null)
  }

  /**
   * Open the scene character management modal.
   */
  function handleOpenSceneCharacters(): void {
    setIsSceneCharactersOpen(true)
  }

  /**
   * Close the scene character management modal.
   */
  function handleClosesceneCharacters(): void {
    setIsSceneCharactersOpen(false)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Open the current scene summary modal.
   */
  function handleOpenSummaryModal(): void {
    setSummaryModalStatusKind(null)
    setSummaryModalStatusMessage(null)
    setIsSummaryModalOpen(true)
  }

  /**
   * Close the current scene summary modal.
   */
  function handleCloseSummaryModal(): void {
    setIsSummaryModalOpen(false)
    setComposerFocusRequestKey((prev) => prev + 1)
  }

  /**
   * Rebuild the active scene summary from as much raw transcript as the
   * current model context should allow in one request.
   * Also generates a relationship-focused narrative summary after rebuild completes.
   */
  async function handleRebuildSummary(): Promise<void> {
    if (!activeScene || isRebuildingSummary) {
      return
    }

    clearSummaryTimer(activeScene.id)
    summaryRerunRef.current.delete(activeScene.id)
    setIsRebuildingSummary(true)
    setSummaryModalStatusKind(null)
    setSummaryModalStatusMessage('Rebuilding summary...')

    try {
      const { summary, summarizedMessageCount, passCount } = await rebuildsceneSummaryFromTranscript(
        activeScene,
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
        scenes: prev.scenes.map((scene) =>
          scene.id === activeScene.id
            ? {
              ...scene,
              rollingSummary: summary,
              summarizedMessageCount,
              updatedAt: Date.now(),
            }
            : scene,
        ),
      }))
      summaryDirtyScenesRef.current.delete(activeScene.id)

      setSummaryModalStatusKind('success')

      // Generate relationship narrative
      if (appSettingsRef.current.enableRollingRelationshipSummaries && campaign && campaignPath) {
        try {
          setSummaryModalStatusMessage('Generating relationship summary...')
          const sceneCharacters = getEnabledSceneCharacters(activeScene, characters)
          const narrative = await window.api.generateRelationshipNarrative(
            campaignPath,
            campaign.id,
            sceneCharacters,
            [activeScene],
          )
          // Save narrative to the scene
          updateCampaign((prev) => ({
            ...prev,
            scenes: prev.scenes.map((scene) =>
              scene.id === activeScene.id
                ? {
                  ...scene,
                  relationshipNarrativeSummary: narrative,
                  updatedAt: Date.now(),
                }
                : scene,
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
      console.error('[Aethra] Could not rebuild scene summary:', err)
      setSummaryModalStatusKind('error')
      setSummaryModalStatusMessage(
        err instanceof Error ? err.message : 'Could not rebuild the scene summary.',
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
   * Clear any delayed summary timer for a scene.
   *
   * @param sceneId - Target scene.
   */
  function clearSummaryTimer(sceneId: string): void {
    const timerId = summaryTimeoutsRef.current[sceneId]
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
      delete summaryTimeoutsRef.current[sceneId]
    }
  }

  /**
   * Start a background refresh of the rolling summary for a scene.
   *
   * @param sceneId - Target scene.
   */
  async function performRollingSummary(
    sceneId: string,
    options: { allowDuringStreaming?: boolean } = {},
  ): Promise<void> {
    const settings = appSettingsRef.current
    if (!settings.enableRollingSummaries) {
      return
    }

    if (summaryInFlightRef.current.has(sceneId)) {
      summaryRerunRef.current.add(sceneId)
      return
    }

    if (isStreamingRef.current && !options.allowDuringStreaming) {
      scheduleRollingSummary(sceneId)
      return
    }

    const currentCampaign = campaignRef.current
    const scene = currentCampaign?.scenes.find((candidate) => candidate.id === sceneId) ?? null
    if (!scene) {
      return
    }

    const isDirty = summaryDirtyScenesRef.current.has(sceneId)
    const visibleMessages = getVisiblePromptMessages(scene.messages)
    if (isDirty && visibleMessages.length <= settings.recentMessagesWindow) {
      summaryDirtyScenesRef.current.delete(sceneId)
      return
    }

    const snapshot = createsceneSummarySnapshot(scene, settings.recentMessagesWindow)
    if (!isDirty && !snapshot) {
      return
    }

    summaryInFlightRef.current.add(sceneId)
    try {
      const summaryResult = isDirty
        ? await rebuildsceneSummaryFromTranscript(
          scene,
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
        scenes: prev.scenes.map((candidate) => {
          if (candidate.id !== sceneId) {
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
      summaryDirtyScenesRef.current.delete(sceneId)
    } catch (err) {
      console.error('[Aethra] Could not refresh rolling summary:', err)
    } finally {
      summaryInFlightRef.current.delete(sceneId)
      if (summaryRerunRef.current.has(sceneId)) {
        summaryRerunRef.current.delete(sceneId)
        scheduleRollingSummary(sceneId)
      }
    }
  }

  /**
   * Start or join a rolling-summary refresh for a scene.
   *
   * @param sceneId - Target scene.
   * @param options - Execution options for the current caller.
   * @returns Promise resolving when the active summary pass completes.
   */
  function runRollingSummary(
    sceneId: string,
    options: { allowDuringStreaming?: boolean } = {},
  ): Promise<void> {
    const existingPromise = summaryPromisesRef.current[sceneId]
    if (existingPromise) {
      summaryRerunRef.current.add(sceneId)
      return existingPromise
    }

    const promise = performRollingSummary(sceneId, options).finally(() => {
      if (summaryPromisesRef.current[sceneId] === promise) {
        delete summaryPromisesRef.current[sceneId]
      }
    })
    summaryPromisesRef.current[sceneId] = promise
    return promise
  }

  /**
   * Queue a delayed rolling-summary refresh so live play can continue first.
   *
   * @param sceneId - Target scene.
   */
  function scheduleRollingSummary(sceneId: string): void {
    if (!appSettingsRef.current.enableRollingSummaries) {
      return
    }

    clearSummaryTimer(sceneId)
    summaryTimeoutsRef.current[sceneId] = window.setTimeout(() => {
      delete summaryTimeoutsRef.current[sceneId]
      void runRollingSummary(sceneId)
    }, SUMMARY_IDLE_DELAY_MS)
  }

  /**
   * Refresh a scene summary until all pre-send archived transcript has been
   * folded into the rolling summary.
   *
   * @param sceneId - Target scene.
   * @returns Latest scene snapshot after catch-up completes.
   */
  async function catchUpRollingSummaryBeforeSend(sceneId: string): Promise<Scene | null> {
    const recentMessagesWindow = appSettingsRef.current.recentMessagesWindow
    if (!appSettingsRef.current.enableRollingSummaries) {
      return campaignRef.current?.scenes.find((scene) => scene.id === sceneId) ?? null
    }

    while (true) {
      const scene = campaignRef.current?.scenes.find((candidate) => candidate.id === sceneId) ?? null
      if (!scene) {
        return null
      }

      if (summaryDirtyScenesRef.current.has(sceneId) && getVisiblePromptMessages(scene.messages).length <= recentMessagesWindow) {
        summaryDirtyScenesRef.current.delete(sceneId)
        return scene
      }

      if (summaryDirtyScenesRef.current.has(sceneId) || createsceneSummarySnapshot(scene, recentMessagesWindow)) {
        clearSummaryTimer(sceneId)
        await runRollingSummary(sceneId, { allowDuringStreaming: true })
        continue
      }

      if (!createsceneSummarySnapshot(scene, recentMessagesWindow)) {
        return scene
      }
    }
  }

  /**
   * Reset a scene summary when the transcript is edited in a way that can
   * invalidate archived continuity.
   *
   * @param sceneId - Target scene.
   */
  function resetRollingSummary(sceneId: string): void {
    clearSummaryTimer(sceneId)
    summaryRerunRef.current.delete(sceneId)
    summaryDirtyScenesRef.current.add(sceneId)

    updateCampaign((prev) => ({
      ...prev,
      scenes: prev.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, rollingSummary: '', summarizedMessageCount: 0, updatedAt: Date.now() }
          : scene,
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
   * Persist the selected chat bubble formatting preset.
   *
   * @param mode - Selected action/speech rendering mode.
   */
  async function handleChatBubbleFormattingModeSelect(mode: ChatBubbleFormattingMode): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      chatBubbleFormattingMode: mode,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        mode === 'emphasized'
          ? 'Chat bubble formatting set to emphasized.'
          : 'Chat bubble formatting set to plain.',
      )
    } catch (err) {
      console.error('[Aethra] Could not save chat bubble formatting mode:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the chat bubble formatting setting.')
    }
  }

  /**
   * Persist how assistant replies should be displayed while a stream is active.
   *
   * @param mode - Selected assistant response display mode.
   */
  async function handleAssistantResponseDisplayModeSelect(mode: AssistantResponseDisplayMode): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      assistantResponseDisplayMode: mode,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        mode === 'stream'
          ? 'Assistant replies will now stream live.'
          : 'Assistant replies will now appear after completion.',
      )
    } catch (err) {
      console.error('[Aethra] Could not save assistant response display mode:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the assistant response display setting.')
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
      if (!enabled && activeScene) {
        clearSummaryTimer(activeScene.id)
      }
      if (enabled && activeScene) {
        scheduleRollingSummary(activeScene.id)
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
   * Enable or disable rolling relationship summaries for scene analysis.
   *
   * @param enabled - Whether relationship summaries should refresh automatically.
   */
  async function handleRollingRelationshipSummariesToggle(enabled: boolean): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      enableRollingRelationshipSummaries: enabled,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(
        enabled
          ? 'Rolling relationship summaries enabled.'
          : 'Rolling relationship summaries disabled.',
      )
    } catch (err) {
      console.error('[Aethra] Could not update rolling relationship summary setting:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the rolling relationship summary setting.')
    }
  }

  /**
   * Persist the recent-message window kept verbatim when rolling summaries are enabled.
   *
   * @param count - Desired number of recent prompt-visible messages.
   */
  async function handleRecentMessagesWindowChange(count: number): Promise<void> {
    const normalizedCount = Math.max(
      RECENT_MESSAGES_WINDOW_RANGE.min,
      Math.min(RECENT_MESSAGES_WINDOW_RANGE.max, Math.floor(Number.isFinite(count) ? count : DEFAULT_RECENT_MESSAGES_WINDOW)),
    )
    const nextSettings: AppSettings = {
      ...appSettings,
      recentMessagesWindow: normalizedCount,
    }

    try {
      await persistSettings(nextSettings)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Recent message window updated to ${normalizedCount}.`)
    } catch (err) {
      console.error('[Aethra] Could not save recent message window:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not save the recent message window.')
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
    relationshipSummarySystemPrompt: string
  }): Promise<void> {
    const nextSettings: AppSettings = {
      ...appSettings,
      campaignBasePrompt: prompts.campaignBasePrompt,
      formattingRules: prompts.formattingRules,
      rollingSummarySystemPrompt: prompts.rollingSummarySystemPrompt,
      relationshipSummarySystemPrompt: prompts.relationshipSummarySystemPrompt,
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
   * Query the chosen server for its available models and persist the catalog
   * into settings so it remains selectable on future launches.
   *
   * @param serverId - Server profile to browse.
   * @param statusTarget - UI surface that should receive status updates.
   */
  async function handleBrowseModelsForServer(
    serverId: string,
    statusTarget: 'settings' | 'model-loader' = 'settings',
  ): Promise<void> {
    const server = appSettings.servers.find((candidate) => candidate.id === serverId) ?? null
    if (!server) {
      if (statusTarget === 'model-loader') {
        setModelLoaderStatusKind('error')
        setModelLoaderStatusMessage('Select a server before refreshing models.')
      } else {
        setSettingsStatusKind('error')
        setSettingsStatusMessage('Select a server before browsing models.')
      }
      return
    }

    setIsBrowsingModels(true)

    try {
      await appendAiDebugEntry('info', 'ai.models.browse.start', {
        serverId: server.id,
        serverName: server.name,
        baseUrl: server.baseUrl,
      })

      const discoveredModels = await window.api.browseModels(server.id)
      await appendAiDebugEntry('response', 'ai.models.browse.result', {
        serverId: server.id,
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
        ...appSettings.models.filter((model) => model.serverId !== server.id),
        ...persistedModels,
      ]

      const nextActiveModelSlug = discoveredModels.some((model) => model.slug === appSettings.activeModelSlug)
        ? appSettings.activeModelSlug
        : (discoveredModels[0]?.slug ?? null)

      const nextSettings: AppSettings = {
        ...appSettings,
        models: nextModels,
        activeServerId: server.id,
        activeModelSlug: nextActiveModelSlug,
      }

      setAvailableModels(discoveredModels)
      await persistSettings(nextSettings)
      await appendAiDebugEntry('info', 'ai.models.persisted', {
        serverId: server.id,
        activeModelSlug: nextActiveModelSlug,
        persistedModels: persistedModels.map((model) => ({
          id: model.id,
          slug: model.slug,
          name: model.name,
          contextWindowTokens: model.contextWindowTokens ?? null,
        })),
      })
      const successMessage =
        discoveredModels.length > 0
          ? `Loaded ${discoveredModels.length} model${discoveredModels.length === 1 ? '' : 's'} from ${server.name}.`
          : `No models were reported by ${server.name}.`

      if (statusTarget === 'model-loader') {
        setModelLoaderStatusKind('success')
        setModelLoaderStatusMessage(successMessage)
      } else {
        setSettingsStatusKind('success')
        setSettingsStatusMessage(successMessage)
      }
    } catch (err) {
      await appendAiDebugEntry('error', 'ai.models.browse.error', {
        serverId: server.id,
        message: err instanceof Error ? err.message : String(err),
      })
      console.error('[Aethra] Could not browse models:', err)
      if (statusTarget === 'model-loader') {
        setModelLoaderStatusKind('error')
        setModelLoaderStatusMessage(err instanceof Error ? err.message : 'Could not refresh models.')
      } else {
        setSettingsStatusKind('error')
        setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not browse models.')
      }
    } finally {
      setIsBrowsingModels(false)
    }
  }

  /**
   * Query the active settings server for its available models.
   */
  async function handleBrowseModels(): Promise<void> {
    if (!activeServer) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select a server before browsing models.')
      return
    }

    await handleBrowseModelsForServer(activeServer.id, 'settings')
  }

  /**
   * Delete one local embedded model after explicit confirmation.
   *
   * When the GGUF lives in a nested folder, the containing folder is removed
   * recursively. Files at the root of the models directory are deleted
   * individually so the models root itself is preserved.
   *
   * @param modelSlug - Local model slug to delete.
   */
  async function handleDeleteLocalModel(modelSlug: string): Promise<void> {
    const server = activeServer
    if (!server || server.kind !== 'llama.cpp') {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select the embedded AI provider before deleting local models.')
      return
    }

    const model = appSettings.models.find((candidate) => candidate.serverId === server.id && candidate.slug === modelSlug) ?? null
    if (!model) {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Could not find the selected local model.')
      return
    }

    const confirmed = await confirm({
      title: `Delete ${model.name}?`,
      message: `Delete ${model.name} from local storage?`,
      warning: 'This permanently removes the model file and, when present, its containing folder.',
      confirmLabel: 'Delete',
    })

    if (!confirmed) {
      return
    }

    try {
      const nextSettings = await window.api.deleteLocalModel(server.id, model.slug)
      setAppSettings(nextSettings)
      setAvailableModels((prev) => prev.filter((candidate) => !(candidate.serverId === server.id && candidate.slug === model.slug)))
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Deleted ${model.name}.`)
    } catch (err) {
      console.error('[Aethra] Could not delete local model:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not delete the local model.')
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
   * Cancel an in-flight GGUF download from Hugging Face.
   *
   * @param repoId - Hugging Face repository identifier.
   * @param fileName - Repository-relative GGUF path.
   */
  async function handleCancelHuggingFaceModelDownload(repoId: string, fileName: string): Promise<void> {
    if (!activeServer || activeServer.kind !== 'llama.cpp') {
      setSettingsStatusKind('error')
      setSettingsStatusMessage('Select the local llama.cpp provider before cancelling downloads.')
      return
    }

    try {
      await window.api.cancelHuggingFaceModelDownload(activeServer.id, repoId, fileName)
      setSettingsStatusKind('success')
      setSettingsStatusMessage(`Cancelling ${fileName}...`)
    } catch (err) {
      console.error('[Aethra] Could not cancel Hugging Face model download:', err)
      setSettingsStatusKind('error')
      setSettingsStatusMessage(err instanceof Error ? err.message : 'Could not cancel the model download.')
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
  async function handleSaveCharacter(character: CharacterProfile): Promise<CharacterProfile> {
    if (!campaignPath) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Open a campaign before saving characters.')
      throw new Error('Open a campaign before saving characters.')
    }

    if (!character.name.trim()) {
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Character name cannot be empty.')
      throw new Error('Character name cannot be empty.')
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
        updateCampaign((prev) => disableCharacterInExistingscenes(prev, savedCharacter.id))
      }
      setActiveCharacterId(savedCharacter.id)
      setCharactersStatusKind('success')
      setCharactersStatusMessage(`Saved ${savedCharacter.name}.`)
      return savedCharacter
    } catch (err) {
      console.error('[Aethra] Could not save character:', err)
      setCharactersStatusKind('error')
      setCharactersStatusMessage(err instanceof Error ? err.message : 'Could not save character.')
      throw err instanceof Error ? err : new Error('Could not save character.')
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

    const affectedscenes = campaign.scenes.filter((scene) => hasCharacterAppearedInscene(scene, characterToDelete))
    const confirmed = await confirm({
      title: `Delete ${characterToDelete.name}?`,
      message: `Delete ${characterToDelete.name} from this campaign?`,
      warning: affectedscenes.length > 0
        ? `This character appears in ${affectedscenes.length} scene${affectedscenes.length === 1 ? '' : 's'}. Deleting the character will also permanently delete those scene${affectedscenes.length === 1 ? '' : 's'}.`
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
      const nextRelationshipGraph = relationshipGraph
        ? {
          ...relationshipGraph,
          entries: relationshipGraph.entries.filter(
            (entry) => entry.fromCharacterId !== characterId && entry.toCharacterId !== characterId,
          ),
        }
        : null
      const removedsceneIds = new Set(affectedscenes.map((scene) => scene.id))
      if (nextRelationshipGraph) {
        await handleSaveRelationships(nextRelationshipGraph)
      }
      if (removedsceneIds.size > 0) {
        updateCampaign((prev) => ({
          ...prev,
          scenes: prev.scenes.filter((scene) => !removedsceneIds.has(scene.id)),
        }))
      }
      setCharacters(nextCharacters)
      setActiveCharacterId(nextCharacters[0]?.id ?? null)
      setComposerCharacterId((prev) => prev === characterId ? null : prev)
      if (removedsceneIds.size > 0) {
        const survivingscenes = campaign.scenes.filter((scene) => !removedsceneIds.has(scene.id))
        const nextSceneId = survivingscenes[0]?.id ?? null
        setActiveSceneId((prev) => prev && !removedsceneIds.has(prev) ? prev : nextSceneId)
        setSelectedSceneId((prev) => prev && !removedsceneIds.has(prev) ? prev : nextSceneId)
      }
      setCharactersStatusKind('success')
      setCharactersStatusMessage(
        removedsceneIds.size > 0
          ? `Character deleted from this campaign along with ${removedsceneIds.size} affected scene${removedsceneIds.size === 1 ? '' : 's'}.`
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
   * Copy an app character into the active campaign as a new campaign-scoped character.
   * Generates a unique ID, creates a CharacterProfile from the template, and persists it.
   *
   * @param appCharacter - The pre-authored app character to copy.
   */
  async function handleUseAppCharacter(appCharacter: typeof appCharacters[0], controlledBy?: 'ai' | 'user'): Promise<void> {
    if (!campaignPath) {
      console.warn('[Aethra] No active campaign; cannot copy character')
      return
    }

    try {
      const { createCharacterFromAppTemplate } = await import('./utils/appContentUtils')
      const newCharProfile = createCharacterFromAppTemplate(appCharacter)

      // Generate ID and folder name
      const characterId = `char-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const folderName = appCharacter.name.toLowerCase().replace(/\s+/g, '-')

      // Create full CharacterProfile
      const character: CharacterProfile = {
        id: characterId,
        folderName: folderName,
        ...newCharProfile,
        controlledBy: controlledBy ?? newCharProfile.controlledBy,
      }

      // Save to campaign using existing handler
      const savedCharacter = await handleSaveCharacter(character)
      setCharactersStatusKind('success')
      setCharactersStatusMessage(`Added ${savedCharacter.name} to Campaign.`)
    } catch (error) {
      console.error('[Aethra] Failed to copy app character:', error)
      setCharactersStatusKind('error')
      setCharactersStatusMessage('Failed to copy character.')
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
  async function handleSaveReusableCharacter(
    character: ReusableCharacter,
    relationshipBundle?: ReusableCharacterRelationshipBundle,
    updateExistingGlobalCharacters: boolean = false,
    syncRelatedGlobalCharacters: boolean = true,
    successMessage?: string,
  ): Promise<void> {
    setIsCharacterLibraryBusy(true)

    try {
      const globalIdMap = new Map<string, string>()
      if (relationshipBundle) {
        for (const bundledCharacter of relationshipBundle.characters) {
          globalIdMap.set(
            bundledCharacter.id,
            updateExistingGlobalCharacters
              ? (bundledCharacter.reusableCharacterId ?? bundledCharacter.id)
              : uid(),
          )
        }
      }

      const charactersToSave = relationshipBundle && syncRelatedGlobalCharacters
        ? relationshipBundle.characters.map((bundledCharacter) => {
          const savedGlobalId = globalIdMap.get(bundledCharacter.id) ?? uid()
          const remappedBundle: ReusableCharacterRelationshipBundle = {
            rootCharacterId: savedGlobalId,
            characters: relationshipBundle.characters.map((candidate) => ({
              ...candidate,
              id: globalIdMap.get(candidate.id) ?? candidate.id,
              reusableCharacterId: undefined,
            })),
            entries: relationshipBundle.entries.map((entry) => ({
              ...entry,
              fromCharacterId: globalIdMap.get(entry.fromCharacterId) ?? entry.fromCharacterId,
              toCharacterId: globalIdMap.get(entry.toCharacterId) ?? entry.toCharacterId,
            })),
          }

          return {
            ...bundledCharacter,
            id: savedGlobalId,
            reusableCharacterId: undefined,
            relationshipBundle: remappedBundle,
          }
        })
        : [{
          ...character,
          id: updateExistingGlobalCharacters && character.reusableCharacterId ? character.reusableCharacterId : character.id,
          reusableCharacterId: undefined,
          relationshipBundle,
        }]

      const savedCharacters = await Promise.all(
        charactersToSave.map((candidate) => window.api.saveReusableCharacter(candidate)),
      )
      setReusableCharacters((prev) =>
        [...savedCharacters, ...prev.filter((candidate) => !savedCharacters.some((saved) => saved.id === candidate.id))]
          .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
      )
      setCharacterLibraryStatusKind('success')
      setCharacterLibraryStatusMessage(
        successMessage ?? (
          savedCharacters.length === 1
            ? `Saved ${savedCharacters[0]?.name ?? character.name}.`
            : `Saved ${savedCharacters.length} global characters.`
        ),
      )
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
      const nextReusableCharacters = restoreCharacterAvatarsFromLibrary(
        await window.api.listReusableCharacters(),
        reusableAvatars,
      )
      setReusableCharacters(nextReusableCharacters)
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
  async function importReusableCharacterToCampaign(
    reusableCharacter: ReusableCharacter,
    includeRelationships: boolean = true,
  ): Promise<CharacterProfile[]> {
    if (!campaignPath || !campaign) {
      throw new Error('Open a campaign before importing characters.')
    }

    const charactersToImport = new Map<string, ReusableCharacterBundleCharacter>()
    const relationshipEntries: RelationshipEntry[] = []
    const queued = new Set<string>()

    function addReusableCharacterWithBundle(character: ReusableCharacter): void {
      if (queued.has(character.id)) {
        return
      }

      queued.add(character.id)
      charactersToImport.set(character.id, toReusableBundleCharacter(character))

      const bundle = includeRelationships ? character.relationshipBundle : undefined
      if (!bundle) {
        return
      }

      for (const bundledCharacter of bundle.characters) {
        charactersToImport.set(bundledCharacter.id, toReusableBundleCharacter(bundledCharacter))
      }

      relationshipEntries.push(...bundle.entries)
    }

    addReusableCharacterWithBundle(reusableCharacter)

    const idMap = new Map<string, string>()
    const importedCharacters: CharacterProfile[] = []

    for (const bundledCharacter of charactersToImport.values()) {
      const now = Date.now()
      const savedCharacter = await window.api.saveCharacter(campaignPath, {
        ...bundledCharacter,
        id: uid(),
        folderName: '',
        reusableCharacterId: bundledCharacter.id,
        createdAt: now,
        updatedAt: now,
      })
      idMap.set(bundledCharacter.id, savedCharacter.id)
      importedCharacters.push(savedCharacter)
    }

    if (importedCharacters.length > 0) {
      setCharacters((prev) =>
        [...importedCharacters, ...prev.filter((candidate) => !importedCharacters.some((imported) => imported.id === candidate.id))]
          .sort((first, second) => second.updatedAt - first.updatedAt),
      )
      updateCampaign((prev) => importedCharacters.reduce(
        (nextCampaign, importedCharacter) => disableCharacterInExistingscenes(nextCampaign, importedCharacter.id),
        prev,
      ))
    }

    const nextRelationshipEntries = relationshipEntries
      .map((entry) => {
        const fromCharacterId = idMap.get(entry.fromCharacterId)
        const toCharacterId = idMap.get(entry.toCharacterId)
        if (!fromCharacterId || !toCharacterId) {
          return null
        }

        return {
          ...entry,
          fromCharacterId,
          toCharacterId,
        }
      })
      .filter((entry): entry is RelationshipEntry => entry !== null)

    if (nextRelationshipEntries.length > 0) {
      const existingEntries = relationshipGraph?.entries ?? []
      const dedupedExistingEntries = existingEntries.filter((entry) =>
        !nextRelationshipEntries.some((candidate) =>
          candidate.fromCharacterId === entry.fromCharacterId && candidate.toCharacterId === entry.toCharacterId,
        ),
      )
      const nextGraph: RelationshipGraph = {
        campaignId: campaign.id,
        entries: [...dedupedExistingEntries, ...nextRelationshipEntries],
        lastRefreshedAt: relationshipGraph?.lastRefreshedAt ?? null,
        narrativeSummary: relationshipGraph?.narrativeSummary ?? null,
      }
      await handleSaveRelationships(nextGraph)
    }

    return importedCharacters
  }

  /**
   * Import a reusable character into the active campaign as a campaign-scoped character.
   *
   * @param reusableCharacter - Saved reusable character to import.
   */
  async function handleImportReusableCharacter(
    reusableCharacter: ReusableCharacter,
    includeRelationships: boolean = true,
  ): Promise<void> {
    if (!campaignPath) {
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage('Open a campaign before importing characters.')
      return
    }

    setIsCharactersBusy(true)

    try {
      const savedCharacters = await importReusableCharacterToCampaign(reusableCharacter, includeRelationships)
      const rootSavedCharacter = savedCharacters[0]
      if (rootSavedCharacter) {
        setActiveCharacterId(rootSavedCharacter.id)
      }
      setCharacterLibraryStatusKind('success')
      setCharacterLibraryStatusMessage(`Imported ${reusableCharacter.name} into this campaign.`)
    } catch (err) {
      console.error('[Aethra] Could not import reusable character:', err)
      setCharacterLibraryStatusKind('error')
      setCharacterLibraryStatusMessage(err instanceof Error ? err.message : 'Could not import character.')
    } finally {
      setIsCharactersBusy(false)
    }
  }

  /**
   * Create a scene from the selected campaign characters.
   *
   * @param selectedCampaignCharacterIds - Existing campaign characters to keep active.
   */
  async function handleStartNewscene(
    selectedCampaignCharacterIds: string[],
    title: string,
    sceneSetup: string,
    continuitySourceSceneId: string | null,
    openingNotes: string,
  ): Promise<void> {
    if (!campaign) {
      setNewSceneStatusKind('error')
      setNewSceneStatusMessage('Open a campaign before starting a scene.')
      return
    }

    const hasSelectedCampaignPlayer = characters.some((character) =>
      selectedCampaignCharacterIds.includes(character.id) && character.controlledBy === 'user',
    )
    if (!hasSelectedCampaignPlayer) {
      setNewSceneStatusKind('error')
      setNewSceneStatusMessage('Select at least one player character before starting a scene.')
      return
    }
    if (title.trim().length === 0) {
      setNewSceneStatusKind('error')
      setNewSceneStatusMessage('Enter a scene name before starting the scene.')
      return
    }
    if (sceneSetup.trim().length === 0) {
      setNewSceneStatusKind('error')
      setNewSceneStatusMessage('Write a scene setup before starting the scene.')
      return
    }

    setIsStartingScene(true)
    setNewSceneStatusKind(null)
    setNewSceneStatusMessage(null)

    try {
      const selectedCharacterIds = new Set([
        ...selectedCampaignCharacterIds,
      ])
      const disabledCharacterIds = characters
        .filter((character) => !selectedCharacterIds.has(character.id))
        .map((character) => character.id)

      const now = Date.now()
      const selectedContinuityScene = continuitySourceSceneId
        ? scenes.find((scene) => scene.id === continuitySourceSceneId) ?? null
        : null
      const newScene: Scene = {
        id: uid(),
        title,
        sceneSetup,
        openingNotes,
        continuitySourceSceneId: selectedContinuityScene?.id,
        continuitySummary: selectedContinuityScene?.rollingSummary.trim() ?? '',
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
        scenes: [newScene, ...prev.scenes],
      }))
      setActiveSceneId(newScene.id)
      setSelectedSceneId(newScene.id)
      setIsNewSceneModalOpen(false)
      setComposerFocusRequestKey((prev) => prev + 1)
      setNewSceneStatusKind(null)
      setNewSceneStatusMessage(null)
    } catch (err) {
      console.error('[Aethra] Could not start scene:', err)
      setNewSceneStatusKind('error')
      setNewSceneStatusMessage(err instanceof Error ? err.message : 'Could not start scene.')
    } finally {
      setIsStartingScene(false)
    }
  }

  /**
   * Append one user message, then stream the AI response using the latest
   * active scene state or an explicit scene override.
   *
   * @param options - Message content plus optional scene and speaker overrides.
   */
  async function sendUserMessage(options: {
    content: string
    sceneId?: string
    sceneOverride?: Scene | null
    characterId?: string
    characterName?: string
    clearComposer?: boolean
    forceRecentWindowOnly?: boolean
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
    const sceneId = options.sceneId ?? ensureActiveScene()
    if (!sceneId) {
      return
    }
    const targetScene = options.sceneOverride
      ?? currentCampaign.scenes.find((scene) => scene.id === sceneId)
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
    const sceneForPrompt: Scene = targetScene ?? {
      id: sceneId,
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

    upsertMessage(sceneId, userMessage)
    if (options.clearComposer !== false) {
      setInputValue('')
    }
    isStreamingRef.current = true
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
    upsertMessage(sceneId, assistantMessage)

    let latestSceneForPrompt = sceneForPrompt

    try {
      const summaryReadyScene = options.sceneOverride
        ? sceneForPrompt
        : await catchUpRollingSummaryBeforeSend(sceneId)
      latestSceneForPrompt = summaryReadyScene ?? sceneForPrompt

      // Generate relationship narrative alongside the summary (catchUpRollingSummaryBeforeSend already rebuilt the summary)
      if (
        appSettingsRef.current.enableRollingSummaries
        && appSettingsRef.current.enableRollingRelationshipSummaries
        && latestSceneForPrompt
        && campaign
        && campaignPath
      ) {
        try {
          const sceneCharacters = getEnabledSceneCharacters(latestSceneForPrompt, characters)
          const relationshipNarrative = await window.api.generateRelationshipNarrative(
            campaignPath,
            campaign.id,
            sceneCharacters,
            [latestSceneForPrompt],
          )
          // Update scene with relationship narrative
          updateCampaign((prev) => ({
            ...prev,
            scenes: prev.scenes.map((scene) =>
              scene.id === sceneId
                ? {
                  ...scene,
                  relationshipNarrativeSummary: relationshipNarrative,
                  updatedAt: Date.now(),
                }
                : scene,
            ),
          }))
        } catch (err) {
          console.error('[Aethra] Could not generate relationship narrative before sending:', err)
        }
      }
    } catch (err) {
      console.error('[Aethra] Could not prepare AI request before streaming:', err)
      updateCampaign((prev) => ({
        ...prev,
        scenes: prev.scenes.map((scene) => {
          if (scene.id !== sceneId) {
            return scene
          }

          return {
            ...scene,
            messages: scene.messages.map((message) => (
              message.id === assistantMessage.id
                ? {
                  ...message,
                  content: `${TRANSIENT_ERROR_MARKER} Could not prepare the AI request. Please try again.`,
                }
                : message
            )),
            updatedAt: Date.now(),
          }
        }),
      }))
      isStreamingRef.current = false
      setIsStreaming(false)
      return
    }

    // Accumulate streamed text outside React state to avoid excessive re-renders,
    // then push the full string on each chunk.
    let accumulated = ''
    let pendingAnimationFrameId: number | null = null
    let revealTimeoutId: number | null = null
    let canRenderAssistantText = false
    let streamFinished = false
    let requestScene = latestSceneForPrompt
    let baseHistorySnapshot = buildRequestMessages(
      currentCampaign,
      enabledSceneCharacters,
      appSettingsRef.current,
      requestScene,
      [userMessage],
      undefined,
      relationshipGraph,
      options.forceRecentWindowOnly === true,
    )
    const playerControlledNames = new Set(
      enabledSceneCharacters
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

      syncStreamedAssistantMessages(sceneId, assistantIds, segments, assistantTimestamp)
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
        syncStreamedAssistantMessages(sceneId, assistantIds, [{ content: '' }], assistantTimestamp)
        streamAssistantAttempt(attemptNumber + 1)
        return
      }

      isStreamingRef.current = false
      setIsStreaming(false)
      scheduleRollingSummary(sceneId)
    }

    /**
     * Open the assistant-text reveal gate immediately or after the remaining
     * minimum typing-indicator delay has elapsed.
     *
     * @param attemptNumber - 1-based attempt counter for malformed replies.
     */
    function ensureAssistantReveal(attemptNumber: number): void {
      const shouldRenderDuringStream = appSettingsRef.current.assistantResponseDisplayMode === 'stream'

      if (canRenderAssistantText) {
        if (streamFinished) {
          finishAssistantAttempt(attemptNumber)
        }
        return
      }

      const remainingDelay = getAssistantRevealDelayRemaining()
      if (remainingDelay <= 0) {
        canRenderAssistantText = true
        if (shouldRenderDuringStream && accumulated.length > 0) {
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
        if (shouldRenderDuringStream && accumulated.length > 0) {
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
      if (!currentCampaign || !campaignPath || !sceneId) return

      accumulated = ''
      streamFinished = false
      const historySnapshot = attemptNumber === 1
        ? baseHistorySnapshot
        : buildRequestMessages(
          currentCampaign,
          enabledSceneCharacters,
          appSettingsRef.current,
          requestScene,
          [userMessage],
          [{
            role: 'user',
            content: 'Your previous reply was invalid. Retry and output only lines beginning with [Name]. Every line must start with [Scene] or the exact name of an AI-controlled character. Do not write any content for player-controlled characters.',
          }],
          relationshipGraph,
          options.forceRecentWindowOnly === true,
        )

      streamCompletion(
        historySnapshot,
        /* onToken */ (chunk) => {
          accumulated += chunk
          ensureAssistantReveal(attemptNumber)
          if (canRenderAssistantText && appSettingsRef.current.assistantResponseDisplayMode === 'stream') {
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
            scenes: prev.scenes.map((scene) => {
              if (scene.id !== sceneId) {
                return scene
              }

              return {
                ...scene,
                messages: [
                  ...scene.messages.filter((message) => !assistantIds.includes(message.id)),
                  {
                    ...assistantMessage,
                    content: `${TRANSIENT_ERROR_MARKER} Could not reach the selected AI server. Check that it is running and the server address is correct.`,
                  },
                ],
                updatedAt: Date.now(),
              }
            }),
          }))
          isStreamingRef.current = false
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
   * selected message after forcing the scene summary to rebuild.
   *
   * @param messageId - User message that should become the new branch point.
   */
  async function handleReplayFromMessage(messageId: string): Promise<void> {
    if (!activeScene || isStreaming) {
      return
    }

    const messageIndex = activeScene.messages.findIndex((candidate) => candidate.id === messageId)
    if (messageIndex === -1) {
      return
    }

    const message = activeScene.messages[messageIndex]
    if (message.role !== 'user') {
      return
    }

    const confirmed = await confirm({
      title: 'Replay From This Message',
      message: 'This will delete this message and every message after it, rebuild the scene summary, and resend this message using the current model settings.',
      warning: 'This permanently replaces the later transcript branch in the current chat.',
      confirmLabel: 'Replay Message',
      cancelLabel: 'Keep Chat',
    })

    if (!confirmed) {
      return
    }

    clearSummaryTimer(activeScene.id)
    summaryRerunRef.current.delete(activeScene.id)
    summaryDirtyScenesRef.current.add(activeScene.id)

    const nextscene: Scene = {
      ...activeScene,
      messages: activeScene.messages.slice(0, messageIndex),
      rollingSummary: '',
      summarizedMessageCount: 0,
      updatedAt: Date.now(),
    }

    updateCampaign((prev) => ({
      ...prev,
      scenes: prev.scenes.map((scene) => (
        scene.id === activeScene.id
          ? nextscene
          : scene
      )),
    }))

    await sendUserMessage({
      content: message.content,
      sceneId: activeScene.id,
      sceneOverride: nextscene,
      characterId: message.characterId,
      characterName: message.characterName,
      forceRecentWindowOnly: true,
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
          onExitCampaign={() => {
            void handleExitCampaign()
          }}
          canExitCampaign={!isStreaming && !isCampaignBusy && !isStartingScene}
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
          {/* Left column: scene navigator */}
          <Sidebar
            campaignName={campaign.name}
            activeModelName={activeModel?.name ?? null}
            usedTokens={usedTokens}
            usedTokensIsExact={usedTokensIsExact}
            totalContextTokens={totalContextTokens}
            remainingTokens={remainingTokens}
            remainingTokensIsExact={remainingTokensIsExact}
            scenes={scenes}
            activeSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
            onDeleteScene={handleDeleteScene}
            onNewScene={handleNewScene}
            isBusy={isStreaming || isStartingScene}
          />

          {/* Centre column: chat feed + composer */}
          <main className="panel panel--chat">
            <ChatArea
              activeSceneId={activeSceneId}
              messages={messages}
              characters={characters}
              textSize={appSettings.chatTextSize}
              bubbleFormattingMode={appSettings.chatBubbleFormattingMode}
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
                characters={enabledSceneCharacters}
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
                    Load a model to begin chatting in this scene.
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

          {/* Right column: scene details */}
          <DetailsPanel
            activeScene={activeScene}
            activeSceneSummary={activeScene?.rollingSummary ?? null}
            activeCharacters={enabledSceneCharacters}
            totalCharacterCount={characters.length}
            onOpenSummary={handleOpenSummaryModal}
            onOpenSceneCharacters={handleOpenSceneCharacters}
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
          chatBubbleFormattingMode={appSettings.chatBubbleFormattingMode}
          assistantResponseDisplayMode={appSettings.assistantResponseDisplayMode}
          showChatMarkup={appSettings.showChatMarkup}
          assistantResponseRevealDelayMs={appSettings.assistantResponseRevealDelayMs}
          campaignBasePrompt={appSettings.campaignBasePrompt}
          formattingRules={appSettings.formattingRules}
          rollingSummarySystemPrompt={appSettings.rollingSummarySystemPrompt}
          relationshipSummarySystemPrompt={appSettings.relationshipSummarySystemPrompt}
          enableRollingSummaries={appSettings.enableRollingSummaries}
          enableRollingRelationshipSummaries={appSettings.enableRollingRelationshipSummaries}
          recentMessagesWindow={appSettings.recentMessagesWindow}
          statusMessage={settingsStatusMessage}
          statusKind={settingsStatusKind}
          onClose={handleCloseSettings}
          onServerSelect={(serverId) => {
            void handleServerSelect(serverId)
          }}
          onDeleteLocalModel={(modelSlug) => {
            void handleDeleteLocalModel(modelSlug)
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
          onCancelHuggingFaceModelDownload={(repoId, fileName) => {
            void handleCancelHuggingFaceModelDownload(repoId, fileName)
          }}
          onThemeSelect={(themeId) => {
            void handleThemeSelect(themeId)
          }}
          onChatTextSizeSelect={(textSize) => {
            void handleChatTextSizeSelect(textSize)
          }}
          onChatBubbleFormattingModeSelect={(mode) => {
            void handleChatBubbleFormattingModeSelect(mode)
          }}
          onAssistantResponseDisplayModeSelect={(mode) => {
            void handleAssistantResponseDisplayModeSelect(mode)
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
          onRollingRelationshipSummariesToggle={(enabled) => {
            void handleRollingRelationshipSummariesToggle(enabled)
          }}
          onRecentMessagesWindowChange={(count) => {
            void handleRecentMessagesWindowChange(count)
          }}
          onSavePromptTemplates={handlePromptTemplatesSave}
          onSetStatus={(kind, message) => {
            setSettingsStatusKind(kind)
            setSettingsStatusMessage(message)
          }}
        />
      ) : null}

      {!isCampaignSwitchLoading && isScenesOpen ? (
        <ScenesModal onClose={() => setIsScenesOpen(false)} />
      ) : null}

      {!isCampaignSwitchLoading && isLoreBookOpen ? (
        <LoreBookModal onClose={() => setIsLoreBookOpen(false)} />
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
          isBrowsingModels={isBrowsingModels}
          onClose={handleCloseModelLoader}
          onRefreshModels={() => {
            if (modelLoaderServer) void handleBrowseModelsForServer(modelLoaderServer.id, 'model-loader')
          }}
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
          onSaveReusableCharacter={(
            character,
            relationshipBundle,
            updateExistingGlobalCharacters,
            syncRelatedGlobalCharacters,
            successMessage,
          ) =>
            handleSaveReusableCharacter(
              character,
              relationshipBundle,
              updateExistingGlobalCharacters,
              syncRelatedGlobalCharacters,
              successMessage,
            )}
          onDeleteReusableCharacter={(characterId) => handleDeleteReusableCharacter(characterId)}
          onImportReusableCharacter={(character, includeRelationships) =>
            handleImportReusableCharacter(character, includeRelationships)}
          relationshipGraph={relationshipGraph}
          onSaveRelationships={handleSaveRelationships}
          onDeleteRelationshipPair={handleDeleteRelationshipPair}
          appCharacters={appCharacters}
          appAvatars={appAvatars}
          onUseAppCharacter={handleUseAppCharacter}
        />
      ) : null}
      {!isCampaignSwitchLoading && isNewSceneModalOpen ? (
        <NewSceneModal
          scenes={scenes}
          campaignCharacters={characters}
          statusMessage={newSceneStatusMessage}
          statusKind={newSceneStatusKind}
          isBusy={isStartingScene}
          onClose={handleCloseNewSceneModal}
          onStartScene={(campaignCharacterIds, title, sceneSetup, continuitySourceSceneId, openingNotes) =>
            handleStartNewscene(
              campaignCharacterIds,
              title,
              sceneSetup,
              continuitySourceSceneId,
              openingNotes,
            )}
        />
      ) : null}
      {!isCampaignSwitchLoading && isSceneCharactersOpen ? (
        <SceneCharactersModal
          activeScene={activeScene}
          characters={characters}
          onToggleCharacter={handleToggleSceneCharacter}
          onClose={handleClosesceneCharacters}
        />
      ) : null}
      {!isCampaignSwitchLoading && isSummaryModalOpen ? (
        <SummaryModal
          summary={activeScene?.rollingSummary ?? ''}
          relationshipNarrativeSummary={activeScene?.relationshipNarrativeSummary ?? null}
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
            <p>This will permanently remove the chat bubble from the current scene.</p>
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
      {!isCampaignSwitchLoading && pendingDeleteSceneId ? (
        <ConfirmModal
          title="Delete Chat"
          message="This will permanently remove the selected chat and its full message history."
          confirmLabel="Delete Chat"
          onConfirm={handleConfirmDeletescene}
          onCancel={handleCancelDeletescene}
        />
      ) : null}
      {!isCampaignSwitchLoading && confirmState ? (
        <ConfirmModal {...confirmState} />
      ) : null}
    </div>
  )
}
