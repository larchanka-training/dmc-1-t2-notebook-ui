// User-tunable notebook-wide settings. Currently holds the execution
// timeout, but the file exists so future settings (output budget, max
// scope size, etc.) have an obvious home.
//
// Persistence: in-memory for now; sessionStorage / per-notebook persistence
// can hook in here without touching call sites.
//
// The numeric bounds live in the neutral `runtime/limits` module (shared
// with the worker/kernel, which must not import this Reatom-flavored file).

import { atom } from '@reatom/core'
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from '../runtime/limits'

export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS }

/**
 * Per-cell execution timeout. Consumed by `executeCell` in `runtime.ts`
 * (clamped to `[MIN, MAX]` at read time); set by the (future) Settings UI.
 */
export const timeoutMsAtom = atom<number>(DEFAULT_TIMEOUT_MS, 'notebook.settings.timeoutMs')
