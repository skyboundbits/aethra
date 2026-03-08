/**
 * src/types/index.ts
 * Central type definitions for the Aethra roleplay application.
 * All shared interfaces and enums are declared here to ensure consistency
 * across components, services, and the Electron main process.
 */

/* ── Chat & sessions ──────────────────────────────────────────────────── */

/** Identifies who authored a message in the conversation. */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * A single message within a roleplay session.
 */
export interface Message {
  /** Unique identifier for the message. */
  id: string
  /** Who sent this message. */
  role: MessageRole
  /** The text content of the message. */
  content: string
  /** Unix timestamp (ms) when the message was created. */
  timestamp: number
}

/**
 * A roleplay session, analogous to a conversation thread.
 * Contains metadata and the full message history.
 */
export interface Session {
  /** Unique identifier for the session. */
  id: string
  /** Human-readable title shown in the sidebar. */
  title: string
  /** Ordered list of messages exchanged in this session. */
  messages: Message[]
  /** Unix timestamp (ms) when the session was created. */
  createdAt: number
  /** Unix timestamp (ms) of the most recent activity. */
  updatedAt: number
}

/**
 * A single message in the format expected by OpenAI-compatible chat APIs.
 * Used when building the payload sent to the AI server.
 */
export interface ChatMessage {
  /** Author role. */
  role: 'user' | 'assistant' | 'system'
  /** Text content. */
  content: string
}

/* ── Settings ─────────────────────────────────────────────────────────── */

/**
 * A configured AI server the user can connect to.
 * Stored in AppSettings and persisted to userData/settings.json.
 */
export interface ServerProfile {
  /** Unique identifier. */
  id: string
  /** Display name shown in the UI (e.g. "LM Studio"). */
  name: string
  /** Base URL of the OpenAI-compatible API (e.g. http://localhost:1234/v1). */
  baseUrl: string
  /** API key — most local servers accept any non-empty string. */
  apiKey: string
}

/**
 * A saved model preset associated with a server.
 */
export interface ModelPreset {
  /** Unique identifier. */
  id: string
  /** ID of the ServerProfile this model belongs to. */
  serverId: string
  /** Display name shown in the UI (e.g. "Llama 3 8B"). */
  name: string
  /** Model slug sent to the API (e.g. "llama3", "local-model"). */
  slug: string
}

/**
 * Persisted application settings.
 * Loaded from / saved to <userData>/settings.json by the main process.
 */
export interface AppSettings {
  /** All configured server profiles. */
  servers: ServerProfile[]
  /** All saved model presets. */
  models: ModelPreset[]
  /** ID of the server profile currently selected as default. */
  activeServerId: string | null
  /** Model slug currently selected as default. */
  activeModelSlug: string | null
}
