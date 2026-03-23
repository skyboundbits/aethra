# Character Relationship Model — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Add a persistent, AI-generated character relationship model to Aethra. Relationships are built on demand by analysing campaign session transcripts, stored at campaign level, and injected selectively into the AI prompt only when both characters in a pair are active in the current session. Users can review and edit relationship data after each refresh via a dedicated modal.

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
  updatedAt: number             // unix timestamp (ms) of last AI refresh
}

type AffinityLabel = 'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied' | 'devoted'
```

Relationships are **asymmetric**: Mira→Kael and Kael→Mira are separate entries with independent scores, labels, and summaries.

### `RelationshipGraph`

The campaign-level container for all relationship entries.

```ts
interface RelationshipGraph {
  campaignId: string
  entries: RelationshipEntry[]
  lastRefreshedAt: number | null  // unix timestamp (ms) of most recent refresh, null if never refreshed
}
```

### Storage

Persisted to `<userData>/campaigns/{campaignId}/relationships.json`.

One file per campaign. Created on first refresh; absent file is treated as an empty graph (no relationships yet).

---

## 2. IPC Channels

Three new channels following existing `noun:verb` naming conventions.

| Channel | Direction | Payload | Returns | Purpose |
|---|---|---|---|---|
| `relationships:get` | invoke | `campaignId: string` | `RelationshipGraph \| null` | Load graph from disk |
| `relationships:set` | invoke | `RelationshipGraph` | `void` | Save graph to disk |
| `relationships:refresh` | invoke | `{ campaignId, characters: CharacterProfile[], sessions: Session[] }` | `RelationshipGraph` | LLM call to generate/update entries |

All handlers live in `electron/main/index.ts` alongside existing campaign and settings handlers.

`relationships:get` returns `null` when no `relationships.json` exists for the campaign (not an error — just no data yet).

---

## 3. Refresh Logic

### Trigger

User clicks "Refresh Relationships" in the DetailsPanel (right pane, below the active cast list).

### LLM Call

A single **non-streaming** request using the active server and model. Sent from the main process via the same OpenAI-compatible API used for chat.

**System message:**
```
You analyse roleplay transcripts and extract character relationship states.

For each directed character pair (A→B), output a JSON array of relationship entries.
Each entry must have:
- fromCharacterId (string, exact character ID)
- toCharacterId (string, exact character ID)
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
{list of id and name pairs}

Transcripts (all sessions, oldest first):
{full message history with character name tags preserved}

Generate relationship entries for all directed pairs where both characters appear in the transcripts.
```

### Merge Rules

After the LLM responds:

1. Parse the JSON array from the response.
2. For each returned entry, find any existing entry in the graph with matching `fromCharacterId` + `toCharacterId`.
3. **Overwrite** AI-generated fields: `trustScore`, `affinityLabel`, `summary`, `updatedAt`.
4. **Preserve** `manualNotes` from the existing entry (never overwritten by refresh).
5. Entries for pairs not mentioned in the LLM response are left unchanged.
6. New pairs returned by the LLM are added to the graph.
7. The merged result is returned to the renderer — **not saved yet**. The user reviews and confirms before writing to disk.

### Error Handling

- If the LLM returns malformed JSON, surface an error in the review modal ("Refresh failed — model returned invalid data. Try again.") and discard the result.
- If no active server/model is configured, show an inline error on the DetailsPanel button before firing the request.

---

## 4. Prompt Injection

### Where

Inside `buildSystemContext()` in `src/App.tsx`, within the characters block.

### When

For each character in the session's enabled character list, look up all `RelationshipEntry` records where:
- `fromCharacterId` matches this character
- `toCharacterId` is also in the enabled character list for this session

Only entries satisfying both conditions are injected. If a character has no qualifying relationship entries, their prompt entry is unchanged.

### Format

Appended inline to the character's existing entry in the characters block:

```
Mira
Role: Rogue
Gender: female
Pronouns: she/her
Personality: Guarded, sharp-tongued, fiercely loyal once trust is earned
Speaking Style: Clipped sentences, dry humour, rarely uses names directly
Goals: Find her missing brother

