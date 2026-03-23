# Character Relationship Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, AI-generated character relationship graph to Aethra — built on demand from session transcripts, stored per campaign, and injected selectively into the AI prompt when both characters in a pair are active.

**Architecture:** Relationships are stored as a flat directed-pair graph in `relationships.json` inside the campaign folder. Three IPC handlers (get/set/refresh) follow the same pattern as existing campaign/character handlers. Prompt injection is an additive change to `buildSystemContext()` in `App.tsx`. Two new UI surfaces: a `RelationshipReviewModal` (post-refresh review before saving) and a Relationships tab in the existing `CharactersModal` (persistent editing).

**Tech Stack:** TypeScript strict, Electron IPC (ipcMain.handle / ipcRenderer.invoke), React 18 hooks, custom CSS variables, OpenAI-compatible fetch for the non-streaming LLM call.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | Add `AffinityLabel`, `RelationshipEntry`, `RelationshipGraph` types |
| `src/types/electron.d.ts` | Modify | Declare `getRelationships`, `saveRelationships`, `refreshRelationships` on `window.api` |
| `electron/preload/index.ts` | Modify | Expose three new IPC channels via contextBridge |
| `electron/main/index.ts` | Modify | Add `relationships:get`, `relationships:set`, `relationships:refresh` handlers + helper functions |
| `src/App.tsx` | Modify | Load graph on campaign open; add `buildSystemContext()` injection; wire DetailsPanel + CharactersModal props; add refresh handler state |
| `src/components/DetailsPanel.tsx` | Modify | Add "Refresh Relationships" button with loading/error state |
| `src/components/RelationshipReviewModal.tsx` | Create | Post-refresh review modal (full graph in state, Save All / Discard) |
| `src/styles/relationship-review-modal.css` | Create | Styles for RelationshipReviewModal |
| `src/components/CharactersModal.tsx` | Modify | Add `relationships` tab with pair list, detail view, immediate-save edit, delete pair |
| `src/styles/characters.css` | Modify | Add styles for Relationships tab within CharactersModal |

---

## Task 1: Add Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add types at the end of the `src/types/index.ts` character section (after `CharacterAvatarCrop`)**

Find the comment `/* ── Chat & sessions ──` and add a new section after `CharacterAvatarCrop` (around line 157):

```typescript
/* ── Relationship graph ───────────────────────────────────────────────── */

/** Broad affinity category for a directed character relationship. */
export type AffinityLabel = 'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied' | 'devoted'

/**
 * A directed relationship from one character's perspective toward another.
 * Mira→Kael and Kael→Mira are separate entries.
 */
export interface RelationshipEntry {
  /** ID of the character whose perspective this entry represents. */
  fromCharacterId: string
  /** ID of the character being related to. */
  toCharacterId: string
  /** Trust level 0 (no trust) to 100 (complete trust). */
  trustScore: number
  /** Broad relationship category. */
  affinityLabel: AffinityLabel
  /** AI-generated prose summary (1–3 sentences). */
  summary: string
  /** User-editable supplement; empty string when unused. */
  manualNotes: string
  /** Unix timestamp (ms) when AI last generated data for this entry. Manual edits do not update this. */
  lastAiRefreshedAt: number
}

/**
 * Campaign-level container for all directed character relationship entries.
 * Persisted to <campaignFolderPath>/relationships.json.
 */
export interface RelationshipGraph {
  /** Campaign.id — written on creation, used for integrity validation on load. */
  campaignId: string
  /** All directed relationship entries for this campaign. */
  entries: RelationshipEntry[]
  /** Unix timestamp (ms) of most recent refresh; null if never refreshed. */
  lastRefreshedAt: number | null
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add RelationshipEntry, RelationshipGraph, AffinityLabel types"
```

---

## Task 2: IPC Contracts (electron.d.ts + preload)

**Files:**
- Modify: `src/types/electron.d.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Add import and declarations to `src/types/electron.d.ts`**

Add `RelationshipGraph, Session, CharacterProfile` to the existing import at the top (these may already be imported — only add what's missing):

```typescript
import type {
  // ... existing imports ...
  RelationshipGraph,
  Session,
  CharacterProfile,
} from './index'
```

Then add the three methods to the `window.api` interface, after `deleteCharacter`:

```typescript
/**
 * Load the relationship graph for a campaign.
 * @param campaignPath - Absolute path to the campaign folder.
 * @param campaignId - Campaign.id for integrity validation.
 * @returns Promise resolving to the stored graph, or null if none exists.
 */
getRelationships: (campaignPath: string, campaignId: string) => Promise<RelationshipGraph | null>

/**
 * Persist the relationship graph to disk.
 * @param campaignPath - Absolute path to the campaign folder.
 * @param graph - Full graph to write.
 */
saveRelationships: (campaignPath: string, graph: RelationshipGraph) => Promise<void>

/**
 * Run an LLM analysis of campaign transcripts and return the merged relationship graph.
 * Does NOT write to disk — caller saves after user review.
 * @param campaignPath - Absolute path to the campaign folder.
 * @param campaignId - Campaign.id written into the returned graph.
 * @param characters - Current campaign character roster.
 * @param sessions - All campaign sessions (oldest first).
 * @returns Promise resolving to the merged graph ready for review.
 */
