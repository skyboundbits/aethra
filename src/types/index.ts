/**
 * src/types/index.ts
 * Central type definitions for the Aethra roleplay application.
 * All shared interfaces and enums are declared here to ensure consistency
 * across components and services.
 */

/** Identifies who authored a message in the conversation. */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * A single message within a roleplay session.
 */
export interface Message {
  /** Unique identifier for the message (UUID). */
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
  /** Unique identifier for the session (UUID). */
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
 * Configuration for the external LLM provider (e.g. LM Studio).
 * Stored in environment variables and passed to the AI service.
 */
export interface LLMConfig {
  /** Base URL of the OpenAI-compatible API (e.g. http://localhost:1234/v1). */
  baseUrl: string
  /** Optional API key; some local servers accept any non-empty string. */
  apiKey: string
  /** Model identifier to request from the provider. */
  model: string
}