Relationships:
→ Kael [trust: 18/100 | wary] Mira suspects Kael sold out their crew during the ambush. She hasn't confronted him directly but keeps her hand near her knife when he's close. [Note: Player considers this unresolved — do not resolve without explicit in-session action.]
→ Sera [trust: 74/100 | friendly] Mira respects Sera's calm under pressure and considers her the most reliable person in the group, though she'd never say it aloud.
```

`manualNotes`, when non-empty, is appended to the end of the `summary` in brackets as shown above. If `manualNotes` is empty, the bracket section is omitted entirely.

---

## 5. UI

### 5a. DetailsPanel — Refresh Button

A "Refresh Relationships" button added to the right panel below the active cast list. Visible whenever a campaign is open and at least two characters are active in the session.

States:
- **Default**: "Refresh Relationships" button
- **Loading**: Button disabled, spinner, label "Refreshing…"
- **Error**: Inline error message below the button, button re-enabled

On success: `RelationshipReviewModal` opens automatically.

### 5b. RelationshipReviewModal

A new modal that appears after a successful refresh, showing all entries that were updated or created by the LLM. The user reviews and edits before saving.

Layout: `ModalWorkspaceLayout` — left pane lists all updated pairs grouped by source character; right pane shows the full detail for the selected pair.

**Left pane:** List of pairs as `Mira → Kael`, `Kael → Mira`, etc. Affinity label shown as a coloured badge. Clicking a pair opens it on the right.

**Right pane (detail view):**
- Header: `[Character A] → [Character B]`
- Trust score: editable number input (0–100)
- Affinity label: dropdown (`hostile` / `wary` / `neutral` / `friendly` / `allied` / `devoted`)
- AI summary: read-only textarea (content of `summary`)
- Manual notes: editable textarea (`manualNotes`), saved on blur

**Footer actions:**
- **Save All** — writes the full updated graph to `relationships.json` via `relationships:set` and closes the modal
- **Discard** — closes the modal without saving; existing graph on disk is unchanged

### 5c. Characters Modal — Relationships Tab

A "Relationships" section added to the left nav of the existing Characters modal (`CharactersModal.tsx`) below the character list. Selecting it shows the persisted relationship graph for the campaign.

Same pair list + detail view layout as the review modal, but all fields are editable and changes are saved immediately on blur (no confirm step). Provides a persistent editing surface outside of the refresh workflow.

No "Refresh" button here — refresh is only triggered from the DetailsPanel during a session.

---

## 6. File Changes Summary

| File | Change |
|---|---|
| `src/types/index.ts` | Add `RelationshipEntry`, `RelationshipGraph`, `AffinityLabel` types |
| `src/types/electron.d.ts` | Add `relationships:get`, `relationships:set`, `relationships:refresh` to `window.api` |
| `electron/main/index.ts` | Add three IPC handlers; add LLM refresh call |
| `electron/preload/index.ts` | Expose three new channels through the context bridge |
| `src/App.tsx` | Load relationship graph on campaign open; pass to `buildSystemContext()`; add `buildSystemContext()` injection logic |
| `src/prompts/campaignPrompts.ts` | Update `buildSystemContext()` to accept and inject relationship data inline per character |
| `src/components/DetailsPanel.tsx` | Add "Refresh Relationships" button + loading/error state |
| `src/components/RelationshipReviewModal.tsx` | New modal for post-refresh review and editing |
| `src/components/CharactersModal.tsx` | Add "Relationships" nav section with view/edit of persisted graph |
| `src/styles/relationship-review-modal.css` | Styles for the review modal |

---

## 7. Out of Scope

- Automatic relationship updates after every message (on-demand only)
- Per-session relationship snapshots or divergence tracking
- Relationship history / changelog
- Exporting or importing relationship graphs
- Relationship-driven narrative suggestions or alerts
