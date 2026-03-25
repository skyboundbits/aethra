# Character Relationship Model — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Add a persistent, AI-generated character relationship model to Aethra. Relationships are built on demand by analysing campaign scene transcripts, stored at campaign level, and injected selectively into the AI prompt only when both characters in a pair are active in the current scene. Users can review and edit relationship data after each refresh via a dedicated modal.

---

## 1. Data Model

### `RelationshipEntry`

A directed relationship from one character's perspective toward another.

```ts
interface RelationshipEntry {
  fromCharacterId: string       // whose perspective this entry represents
  toCharacterId: string         // the character being related to
  trustScore: number            // integer 0–100 (0 = no trust, 100 = complete trust)
  affinityLabel: AffinityLabel  // broad relationship category
  summary: string               // AI-generated prose (1–3 sentences)
  manualNotes: string           // user-editable supplement/override (may be empty string)
  lastAiRefreshedAt: number     // unix timestamp (ms) of last AI refresh for this entry
}

type AffinityLabel = 'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied' | 'devoted'
```

Relationships are **asymmetric**: Mira→Kael and Kael→Mira are separate entries with independent scores, labels, and summaries.

`lastAiRefreshedAt` strictly reflects when the AI last generated data for this entry. Manual edits to `trustScore`, `affinityLabel`, or `manualNotes` do not update this timestamp. This field is for display only (e.g. "Last refreshed 3 scenes ago") — it does not affect injection or refresh logic.

### `RelationshipGraph`

The campaign-level container for all relationship entries.

```ts
interface RelationshipGraph {
  campaignId: string             // campaign ID (Campaign.id) — written on creation, used for integrity validation on load
  entries: RelationshipEntry[]
  lastRefreshedAt: number | null  // unix timestamp (ms) of most recent refresh, null if never refreshed
}
```

### Storage

Persisted to `<campaignFolderPath>/relationships.json` — where `campaignFolderPath` is the absolute path of the campaign's folder on disk (the same path already used for `campaign.json`, `scenes/`, and `characters/`).

One file per campaign. Created on first save; absent file is treated as an empty graph (no relationships yet).

---

## 2. IPC Channels

Three new channels following existing `noun:verb` naming conventions. All three use the **campaign folder path** (`campaignPath: string`) to identify the campaign, consistent with all existing campaign/character/scene IPC handlers.

| Channel | Direction | Payload | Returns | Purpose |
|---|---|---|---|---|
| `relationships:get` | invoke | `{ campaignPath: string, campaignId: string }` | `RelationshipGraph \| null` | Load graph from disk; validates `campaignId` matches stored graph if one exists |
| `relationships:set` | invoke | `{ campaignPath: string, graph: RelationshipGraph }` | `void` | Save graph to disk |
| `relationships:refresh` | invoke | `{ campaignPath: string, campaignId: string, characters: CharacterProfile[], scenes: Scene[] }` | `RelationshipGraph` | LLM call to generate/update entries, returns merged result without saving |

All handlers live in `electron/main/index.ts` alongside existing campaign and settings handlers.

`relationships:get` returns `null` when no `relationships.json` exists for the campaign (not an error — just no data yet). If a file exists but its `campaignId` does not match the provided `campaignId`, the handler logs a warning and returns `null` rather than loading potentially mismatched data.

`relationships:refresh` does **not** write to disk — it returns the merged graph to the renderer for user review. The renderer calls `relationships:set` only after the user confirms in the review modal.

---

## 3. Refresh Logic

### Trigger

User clicks "Refresh Relationships" in the DetailsPanel (right pane, below the active cast list).

### LLM Call

A single **non-streaming** request using the active server and model. Sent from the main process via the same OpenAI-compatible API used for chat.

**Building the transcript:**

For each scene in the payload (oldest first), prepend the scene's `rollingSummary` (if non-empty) before that scene's `messages`. This ensures compressed older history is still available to the LLM even when older messages have been rolled up.

Format per scene:
```
--- Scene: {scene.title} ---
{scene.rollingSummary if non-empty, prefixed with "Summary of earlier events:"}

{messages, one per line: [CharacterName] content}
```

**System message:**
```
You analyse roleplay transcripts and extract character relationship states.

For each directed character pair (A→B), output a JSON array of relationship entries.
Each entry must have:
- fromCharacterId (string, exact character ID from the provided character list)
- toCharacterId (string, exact character ID from the provided character list)
- trustScore (integer 0–100)
- affinityLabel (one of: hostile, wary, neutral, friendly, allied, devoted)
- summary (1–3 sentences: how A currently perceives or feels toward B, grounded in transcript events only)

Base all values strictly on evidence in the transcripts.
Do not invent events or relationships not evidenced in the transcripts.
Output only a valid JSON array. No explanation, no markdown, no wrapper text.
```

