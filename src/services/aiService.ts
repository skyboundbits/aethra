/**
 * src/services/aiService.ts
 * Renderer-side AI service.
 *
 * Delegates all network I/O to the Electron main process via window.api
 * (exposed by the preload script). The renderer never touches the network
 * directly — this keeps Node-only concerns (fetch, fs) in the main process.
 */

import type { ChatMessage } from '../types'

export type { ChatMessage }

/**
 * Start a streaming AI completion request.
 * Chunks arrive via `onToken` as they stream; `onDone` fires on success,
 * `onError` fires on failure.
 *
 * @param messages  - Full conversation history in chat format.
 * @param onToken   - Called once per streamed text chunk.
 * @param onDone    - Called when the stream ends successfully.
 * @param onError   - Called if the request fails.
 */
export function streamCompletion(
  messages: ChatMessage[],
  onToken:  (chunk: string) => void,
  onDone:   () => void,
  onError:  (err: unknown) => void,
): void {
  window.api.streamCompletion(
    messages,
    null, // use activeServerId from persisted settings
    null, // use activeModelSlug from persisted settings
    {
      onToken,
      onDone,
      onError: (err: string) => onError(new Error(err)),
    },
  )
}
