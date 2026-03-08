/**
 * src/App.tsx
 * Root application component for Aethra.
 *
 * Owns all top-level state:
 *   - sessions      : list of roleplay sessions
 *   - activeSession : which session is currently open
 *   - inputValue    : current text in the composer
 *
 * Renders the three-column floating layout:
 *   Sidebar (left) | ChatArea + InputBar (centre) | DetailsPanel (right)
 */

import { useState } from 'react'
import './styles/global.css'
import './styles/layout.css'

import { Sidebar }      from './components/Sidebar'
import { ChatArea }     from './components/ChatArea'
import { InputBar }     from './components/InputBar'
import { DetailsPanel } from './components/DetailsPanel'

import type { Session, Message } from './types'

/**
 * Generate a lightweight unique ID.
 * Combines a timestamp with a short random hex string.
 * (Replace with crypto.randomUUID() if broader support is needed.)
 */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/**
 * App
 * Top-level component that wires together all panels and manages state.
 */
export default function App() {
  /* ── State ──────────────────────────────────────────────────────────── */

  /** All roleplay sessions available in the sidebar. */
  const [sessions, setSessions] = useState<Session[]>([])

  /** ID of the session currently displayed in the chat area. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  /** Controlled value for the message composer textarea. */
  const [inputValue, setInputValue] = useState('')

  /* ── Derived values ─────────────────────────────────────────────────── */

  /** The full session object for the active session (or null). */
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  /** Messages belonging to the active session. */
  const messages: Message[] = activeSession?.messages ?? []

  /* ── Handlers ───────────────────────────────────────────────────────── */

  /**
   * Create a new empty session, add it to the list, and make it active.
   */
  function handleNewSession() {
    const now = Date.now()
    const newSession: Session = {
      id:        uid(),
      title:     `Session ${sessions.length + 1}`,
      messages:  [],
      createdAt: now,
      updatedAt: now,
    }
    setSessions((prev) => [newSession, ...prev])
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
   * Append the current input as a user message to the active session.
   * AI response dispatch will be added here once the AI service is wired up.
   */
  function handleSend() {
    if (!inputValue.trim() || !activeSessionId) return

    const userMessage: Message = {
      id:        uid(),
      role:      'user',
      content:   inputValue.trim(),
      timestamp: Date.now(),
    }

    // Append message and update session's updatedAt timestamp
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, userMessage], updatedAt: Date.now() }
          : s
      )
    )

    setInputValue('')

    // TODO: dispatch userMessage to AI service and append assistant response
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="app-layout">
      {/* Left column: session navigator */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
      />

      {/* Centre column: chat feed + composer */}
      <main className="panel panel--chat">
        <ChatArea messages={messages} />
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={activeSession === null}
        />
      </main>

      {/* Right column: session details */}
      <DetailsPanel activeSession={activeSession} />
    </div>
  )
}