**User message:**
```
Characters:
{list of { id, name } pairs}

Transcripts (all scenes, oldest first):
{assembled transcript as described above}

Generate relationship entries for all directed pairs where both characters appear in the transcripts.
```

### Response Validation

After the LLM responds, validate the parsed output before merging:

1. Attempt to parse the response as JSON. If parsing fails, throw an error — surface "Refresh failed — model returned invalid data. Try again." in the review modal.
2. Confirm the result is an array. If not, throw the same error.
3. For each element in the array, validate required fields:
   - `fromCharacterId` and `toCharacterId` must be non-empty strings matching IDs in the provided `characters` list. Entries referencing unknown character IDs are **silently skipped** (handles deleted characters gracefully).
   - `trustScore` must be an integer between 0 and 100 (inclusive). Invalid values are clamped to the range.
   - `affinityLabel` must be one of the six valid values. Invalid values default to `neutral`.
   - `summary` must be a non-empty string. Entries with an empty or missing summary are silently skipped.
4. If the validated array is empty (all entries were skipped or the LLM returned `[]`), surface a warning — "No relationship data was found in the transcripts." — but do not treat this as an error. The empty graph is still returned for the user to review.

### Merge Rules

After validation:

1. For each validated entry, find any existing entry in the current graph with matching `fromCharacterId` + `toCharacterId`.
2. **Overwrite** AI-generated fields: `trustScore`, `affinityLabel`, `summary`, `lastAiRefreshedAt` (set to `Date.now()`).
3. **Preserve** `manualNotes` from the existing entry (never overwritten by refresh). New entries get `manualNotes: ''`.
4. Entries for pairs not mentioned in the validated LLM response are left unchanged in the merged graph.
5. New pairs are added to the graph.
6. **Orphaned entries** (entries whose `fromCharacterId` or `toCharacterId` no longer exists in the provided `characters` list) are **retained** in the merged graph. Deletion of stale entries is left to the user via the CharactersModal Relationships tab.
7. Update `lastRefreshedAt` on the graph to `Date.now()`.
8. Return the full merged graph to the renderer. Do not write to disk.

### Error Handling

- Malformed or invalid JSON response: surface error in the review modal, discard result.
- No active server/model configured: show an inline error on the DetailsPanel button before firing the request.
- Network/server error: surface error in the review modal.

---

## 4. Prompt Injection

### Where

Inside `buildSystemContext()` in `src/App.tsx`. The function signature gains an optional `relationshipGraph: RelationshipGraph | null` parameter.

`buildSystemContext()` is called from two places in `App.tsx`:
1. The `useMemo` that computes context for the debug/token-count display path.
2. `buildRequestMessages()`, which assembles the actual outbound prompt for AI requests.

**Both call sites must be updated** to pass the `relationshipGraph`. Omitting the update in `buildRequestMessages()` would leave outbound requests without relationship data even when the debug path shows it correctly.

### When

For each character in the scene's enabled character list, look up all `RelationshipEntry` records where:
- `fromCharacterId` matches this character's ID
- `toCharacterId` is also in the enabled character list for this scene

Only entries satisfying both conditions are injected. If a character has no qualifying relationship entries, their prompt entry is unchanged.

### Format

The `Relationships:` block is appended as the **last item** in the character's section, after `Goals` (the current final field). A blank line separates the block from the preceding fields.

Example:

```
Mira
Role: Rogue
Gender: female
Pronouns: she/her
Personality: Guarded, sharp-tongued, fiercely loyal once trust is earned
Description: A lean woman in her late twenties with close-cropped dark hair
Speaking Style: Clipped sentences, dry humour, rarely uses names directly
Goals: Find her missing brother

Relationships:
→ Kael [trust: 18/100 | wary] Mira suspects Kael sold out their crew during the ambush. She hasn't confronted him directly but keeps her hand near her knife when he's close. [Note: Player considers this unresolved — do not resolve without explicit in-scene action.]
→ Sera [trust: 74/100 | friendly] Mira respects Sera's calm under pressure and considers her the most reliable person in the group, though she'd never say it aloud.
```

`manualNotes`, when non-empty, is appended to the end of the line in brackets as shown above. If `manualNotes` is empty, the bracket section is omitted entirely.

Fields in the character block (`Description`, `Speaking Style`, `Goals`) are conditionally included only when non-empty, matching the existing `buildSystemContext()` behaviour. The `Relationships:` section follows the same rule — only appended when at least one qualifying entry exists.

---

## 5. UI

### 5a. DetailsPanel — Refresh Button

A "Refresh Relationships" button added to the right panel below the active cast list. Visible whenever a campaign is open and at least two characters are active in the scene.

**New props added to `DetailsPanelProps`:**
```ts
onRefreshRelationships: () => Promise<void>   // triggers refresh; loading/error state managed in App.tsx
isRefreshingRelationships: boolean            // disables button and shows spinner
refreshRelationshipsError: string | null      // inline error shown below button when non-null
```