refreshRelationships: (
  campaignPath: string,
  campaignId: string,
  characters: CharacterProfile[],
  sessions: Session[],
) => Promise<RelationshipGraph>
```

- [ ] **Step 2: Expose channels in `electron/preload/index.ts`**

Add `RelationshipGraph, Session, CharacterProfile` to the existing import at the top of the file if not already present. Then add these three methods inside the `contextBridge.exposeInMainWorld('api', { ... })` block, after the `deleteCharacter` method:

```typescript
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
  sessions: Session[],
): Promise<RelationshipGraph> {
  return ipcRenderer.invoke('relationships:refresh', campaignPath, campaignId, characters, sessions) as Promise<RelationshipGraph>
},
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/electron.d.ts electron/preload/index.ts
git commit -m "feat: expose relationships IPC channels in preload bridge"
```

---

## Task 3: Main Process Handlers

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add `RelationshipGraph, RelationshipEntry, AffinityLabel, CharacterProfile, Session` to the type import at the top of `electron/main/index.ts`**

The existing import block starts at line 23. Add the missing types:

```typescript
import type {
  // ... existing types ...
  AffinityLabel,
  RelationshipEntry,
  RelationshipGraph,
} from '../../src/types'
```

(`CharacterProfile` and `Session` are already imported.)

- [ ] **Step 2: Add helper functions before the `ipcMain.handle` registration block**

Find the area just before `ipcMain.handle('settings:get', ...)` (around line 3993) and add these helpers:

```typescript
/* ── Relationship graph helpers ────────────────────────────────────────── */

/**
 * Resolve the absolute path to a campaign's relationships.json file.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @returns Absolute path to relationships.json.
 */
function relationshipsFilePath(campaignPath: string): string {
  return join(campaignPath, 'relationships.json')
}

/**
 * Load the relationship graph from disk, returning null when absent or
 * when the stored campaignId does not match the expected value.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @param campaignId - Expected campaign ID for integrity check.
 * @returns Parsed graph or null.
 */
function loadRelationshipGraph(campaignPath: string, campaignId: string): RelationshipGraph | null {
  const filePath = relationshipsFilePath(campaignPath)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RelationshipGraph
    if (raw.campaignId !== campaignId) {
      console.warn('[Aethra] relationships.json campaignId mismatch — ignoring stored graph')
      return null
    }
    return raw
  } catch {
    return null
  }
}

/**
 * Write a relationship graph to disk.
 *
 * @param campaignPath - Absolute path to the campaign folder.
 * @param graph - Graph to persist.
 */
function saveRelationshipGraph(campaignPath: string, graph: RelationshipGraph): void {
  writeFileSync(relationshipsFilePath(campaignPath), JSON.stringify(graph, null, 2), 'utf-8')
}

/** Valid affinity label set for LLM response validation. */
const VALID_AFFINITY_LABELS = new Set<AffinityLabel>([
  'hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted',
])

/**
 * Assemble all session transcripts (oldest first) into a single string
 * for the relationship refresh prompt. Prepends rolling summaries where present.
 *
 * @param sessions - All campaign sessions.
 * @returns Formatted transcript string.
 */
function buildRelationshipTranscript(sessions: Session[]): string {
  return sessions
    .map((session) => {
      const lines: string[] = [`--- Session: ${session.title || 'Untitled'} ---`]
      if (session.rollingSummary.trim().length > 0) {
        lines.push(`Summary of earlier events:\n${session.rollingSummary.trim()}`)
      }
      session.messages.forEach((message) => {
        if (message.role === 'assistant' || message.role === 'user') {
          const speaker = message.characterName?.trim() ?? (message.role === 'user' ? 'Player' : 'Assistant')
          lines.push(`[${speaker}] ${message.content}`)
        }
      })
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Call the active LLM server with a non-streaming chat completion request
 * for relationship analysis. Returns the raw response text.
 *
 * @param messages - Chat messages to send.
 * @param settings - App settings containing active server/model config.
 * @returns Raw response content string.
 */
async function fetchRelationshipCompletion(
  messages: ChatMessage[],
  settings: ReturnType<typeof loadSettings>,
): Promise<string> {
  const server = settings.servers.find((s) => s.id === settings.activeServerId)
  if (!server) {
    throw new Error('No active server configured. Select a server in Settings before refreshing relationships.')
  }
  const modelSlug = settings.activeModelSlug
  if (!modelSlug) {
    throw new Error('No active model configured. Select a model in Settings before refreshing relationships.')
  }

  const endpoint = `${server.baseUrl}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${server.apiKey}`,
    },
    body: JSON.stringify({
      model: modelSlug,
      messages,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}: ${await response.text()}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Model returned an empty response.')
  }
  return content.trim()
}

/**
 * Parse and validate the raw JSON array returned by the LLM for relationship entries.
 * Invalid or unknown entries are silently skipped; bad field values are clamped/defaulted.
 *
 * @param raw - Raw response text from the LLM.
 * @param validCharacterIds - Set of known character IDs to validate against.
 * @returns Validated array of partial entries (without manualNotes or lastAiRefreshedAt).
 */
function parseRelationshipEntries(
  raw: string,
  validCharacterIds: Set<string>,
): Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>> {
  // Strip optional markdown code fences the model may wrap around the JSON
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error('Refresh failed — model returned invalid data. Try again.')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Refresh failed — model returned invalid data. Try again.')
  }
  const validated: Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>> = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const fromId = typeof entry.fromCharacterId === 'string' ? entry.fromCharacterId : ''
    const toId = typeof entry.toCharacterId === 'string' ? entry.toCharacterId : ''
    if (!fromId || !toId || !validCharacterIds.has(fromId) || !validCharacterIds.has(toId)) continue
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : ''
    if (!summary) continue
    const rawScore = typeof entry.trustScore === 'number' ? entry.trustScore : 50
    const trustScore = Math.max(0, Math.min(100, Math.round(rawScore)))
    const rawLabel = typeof entry.affinityLabel === 'string' ? entry.affinityLabel : ''
    const affinityLabel: AffinityLabel = VALID_AFFINITY_LABELS.has(rawLabel as AffinityLabel)
      ? (rawLabel as AffinityLabel)
      : 'neutral'
    validated.push({ fromCharacterId: fromId, toCharacterId: toId, trustScore, affinityLabel, summary })
  }
  return validated
}

