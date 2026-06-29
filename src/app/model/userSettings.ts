import { AVAILABLE_MODELS } from '@/features/web-llm'
import { IN_BROWSER_MAX_TOKENS, IN_BROWSER_THINK_TOKEN_BUDGET } from '@/features/notebook'

// Per-user settings record (TARDIS-181). Stored as one JSON object per user
// under `settings:<userId>`, so two accounts on the same browser keep separate
// preferences. Namespacing by id is what fixes the shared-browser leak (User B
// must not inherit User A's name / model / limits after a sign-out + sign-in).
//
// Only the 5 task settings live here. `downloadedModelIdsAtom` is intentionally
// NOT included — it mirrors the device-global WebLLM Cache Storage shared by
// every user of the browser, so it stays self-persisted in `features/web-llm`.

export interface UserSettings {
  /** Sidebar display name; empty string means "unset" (falls back to email). */
  displayName: string
  /** Default in-browser model id (one of AVAILABLE_MODELS). */
  modelId: string
  /** Auto-load the default model once settings are applied on sign-in. */
  autoLoadModel: boolean
  /** Generation token cap (raw; clamped downstream by `effectiveMaxTokensAtom`). */
  inBrowserMaxTokens: number
  /** Thinking token budget (raw; clamped downstream). */
  thinkTokenBudget: number
}

/** Defaults written immediately on first sign-in when no record exists yet. */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  displayName: '',
  modelId: AVAILABLE_MODELS[1],
  autoLoadModel: false,
  inBrowserMaxTokens: IN_BROWSER_MAX_TOKENS,
  thinkTokenBudget: IN_BROWSER_THINK_TOKEN_BUDGET,
}

/** localStorage key for a given user's settings record. */
export function settingsKey(userId: string): string {
  return `settings:${userId}`
}

// Coerce an arbitrary parsed object into a valid UserSettings, filling each
// field from defaults when missing or the wrong type. A stale `modelId` (a
// model dropped from the catalogue) resets to the default so the picker can't
// be stuck on a phantom id. Numeric limits are kept raw (out-of-range values
// are clamped where generation reads them), but a non-number resets to default.
function coerce(raw: unknown): UserSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const known = new Set<string>(AVAILABLE_MODELS)
  return {
    displayName:
      typeof o.displayName === 'string' ? o.displayName : DEFAULT_USER_SETTINGS.displayName,
    modelId:
      typeof o.modelId === 'string' && known.has(o.modelId)
        ? o.modelId
        : DEFAULT_USER_SETTINGS.modelId,
    autoLoadModel: o.autoLoadModel === true,
    inBrowserMaxTokens:
      typeof o.inBrowserMaxTokens === 'number' && Number.isFinite(o.inBrowserMaxTokens)
        ? o.inBrowserMaxTokens
        : DEFAULT_USER_SETTINGS.inBrowserMaxTokens,
    thinkTokenBudget:
      typeof o.thinkTokenBudget === 'number' && Number.isFinite(o.thinkTokenBudget)
        ? o.thinkTokenBudget
        : DEFAULT_USER_SETTINGS.thinkTokenBudget,
  }
}

/** Read + validate a user's settings, or null when no record exists (or on error). */
export function readUserSettings(userId: string): UserSettings | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(settingsKey(userId))
    if (!raw) return null
    return coerce(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Persist a user's settings record. Best-effort (a full quota throw is swallowed). */
export function writeUserSettings(userId: string, settings: UserSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(settingsKey(userId), JSON.stringify(settings))
  } catch {
    // Storage full / disabled — settings simply don't persist this session.
  }
}

/**
 * Return the user's settings, creating the record with defaults when absent.
 * The create-on-login write is immediate (not deferred to a first edit), so a
 * fresh account always has a concrete record from the moment it signs in.
 *
 * Self-heals storage: `readUserSettings` coerces stale/garbage fields (a
 * phantom `modelId`, a non-numeric limit, a missing/extra field) in memory, and
 * here we write the repaired record back when it differs from the raw stored
 * string — so the record is fixed once, not re-coerced on every sign-in. This
 * keeps the write-back invariant the old `normalizeWebLlmPersistedState` held.
 */
export function ensureUserSettings(userId: string): UserSettings {
  const existing = readUserSettings(userId)
  if (existing === null) {
    const defaults = { ...DEFAULT_USER_SETTINGS }
    writeUserSettings(userId, defaults)
    return defaults
  }
  // `existing` is non-null → localStorage is available (readUserSettings guards
  // it). The canonical serialization of the coerced record differs from the raw
  // stored string exactly when coercion changed something (or the stored JSON
  // had non-canonical key order / extra keys) — rewrite once in that case.
  if (localStorage.getItem(settingsKey(userId)) !== JSON.stringify(existing)) {
    writeUserSettings(userId, existing)
  }
  return existing
}