The "at least two characters" visibility condition is already satisfiable from the existing `activeCharacters` prop.

States:
- **Default**: "Refresh Relationships" button
- **Loading**: Button disabled, spinner, label "Refreshing…"
- **Error**: Inline error message below the button, button re-enabled

On success: `RelationshipReviewModal` opens automatically with the returned merged graph.

### 5b. RelationshipReviewModal

A new modal for post-refresh review and editing. The modal holds the **full merged graph** in local state (not just the delta). The user reviews and optionally edits before confirming or discarding.

Layout: `ModalWorkspaceLayout` — left pane lists all pairs grouped by source character; right pane shows the full detail for the selected pair.

**Left pane:** List of pairs as `Mira → Kael`, `Kael → Mira`, etc. Affinity label shown as a coloured badge. Pairs whose `lastAiRefreshedAt` was updated in this refresh are visually indicated (e.g. a subtle highlight or "updated" tag). Clicking a pair opens it on the right.

To detect which entries were updated, the renderer records a `refreshStartedAt` timestamp (via `Date.now()`) at the moment the `relationships:refresh` IPC call is dispatched. After the call returns, any entry whose `lastAiRefreshedAt >= refreshStartedAt` is treated as updated in the current refresh.

**Right pane (detail view):**
- Header: `[Character A] → [Character B]`
- Trust score: editable number input (0–100)
- Affinity label: dropdown (`hostile` / `wary` / `neutral` / `friendly` / `allied` / `devoted`)
- AI summary: read-only textarea
- Manual notes: editable textarea

All edits in the detail view update the **in-modal graph state** only — nothing is written to disk until the user confirms. Changes are applied immediately on input (no blur-save needed since there is no persistence until Save All).

**Footer actions:**
- **Save All** — writes the full in-modal graph to disk via `relationships:set` and closes the modal
- **Discard** — closes the modal without saving; existing graph on disk is unchanged

### 5c. Characters Modal — Relationships Tab

A "Relationships" section added to the left nav of the existing Characters modal (`CharactersModal.tsx`) below the character list. Selecting it shows the persisted relationship graph for the campaign.

**New props added to `CharactersModalProps`:**
```ts
relationshipGraph: RelationshipGraph | null                          // current persisted graph
onSaveRelationships: (graph: RelationshipGraph) => Promise<void>    // called on blur after edit; writes to disk
onDeleteRelationshipPair: (fromId: string, toId: string) => Promise<void>  // deletes A→B and B→A entries
```

Following the existing pattern in `CharactersModal`, the modal receives callbacks rather than calling IPC directly. `App.tsx` implements these callbacks using `relationships:set`.

Same pair list + detail view layout as the review modal. All fields (`trustScore`, `affinityLabel`, `manualNotes`) are editable. Changes are saved to disk immediately via `relationships:set` on blur (the disk write is the persistence mechanism here, since there is no confirm step).

**Deleting entries:** Each pair row in the left pane has a delete affordance (e.g. a trash icon). Deleting a pair removes both the `A→B` entry **and** the corresponding `B→A` entry (if it exists) after a confirmation prompt. This is the mechanism for removing stale entries when characters are deleted from the campaign.

No "Refresh" button in the Characters modal — refresh is only triggered from the DetailsPanel.

---

## 6. File Changes Summary

| File | Change |
|---|---|
| `src/types/index.ts` | Add `RelationshipEntry`, `RelationshipGraph`, `AffinityLabel` types |
| `src/types/electron.d.ts` | Add `relationships:get`, `relationships:set`, `relationships:refresh` to `window.api` |
| `electron/main/index.ts` | Add three IPC handlers; add non-streaming LLM refresh call |
| `electron/preload/index.ts` | Expose three new channels through the context bridge |
| `src/App.tsx` | Load relationship graph on campaign open; pass to `buildSystemContext()`; update `buildSystemContext()` signature and injection logic |
| `src/components/DetailsPanel.tsx` | Add "Refresh Relationships" button + loading/error state |
| `src/components/RelationshipReviewModal.tsx` | New modal for post-refresh review and editing |
| `src/components/CharactersModal.tsx` | Add "Relationships" nav section with pair list, detail view, immediate-save editing, and delete affordance |
| `src/styles/relationship-review-modal.css` | Styles for the review modal |
| `src/styles/characters-modal.css` | Styles for the Relationships tab within the Characters modal |

---

## 7. Out of Scope

- Automatic relationship updates after every message (on-demand only)
- Per-scene relationship snapshots or divergence tracking
- Relationship history / changelog
- Exporting or importing relationship graphs
- Automatic cleanup of orphaned entries when characters are deleted (manual deletion via CharactersModal only)