/**
 * Merge validated LLM entries into the existing relationship graph.
 * Preserves manualNotes for existing entries; adds new entries for new pairs.
 * Orphaned entries (deleted characters) are retained unchanged.
 *
 * @param existing - Current persisted graph (or null when no graph exists yet).
 * @param campaignId - Campaign ID for the returned graph.
 * @param validated - Validated entries from the LLM response.
 * @returns Updated graph (not yet saved to disk).
 */
function mergeRelationshipEntries(
  existing: RelationshipGraph | null,
  campaignId: string,
  validated: Array<Omit<RelationshipEntry, 'manualNotes' | 'lastAiRefreshedAt'>>,
): RelationshipGraph {
  const now = Date.now()
  const existingEntries: RelationshipEntry[] = existing?.entries ?? []

  const updated: RelationshipEntry[] = existingEntries.map((entry) => {
    const match = validated.find(
      (v) => v.fromCharacterId === entry.fromCharacterId && v.toCharacterId === entry.toCharacterId,
    )
    if (!match) return entry
    return {
      ...entry,
      trustScore: match.trustScore,
      affinityLabel: match.affinityLabel,
      summary: match.summary,
      lastAiRefreshedAt: now,
    }
  })

  // Add new pairs not already in the graph
  for (const v of validated) {
    const exists = existingEntries.some(
      (e) => e.fromCharacterId === v.fromCharacterId && e.toCharacterId === v.toCharacterId,
    )
    if (!exists) {
      updated.push({ ...v, manualNotes: '', lastAiRefreshedAt: now })
    }
  }

  return { campaignId, entries: updated, lastRefreshedAt: now }
}
```

- [ ] **Step 3: Add the three IPC handlers**

Add these handlers after `ipcMain.handle('characters:delete', ...)` (around line 4284):

```typescript
/**
 * Relationships: load the campaign relationship graph from disk.
 */
ipcMain.handle('relationships:get', (_event, campaignPath: string, campaignId: string): RelationshipGraph | null => {
  return loadRelationshipGraph(campaignPath, campaignId)
})

/**
 * Relationships: persist the campaign relationship graph to disk.
 */
ipcMain.handle('relationships:set', (_event, campaignPath: string, graph: RelationshipGraph): void => {
  saveRelationshipGraph(campaignPath, graph)
})

/**
 * Relationships: run LLM analysis and return merged graph without saving.
 */
