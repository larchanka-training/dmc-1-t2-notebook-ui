// Cross-tab notebook coordination over BroadcastChannel.
//
// Multiple tabs on the same origin share one IndexedDB. Without coordination,
// a later tab's autosave silently overwrites an earlier tab's notebook (the
// classic "I lost my edits" bug). Two layers defend against that:
//   1. storage.putIfNewer() — an atomic compare-and-swap, the source of truth.
//   2. this channel — a live "I just saved" notification, so other tabs react
//      immediately (pull the new version or warn) instead of only finding out
//      when they next try to write.
//
// The channel is best-effort and advisory: BroadcastChannel may be absent
// (older browsers, some privacy modes) or messages may race. Correctness never
// depends on it — putIfNewer is the actual guard. This module degrades to a
// no-op when the API is missing.

const CHANNEL_NAME = 'js-notebook:notebooks'

/** A tab announcing it persisted `id` at `updatedAt` (Unix ms). */
export interface NotebookSavedMessage {
  type: 'saved'
  id: string
  updatedAt: number
}

function isSavedMessage(data: unknown): data is NotebookSavedMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  return m['type'] === 'saved' && typeof m['id'] === 'string' && typeof m['updatedAt'] === 'number'
}

/** A connected cross-tab channel, or a no-op stub when unsupported. */
export interface CrossTabChannel {
  /** Announce a successful save to other tabs. */
  postSaved(id: string, updatedAt: number): void
  /** Tear down the channel. */
  close(): void
}

const NOOP_CHANNEL: CrossTabChannel = {
  postSaved() {},
  close() {},
}

/**
 * Open the cross-tab channel and subscribe to other tabs' save notifications.
 * `onSaved` fires for messages from OTHER tabs only (BroadcastChannel already
 * does not deliver a message to its own sender). Returns a no-op channel when
 * BroadcastChannel is unavailable, so callers need no feature check.
 */
export function openCrossTabChannel(onSaved: (msg: NotebookSavedMessage) => void): CrossTabChannel {
  if (typeof BroadcastChannel === 'undefined') return NOOP_CHANNEL

  const bc = new BroadcastChannel(CHANNEL_NAME)
  bc.onmessage = (event: MessageEvent) => {
    if (isSavedMessage(event.data)) onSaved(event.data)
  }

  return {
    postSaved(id, updatedAt) {
      bc.postMessage({ type: 'saved', id, updatedAt } satisfies NotebookSavedMessage)
    },
    close() {
      bc.onmessage = null
      bc.close()
    },
  }
}
