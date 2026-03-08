/**
 * src/components/DetailsPanel.tsx
 * Right panel component for character sheets, scene descriptions, and
 * session-level settings. Currently renders placeholder content;
 * will be expanded as features are added.
 */

import '../styles/details.css'
import type { Session } from '../types'

/** Props accepted by the DetailsPanel component. */
interface DetailsPanelProps {
  /** The currently active session, or null when none is selected. */
  activeSession: Session | null
}

/**
 * DetailsPanel
 * Renders the right-hand panel that will surface contextual information
 * about the active roleplay session (characters, scene, model config, etc.).
 */
export function DetailsPanel({ activeSession }: DetailsPanelProps) {
  return (
    <aside className="panel panel--details">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="details__header">
        <span className="details__title">Details</span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="details__body">
        {/* Character card */}
        <div className="details__card">
          <div className="details__card-label">Character</div>
          <div className="details__card-placeholder">
            {activeSession
              ? 'No character set for this session.'
              : 'Select a session to view details.'}
          </div>
        </div>

        {/* Scene card */}
        <div className="details__card">
          <div className="details__card-label">Scene</div>
          <div className="details__card-placeholder">No scene description.</div>
        </div>

        {/* Model info card */}
        <div className="details__card">
          <div className="details__card-label">Model</div>
          <div className="details__card-placeholder">
            {import.meta.env.VITE_LLM_MODEL ?? 'Not configured'}
          </div>
        </div>
      </div>
    </aside>
  )
}