ipcMain.handle(
  'relationships:refresh',
  async (
    _event,
    campaignPath: string,
    campaignId: string,
    characters: CharacterProfile[],
    sessions: Session[],
  ): Promise<RelationshipGraph> => {
    const settings = loadSettings()
    const validIds = new Set(characters.map((c) => c.id))
    const transcript = buildRelationshipTranscript(sessions)

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You analyse roleplay transcripts and extract character relationship states.

For each directed character pair (A→B), output a JSON array of relationship entries.
Each entry must have:
- fromCharacterId (string, exact character ID from the provided character list)
- toCharacterId (string, exact character ID from the provided character list)
- trustScore (integer 0–100)
- affinityLabel (one of: hostile, wary, neutral, friendly, allied, devoted)
- summary (1–3 sentences: how A currently perceives or feels toward B, grounded in transcript events only)

Base all values strictly on evidence in the transcripts.
Do not invent events or relationships not evidenced in the transcripts.
Output only a valid JSON array. No explanation, no markdown, no wrapper text.`,
      },
      {
        role: 'user',
        content: `Characters:\n${characters.map((c) => `${c.id}: ${c.name}`).join('\n')}\n\nTranscripts (all sessions, oldest first):\n${transcript}\n\nGenerate relationship entries for all directed pairs where both characters appear in the transcripts.`,
      },
    ]

    const raw = await fetchRelationshipCompletion(messages, settings)
    const validated = parseRelationshipEntries(raw, validIds)
    const existing = loadRelationshipGraph(campaignPath, campaignId)
    return mergeRelationshipEntries(existing, campaignId, validated)
  },
)
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat: add relationships IPC handlers to main process"
```

---

## Task 4: Prompt Injection

**Files:**
- Modify: `src/App.tsx` (functions `buildSystemContext` at line 229 and `buildRequestMessages` at line 442)

- [ ] **Step 1: Update `buildSystemContext()` signature to accept the relationship graph**

Add `RelationshipGraph` to the imports at the top of `App.tsx`:

```typescript
import type {
  // ... existing imports ...
  RelationshipGraph,
} from './types'
```

Then update `buildSystemContext()` to add the new parameter and inject relationships. The function currently ends its parameter list with `sceneSummary: string | null`. Change:

```typescript
function buildSystemContext(
  campaign: Campaign,
  characters: CharacterProfile[],
  session: Session,
  campaignBasePrompt: string,
  formattingRules: string,
  customSystemPrompt: string,
  sceneSummary: string | null,
): ChatMessage[] {
```

to:

```typescript
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
```

- [ ] **Step 2: Add relationship injection helper and update the characters block**

Add a helper function just above `buildSystemContext()`:

```typescript
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
```

Then inside `buildSystemContext()`, **before** the `characters.map(...)` call, add two lookup structures (hoist them above the map to avoid recomputing per character):

```typescript
// Precompute for relationship injection — hoist outside the map loop
const activeCharacterIds = new Set(characters.map((c) => c.id))
const characterNamesById = new Map(characters.map((c) => [c.id, c.name]))
```

Then find the `characters.map(...)` block (around line 295) and locate `return sections.join('\n')` at the end of each character's section. Replace it with:

```typescript
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
```

- [ ] **Step 3: Update both `buildSystemContext()` call sites**

**Call site 1** — `buildRequestMessages()` at ~line 442. Change:

```typescript
...buildSystemContext(
  campaign,
  characters,
  session,
  settings.campaignBasePrompt,
  settings.formattingRules,
  settings.systemPrompt,
  getPromptSceneSummary(session, settings.enableRollingSummaries),
),
```

to:

```typescript
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
```

And update `buildRequestMessages()` signature to accept `relationshipGraph`:

```typescript
function buildRequestMessages(
  campaign: Campaign,
  characters: CharacterProfile[],
  settings: AppSettings,
  session: Session,
  pendingMessages: Message[] = [],
  trailingInstructions: ChatMessage[] = [],
  relationshipGraph: RelationshipGraph | null = null,
): ChatMessage[] {
```

**Call site 2** — find the `useMemo` that calls `buildSystemContext()` for the debug/token-count path. It will look something like:

```typescript
const systemContext = useMemo(() => buildSystemContext(
  campaign,
  enabledSessionCharacters,
  activeSession,
  ...
), [...])
```

Add `relationshipGraph` as the last argument there too.

- [ ] **Step 4: Update every place `buildRequestMessages()` is called to pass `relationshipGraph`**

Search for all calls to `buildRequestMessages(` in `App.tsx` and add `relationshipGraph` as the last argument to each. There will be 2–4 call sites.

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: inject relationship graph inline into character prompt entries"
```

---

## Task 5: App.tsx State Wiring

**Files:**
- Modify: `src/App.tsx`

This task adds the `relationshipGraph` state, loads it on campaign open, and wires up the refresh handler + props for `DetailsPanel` and `CharactersModal`.

- [ ] **Step 1: Add relationship graph state near the other campaign state**

Find the `useState` block for campaign state (around line 1200). Add:

```typescript
/** Campaign-level character relationship graph; null until loaded. */
const [relationshipGraph, setRelationshipGraph] = useState<RelationshipGraph | null>(null)

/** True while a relationship refresh LLM call is in flight. */
const [isRefreshingRelationships, setIsRefreshingRelationships] = useState(false)

/** Inline error shown on the DetailsPanel refresh button. */
const [refreshRelationshipsError, setRefreshRelationshipsError] = useState<string | null>(null)

/** Merged graph returned by the LLM, pending user review in RelationshipReviewModal. */
const [pendingRelationshipGraph, setPendingRelationshipGraph] = useState<RelationshipGraph | null>(null)
```

- [ ] **Step 2: Load the relationship graph when a campaign opens**

Find the `useEffect` that loads characters when `campaignPath` changes (around line 1401). After `setCharacters(nextCharacters)` or in a separate `useEffect` that also depends on `campaignPath` and `campaign?.id`, add:

```typescript
// Load relationship graph for the newly opened campaign
if (campaignPath && campaign?.id) {
  void window.api.getRelationships(campaignPath, campaign.id).then((graph) => {
    setRelationshipGraph(graph)
  }).catch((err: unknown) => {
    console.error('[Aethra] Could not load relationship graph:', err)
  })
} else {
  setRelationshipGraph(null)
}
```

Also reset the graph when the campaign closes (find where `setCharacters([])` is called on campaign close and add `setRelationshipGraph(null)` next to it).

- [ ] **Step 3: Add `refreshStartedAt` ref to track when the refresh was dispatched**

Near the other refs in `App.tsx`, add:

```typescript
/** Timestamp recorded the moment a relationship refresh call is dispatched. Used to badge "updated" entries in the review modal. */
const refreshStartedAtRef = useRef<number>(0)
```

Also add this to the state block (we need to pass it as a prop to the modal):

```typescript
/** Timestamp recorded when the most recent refresh call was dispatched. */
const [refreshStartedAt, setRefreshStartedAt] = useState<number>(0)
```

- [ ] **Step 4: Implement the refresh handler**

Add this function near the other campaign action handlers:

```typescript
/**
 * Trigger an LLM relationship refresh for the active campaign.
 * On success, opens the RelationshipReviewModal with the merged graph.
 */
async function handleRefreshRelationships(): Promise<void> {
  if (!campaign || !campaignPath || characters.length < 2 || isRefreshingRelationships) return
  setIsRefreshingRelationships(true)
  setRefreshRelationshipsError(null)
  // Record the dispatch timestamp BEFORE the async call so entries updated
  // in this specific refresh can be identified in the review modal.
  const startedAt = Date.now()
  refreshStartedAtRef.current = startedAt
  setRefreshStartedAt(startedAt)
  try {
    const merged = await window.api.refreshRelationships(
      campaignPath,
      campaign.id,
      characters,
      sessions,
    )
    setPendingRelationshipGraph(merged)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Refresh failed. Try again.'
    setRefreshRelationshipsError(message)
  } finally {
    setIsRefreshingRelationships(false)
  }
}
```

- [ ] **Step 5: Implement the save handler (used by both RelationshipReviewModal and CharactersModal)**

```typescript
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
```

- [ ] **Step 6: Implement the delete-pair handler (with confirmation)**

The spec requires a confirmation prompt before deletion. Use the existing `useConfirm` hook already used throughout `App.tsx`:

```typescript
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
```

- [ ] **Step 7: Wire props to DetailsPanel**

Find where `<DetailsPanel` is rendered in the JSX (around line 2600+) and add the new props:

```typescript
<DetailsPanel
  // ... existing props ...
  onRefreshRelationships={() => { void handleRefreshRelationships() }}
  isRefreshingRelationships={isRefreshingRelationships}
  refreshRelationshipsError={refreshRelationshipsError}
/>
```

- [ ] **Step 8: Wire props to CharactersModal**

Find `<CharactersModal` and add:

```typescript
<CharactersModal
  // ... existing props ...
  relationshipGraph={relationshipGraph}
  onSaveRelationships={handleSaveRelationships}
  onDeleteRelationshipPair={handleDeleteRelationshipPair}
/>
```

- [ ] **Step 9: Add RelationshipReviewModal to JSX**

Import the new component:

```typescript
import { RelationshipReviewModal } from './components/RelationshipReviewModal'
```

Add to JSX (near other modals):

```typescript
{pendingRelationshipGraph && (
  <RelationshipReviewModal
    graph={pendingRelationshipGraph}
    characters={characters}
    refreshStartedAt={refreshStartedAt}
    onSave={async (graph) => {
      await handleSaveRelationships(graph)
      setPendingRelationshipGraph(null)
    }}
    onDiscard={() => { setPendingRelationshipGraph(null) }}
  />
)}
```

- [ ] **Step 10: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors (RelationshipReviewModal doesn't exist yet — if TS errors on the import, comment it out temporarily until Task 6 is done).

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire relationship graph state and handlers in App.tsx"
```

---

## Task 6: DetailsPanel Refresh Button

**Files:**
- Modify: `src/components/DetailsPanel.tsx`

- [ ] **Step 1: Update `DetailsPanelProps`**

Add to the interface:

```typescript
/** Called when user triggers a relationship refresh. */
onRefreshRelationships: () => void
/** True while a refresh LLM call is in progress. */
isRefreshingRelationships: boolean
/** Inline error message to show below the button; null when none. */
refreshRelationshipsError: string | null
```

- [ ] **Step 2: Destructure new props in the component function signature**

```typescript
export function DetailsPanel({
  activeSession,
  activeCharacters,
  totalCharacterCount,
  onOpenSessionCharacters,
  onRefreshRelationships,
  isRefreshingRelationships,
  refreshRelationshipsError,
}: DetailsPanelProps) {
```

- [ ] **Step 3: Add the button below the active cast list**

Find where the active cast / characters section is rendered in the JSX. Below it (still inside the same panel section), add:

```tsx
{activeCharacters.length >= 2 && (
  <div className="details-panel__relationships">
    <button
      className="details-panel__refresh-relationships-btn"
      onClick={onRefreshRelationships}
      disabled={isRefreshingRelationships}
      type="button"
    >
      {isRefreshingRelationships ? 'Refreshing…' : 'Refresh Relationships'}
    </button>
    {refreshRelationshipsError && (
      <p className="details-panel__refresh-error">{refreshRelationshipsError}</p>
    )}
  </div>
)}
```

- [ ] **Step 4: Add CSS to `src/styles/details.css`**

Open `src/styles/details.css` and add at the end:

```css
/* ── Relationship refresh ─────────────────────────────────────────────── */

.details-panel__relationships {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--border-color);
}

.details-panel__refresh-relationships-btn {
  width: 100%;
  padding: 6px 10px;
  background: var(--surface-bg-accent);
  color: var(--text-color-on-accent);
  border: none;
  border-radius: var(--border-radius);
  font-size: 0.8rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.details-panel__refresh-relationships-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.details-panel__refresh-relationships-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.details-panel__refresh-error {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/DetailsPanel.tsx src/styles/details.css
git commit -m "feat: add Refresh Relationships button to DetailsPanel"
```

---

## Task 7: RelationshipReviewModal

**Files:**
- Create: `src/components/RelationshipReviewModal.tsx`
- Create: `src/styles/relationship-review-modal.css`

- [ ] **Step 1: Create the CSS file**

Create `src/styles/relationship-review-modal.css`:

```css
/**
 * src/styles/relationship-review-modal.css
 * Styles for the RelationshipReviewModal post-refresh review dialog.
 */

/* ── Pair list (left pane) ───────────────────────────────────────────── */

.rel-review__pair-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rel-review__pair-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--border-radius);
  cursor: pointer;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  color: var(--text-color-primary);
  font-size: 0.85rem;
  transition: background 0.1s;
}

.rel-review__pair-item:hover {
  background: var(--surface-bg-emphasis);
}

.rel-review__pair-item--selected {
  background: var(--surface-bg-selected);
}

.rel-review__pair-item--updated::after {
  content: 'updated';
  font-size: 0.65rem;
  background: var(--surface-bg-accent);
  color: var(--text-color-on-accent);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

/* ── Affinity badge ──────────────────────────────────────────────────── */

.rel-review__affinity-badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-bg-emphasis);
  color: var(--text-color-secondary);
  flex-shrink: 0;
}

.rel-review__affinity-badge--hostile { background: #5a1a1a; color: #f08080; }
.rel-review__affinity-badge--wary    { background: #4a3a10; color: #d4a847; }
.rel-review__affinity-badge--neutral { background: var(--surface-bg-emphasis); color: var(--text-color-secondary); }
.rel-review__affinity-badge--friendly { background: #1a3a4a; color: #70c0d0; }
.rel-review__affinity-badge--allied  { background: #1a3a1a; color: #70c870; }
.rel-review__affinity-badge--devoted { background: #3a1a4a; color: #c080e0; }

/* ── Detail view (right pane) ────────────────────────────────────────── */

.rel-review__detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.rel-review__detail-header {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0;
}

.rel-review__field-label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  margin-bottom: 4px;
}

.rel-review__trust-input {
  width: 80px;
  padding: 4px 8px;
  background: var(--surface-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-color-primary);
  font-size: 0.85rem;
}

.rel-review__affinity-select {
  padding: 4px 8px;
  background: var(--surface-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-color-primary);
  font-size: 0.85rem;
}

.rel-review__summary-text {
  width: 100%;
  min-height: 80px;
  padding: 6px 8px;
  background: var(--surface-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-color-secondary);
  font-size: 0.85rem;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.rel-review__notes-input {
  width: 100%;
  min-height: 60px;
  padding: 6px 8px;
  background: var(--surface-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-color-primary);
  font-size: 0.85rem;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.rel-review__empty-state {
  color: var(--text-color-muted);
  font-size: 0.85rem;
  padding: 20px 0;
  text-align: center;
}

.rel-review__no-selection {
  color: var(--text-color-muted);
  font-size: 0.85rem;
  padding: 20px 0;
}
```

- [ ] **Step 2: Create `src/components/RelationshipReviewModal.tsx`**

```tsx
/**
 * src/components/RelationshipReviewModal.tsx
 * Post-refresh review modal for the character relationship graph.
 *
 * Holds the full merged graph in local state. The user can edit any entry
 * before choosing Save All (persists to disk) or Discard (no changes saved).
 */

import { useState } from 'react'
import { Modal } from './Modal'
import { ModalWorkspaceLayout, ModalFooter } from './ModalLayouts'
import '../styles/relationship-review-modal.css'
import type { AffinityLabel, CharacterProfile, RelationshipEntry, RelationshipGraph } from '../types'

/** Props accepted by RelationshipReviewModal. */
interface RelationshipReviewModalProps {
  /** The merged graph returned by the LLM refresh — held in local state for editing. */
  graph: RelationshipGraph
  /** Full character roster for name resolution. */
  characters: CharacterProfile[]
  /**
   * Timestamp recorded when the refresh call was dispatched.
   * Entries with lastAiRefreshedAt >= this value are marked as updated.
   */
  refreshStartedAt: number
  /** Called with the (possibly edited) graph when the user clicks Save All. */
  onSave: (graph: RelationshipGraph) => Promise<void>
  /** Called when the user clicks Discard — no graph changes are saved. */
  onDiscard: () => void
}

/** Resolve a character's display name by ID, falling back to the raw ID. */
function resolveName(characterId: string, characters: CharacterProfile[]): string {
  return characters.find((c) => c.id === characterId)?.name ?? characterId
}

/** Group relationship entries by their source character ID. */
function groupBySource(entries: RelationshipEntry[]): Map<string, RelationshipEntry[]> {
  const map = new Map<string, RelationshipEntry[]>()
  for (const entry of entries) {
    const group = map.get(entry.fromCharacterId) ?? []
    group.push(entry)
    map.set(entry.fromCharacterId, group)
  }
  return map
}

/**
 * Post-refresh modal for reviewing and editing the relationship graph before saving.
 */
export function RelationshipReviewModal({
  graph,
  characters,
  refreshStartedAt,
  onSave,
  onDiscard,
}: RelationshipReviewModalProps) {
  const [localGraph, setLocalGraph] = useState<RelationshipGraph>(graph)
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = graph.entries[0]
    return first ? `${first.fromCharacterId}:${first.toCharacterId}` : null
  })
  const [isSaving, setIsSaving] = useState(false)

  /** Update a single field on the currently selected entry. */
  function updateEntry(
    fromId: string,
    toId: string,
    patch: Partial<Pick<RelationshipEntry, 'trustScore' | 'affinityLabel' | 'manualNotes'>>,
  ): void {
    setLocalGraph((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) =>
        entry.fromCharacterId === fromId && entry.toCharacterId === toId
          ? { ...entry, ...patch }
          : entry,
      ),
    }))
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true)
    try {
      await onSave(localGraph)
    } finally {
      setIsSaving(false)
    }
  }

  const grouped = groupBySource(localGraph.entries)
  const selectedEntry = selectedKey
    ? localGraph.entries.find((e) => `${e.fromCharacterId}:${e.toCharacterId}` === selectedKey) ?? null
    : null

  const leftContent = (
    <div className="rel-review__pair-list">
      {localGraph.entries.length === 0 && (
        <p className="rel-review__empty-state">
          No relationship data was found in the transcripts.
        </p>
      )}
      {[...grouped.entries()].map(([fromId, entries]) => (
        <div key={fromId}>
          <p className="rel-review__field-label" style={{ padding: '4px 10px 2px', margin: 0 }}>
            {resolveName(fromId, characters)}
          </p>
          {entries.map((entry) => {
            const key = `${entry.fromCharacterId}:${entry.toCharacterId}`
            const isUpdated = entry.lastAiRefreshedAt >= refreshStartedAt
            return (
              <button
                key={key}
                type="button"
                className={[
                  'rel-review__pair-item',
                  selectedKey === key ? 'rel-review__pair-item--selected' : '',
                  isUpdated ? 'rel-review__pair-item--updated' : '',
                ].join(' ')}
                onClick={() => setSelectedKey(key)}
              >
                <span className={`rel-review__affinity-badge rel-review__affinity-badge--${entry.affinityLabel}`}>
                  {entry.affinityLabel}
                </span>
                → {resolveName(entry.toCharacterId, characters)}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )

  const rightContent = selectedEntry ? (
    <div className="rel-review__detail">
      <h3 className="rel-review__detail-header">
        {resolveName(selectedEntry.fromCharacterId, characters)} → {resolveName(selectedEntry.toCharacterId, characters)}
      </h3>

      <div>
        <label className="rel-review__field-label" htmlFor="rel-trust">Trust Score (0–100)</label>
        <input
          id="rel-trust"
          type="number"
          min={0}
          max={100}
          className="rel-review__trust-input"
          value={selectedEntry.trustScore}
          onChange={(e) =>
            updateEntry(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
              trustScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
            })
          }
        />
      </div>

      <div>
        <label className="rel-review__field-label" htmlFor="rel-affinity">Affinity</label>
        <select
          id="rel-affinity"
          className="rel-review__affinity-select"
          value={selectedEntry.affinityLabel}
          onChange={(e) =>
            updateEntry(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
              affinityLabel: e.target.value as AffinityLabel,
            })
          }
        >
          {(['hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted'] as AffinityLabel[]).map((label) => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="rel-review__field-label">AI Summary (read-only)</label>
        <textarea
          className="rel-review__summary-text"
          value={selectedEntry.summary}
          readOnly
        />
      </div>

      <div>
        <label className="rel-review__field-label" htmlFor="rel-notes">Manual Notes</label>
        <textarea
          id="rel-notes"
          className="rel-review__notes-input"
          value={selectedEntry.manualNotes}
          placeholder="Add personal notes or context overrides…"
          onChange={(e) =>
            updateEntry(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
              manualNotes: e.target.value,
            })
          }
        />
      </div>
    </div>
  ) : (
    <p className="rel-review__no-selection">Select a relationship pair to view details.</p>
  )

  const footer = (
    <ModalFooter>
      <button type="button" className="modal-footer__btn modal-footer__btn--secondary" onClick={onDiscard}>
        Discard
      </button>
      <button
        type="button"
        className="modal-footer__btn modal-footer__btn--primary"
        onClick={() => { void handleSave() }}
        disabled={isSaving}
      >
        {isSaving ? 'Saving…' : 'Save All'}
      </button>
    </ModalFooter>
  )

  return (
    <Modal title="Relationship Review" variant="workspace" onClose={onDiscard}>
      <ModalWorkspaceLayout
        leftContent={leftContent}
        rightContent={rightContent}
        footer={footer}
      />
    </Modal>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors. If `ModalFooter` or `ModalWorkspaceLayout` prop signatures differ from what's used here, check `src/components/ModalLayouts.tsx` and adjust accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/components/RelationshipReviewModal.tsx src/styles/relationship-review-modal.css
git commit -m "feat: add RelationshipReviewModal for post-refresh review and editing"
```

---

## Task 8: CharactersModal Relationships Tab

**Files:**
- Modify: `src/components/CharactersModal.tsx`
- Modify: `src/styles/characters.css`

- [ ] **Step 1: Add new props to `CharactersModalProps`**

Import `RelationshipGraph, RelationshipEntry, AffinityLabel` at the top of `CharactersModal.tsx` (add to the existing type import):

```typescript
import type { CharacterProfile, ReusableAvatar, ReusableCharacter, RelationshipGraph, RelationshipEntry, AffinityLabel } from '../types'
```

Add to `CharactersModalProps`:

```typescript
/** Current persisted relationship graph for the campaign; null if none. */
relationshipGraph: RelationshipGraph | null
/** Persist an updated graph to disk immediately. */
onSaveRelationships: (graph: RelationshipGraph) => Promise<void>
/** Delete both directions of a pair (A→B and B→A) after confirmation. */
onDeleteRelationshipPair: (fromId: string, toId: string) => Promise<void>
```

- [ ] **Step 2: Extend `CharactersTabId`**

Change:

```typescript
type CharactersTabId = 'new-character' | 'existing-campaign-characters' | 'existing-characters' | 'app-characters'
```

to:

```typescript
type CharactersTabId = 'new-character' | 'existing-campaign-characters' | 'existing-characters' | 'app-characters' | 'relationships'
```

- [ ] **Step 3: Add the Relationships tab to the left nav list**

In the JSX where the existing tabs are listed (look for `'existing-campaign-characters'`, `'app-characters'` etc. in the nav), add a "Relationships" divider and entry:

```tsx
<div className="characters-modal__nav-divider">Relationships</div>
<button
  type="button"
  className={`characters-modal__nav-item ${activeTab === 'relationships' ? 'characters-modal__nav-item--active' : ''}`}
  onClick={() => setActiveTab('relationships')}
>
  Relationships
</button>
```

- [ ] **Step 4: Add the Relationships tab content**

Find the section that renders tab content (likely a series of `{activeTab === 'xxx' && (...)}` blocks). Add:

```tsx
{activeTab === 'relationships' && (
  <RelationshipsTabContent
    graph={relationshipGraph}
    characters={characters}
    onSave={onSaveRelationships}
    onDeletePair={onDeleteRelationshipPair}
  />
)}
```

- [ ] **Step 5: Implement `RelationshipsTabContent` as a local component inside `CharactersModal.tsx`**

Add above the main `CharactersModal` export:

```tsx
/** Props for the Relationships tab content panel. */
interface RelationshipsTabContentProps {
  graph: RelationshipGraph | null
  characters: CharacterProfile[]
  onSave: (graph: RelationshipGraph) => Promise<void>
  onDeletePair: (fromId: string, toId: string) => Promise<void>
}

/**
 * Relationships tab rendered inside the CharactersModal workspace layout.
 * Shows a pair list on the left and an editable detail view on the right.
 * Edits are saved to disk immediately on change/blur.
 */
function RelationshipsTabContent({ graph, characters, onSave, onDeletePair }: RelationshipsTabContentProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = graph?.entries[0]
    return first ? `${first.fromCharacterId}:${first.toCharacterId}` : null
  })

  /** Resolve a character name by ID. */
  function name(id: string): string {
    return characters.find((c) => c.id === id)?.name ?? id
  }

  /** Immediately persist a field edit. */
  async function handleFieldChange(
    fromId: string,
    toId: string,
    patch: Partial<Pick<RelationshipEntry, 'trustScore' | 'affinityLabel' | 'manualNotes'>>,
  ): Promise<void> {
    if (!graph) return
    const next: RelationshipGraph = {
      ...graph,
      entries: graph.entries.map((entry) =>
        entry.fromCharacterId === fromId && entry.toCharacterId === toId
          ? { ...entry, ...patch }
          : entry,
      ),
    }
    await onSave(next)
  }

  if (!graph || graph.entries.length === 0) {
    return (
      <div className="characters-modal__relationships-empty">
        <p>No relationship data yet. Use the <strong>Refresh Relationships</strong> button in the session panel to generate relationship data from your campaign transcripts.</p>
      </div>
    )
  }

  const selectedEntry = selectedKey
    ? graph.entries.find((e) => `${e.fromCharacterId}:${e.toCharacterId}` === selectedKey) ?? null
    : null

  // Group by source
  const grouped = new Map<string, RelationshipEntry[]>()
  for (const entry of graph.entries) {
    const group = grouped.get(entry.fromCharacterId) ?? []
    group.push(entry)
    grouped.set(entry.fromCharacterId, group)
  }

  return (
    <div className="characters-modal__relationships-layout">
      {/* Left: pair list */}
      <div className="characters-modal__relationships-list">
        {[...grouped.entries()].map(([fromId, entries]) => (
          <div key={fromId}>
            <p className="characters-modal__relationships-group-header">{name(fromId)}</p>
            {entries.map((entry) => {
              const key = `${entry.fromCharacterId}:${entry.toCharacterId}`
              return (
                <div key={key} className="characters-modal__relationships-pair-row">
                  <button
                    type="button"
                    className={[
                      'characters-modal__relationships-pair-btn',
                      selectedKey === key ? 'characters-modal__relationships-pair-btn--selected' : '',
                    ].join(' ')}
                    onClick={() => setSelectedKey(key)}
                  >
                    <span className={`rel-review__affinity-badge rel-review__affinity-badge--${entry.affinityLabel}`}>
                      {entry.affinityLabel}
                    </span>
                    → {name(entry.toCharacterId)}
                  </button>
                  <button
                    type="button"
                    className="characters-modal__relationships-delete-btn"
                    title="Delete this relationship pair"
                    onClick={() => { void onDeletePair(entry.fromCharacterId, entry.toCharacterId) }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Right: detail view */}
      <div className="characters-modal__relationships-detail">
        {selectedEntry ? (
          <div className="rel-review__detail">
            <h3 className="rel-review__detail-header">
              {name(selectedEntry.fromCharacterId)} → {name(selectedEntry.toCharacterId)}
            </h3>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-trust">Trust Score (0–100)</label>
              <input
                id="cm-rel-trust"
                type="number"
                min={0}
                max={100}
                className="rel-review__trust-input"
                defaultValue={selectedEntry.trustScore}
                key={`trust-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                onBlur={(e) => {
                  const val = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, { trustScore: val })
                }}
              />
            </div>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-affinity">Affinity</label>
              <select
                id="cm-rel-affinity"
                className="rel-review__affinity-select"
                defaultValue={selectedEntry.affinityLabel}
                key={`affinity-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                onBlur={(e) =>
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
                    affinityLabel: e.target.value as AffinityLabel,
                  })
                }
              >
                {(['hostile', 'wary', 'neutral', 'friendly', 'allied', 'devoted'] as AffinityLabel[]).map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="rel-review__field-label">AI Summary (read-only)</label>
              <textarea className="rel-review__summary-text" value={selectedEntry.summary} readOnly />
            </div>

            <div>
              <label className="rel-review__field-label" htmlFor="cm-rel-notes">Manual Notes</label>
              <textarea
                id="cm-rel-notes"
                className="rel-review__notes-input"
                defaultValue={selectedEntry.manualNotes}
                key={`notes-${selectedEntry.fromCharacterId}-${selectedEntry.toCharacterId}`}
                placeholder="Add personal notes or context overrides…"
                onBlur={(e) =>
                  void handleFieldChange(selectedEntry.fromCharacterId, selectedEntry.toCharacterId, {
                    manualNotes: e.target.value,
                  })
                }
              />
            </div>
          </div>
        ) : (
          <p className="rel-review__no-selection">Select a pair to view details.</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Add CSS to `src/styles/characters.css`**

Append at the end of `src/styles/characters.css`:

```css
/* ── Relationships tab ────────────────────────────────────────────────── */

.characters-modal__relationships-empty {
  padding: 24px 20px;
  color: var(--text-color-secondary);
  font-size: 0.85rem;
  line-height: 1.5;
}

.characters-modal__relationships-layout {
  display: flex;
  height: 100%;
  gap: 0;
}

.characters-modal__relationships-list {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  padding: 8px 0;
}

.characters-modal__relationships-group-header {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-color-muted);
  margin: 10px 10px 4px;
  padding: 0;
}

.characters-modal__relationships-pair-row {
  display: flex;
  align-items: center;
}

.characters-modal__relationships-pair-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: none;
  text-align: left;
  color: var(--text-color-primary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.1s;
}

.characters-modal__relationships-pair-btn:hover {
  background: var(--surface-bg-emphasis);
}

.characters-modal__relationships-pair-btn--selected {
  background: var(--surface-bg-selected);
}

.characters-modal__relationships-delete-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--text-color-muted);
  cursor: pointer;
  font-size: 0.75rem;
  border-radius: 4px;
  transition: color 0.1s, background 0.1s;
  margin-right: 4px;
}

