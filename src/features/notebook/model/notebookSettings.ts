// User-tunable notebook-wide settings. Currently holds the execution
// timeout, but the file exists so future settings (output budget, max
// scope size, etc.) have an obvious home.
//
// Persistence: in-memory for now; sessionStorage / per-notebook persistence
// can hook in here without touching call sites.

import { atom } from '@reatom/core'

/** Default per-cell execution timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Hard upper bound the user is allowed to dial up to. Keeps the slider
 * from being set to e.g. an hour by accident.
 */
export const MAX_TIMEOUT_MS = 5 * 60_000 // 5 minutes

/**
 * Per-cell execution timeout. Consumed by `executeCell` in `runtime.ts`;
 * set by the (future) Settings UI.
 */
export const timeoutMsAtom = atom<number>(DEFAULT_TIMEOUT_MS, 'notebook.settings.timeoutMs')
