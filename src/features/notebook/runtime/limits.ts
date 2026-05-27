// Single source of truth for execution-time limits.
//
// Lives in its own neutral module (like outputBudget.ts) because BOTH the
// kernel (quickjs.ts, runs inside the worker) and the host facade
// (workerHost.ts) need the default timeout, and the Reatom settings layer
// (notebookSettings.ts) needs the default + max. Keeping the numbers here
// means workerHost/quickjs never import the Reatom-flavored settings module
// (which would pull @reatom/core into the worker bundle).

/** Default per-cell execution timeout, in ms. */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Lower bound for a configured timeout. Guards against 0 / negative values
 * (which would make every cell time out instantly) sneaking in from a future
 * Settings UI or a bad persisted value.
 */
export const MIN_TIMEOUT_MS = 100

/**
 * Hard upper bound the user is allowed to dial up to. Keeps the (future)
 * slider from being set to e.g. an hour by accident.
 */
export const MAX_TIMEOUT_MS = 5 * 60_000 // 5 minutes

/** Clamp an arbitrary timeout into the supported `[MIN, MAX]` range. */
export function clampTimeoutMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, ms))
}