.characters-modal__relationships-delete-btn:hover {
  color: var(--text-color-primary);
  background: var(--surface-bg-emphasis);
}

.characters-modal__relationships-detail {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.characters-modal__nav-divider {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-color-muted);
  padding: 10px 12px 4px;
}
```

- [ ] **Step 7: Verify TypeScript compiles cleanly**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/CharactersModal.tsx src/styles/characters.css
git commit -m "feat: add Relationships tab to CharactersModal"
```

---

## Final Verification

- [ ] **Verify full TypeScript build**

```bash
cd d:/Development/aethra && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Manual smoke test checklist**

Open the app (user runs `npm run dev`), then:
1. Open or create a campaign with at least 2 characters and some session messages
2. Select a session — verify "Refresh Relationships" button appears in the right panel under the cast list
3. Click "Refresh Relationships" — button shows "Refreshing…", then RelationshipReviewModal opens
4. Verify pair list shows directed entries with affinity badges; updated entries have "updated" tag
5. Edit a trust score and manual notes field; verify changes reflect in the list
6. Click Save All — modal closes; verify relationships.json is created in the campaign folder
7. Click Refresh again — verify existing manualNotes are preserved after re-refresh
8. Open Characters modal → Relationships tab — verify saved pairs appear; edit a field and blur — verify it saves
9. Delete a pair using ✕ button — verify both A→B and B→A are removed
10. Send a chat message with 2+ active characters — verify model receives inline `Relationships:` block in the system prompt (check AI Debug modal)
11. Disable one character for the session — verify only relationships between remaining active characters are injected

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: complete character relationship model implementation"
```
