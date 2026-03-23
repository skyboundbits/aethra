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

  const navContent = (
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

  const panelContent = selectedEntry ? (
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

  const footerContent = (
    <ModalFooter
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="modal-footer__button"
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            type="button"
            className="modal-footer__button modal-footer__button--primary"
            onClick={() => { void handleSave() }}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save All'}
          </button>
        </div>
      }
    />
  )

  return (
    <Modal title="Relationship Review" variant="workspace" onClose={onDiscard}>
      <ModalWorkspaceLayout
        nav={navContent}
        panel={panelContent}
        footer={footerContent}
      />
    </Modal>
  )
}
