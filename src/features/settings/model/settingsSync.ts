import { wrap } from '@reatom/core'
import { userAtom } from '@/entities/session'
import {
  modelIdAtom,
  autoLoadModelAtom,
  loadModelAction,
  AVAILABLE_MODELS,
} from '@/features/web-llm'
import { inBrowserMaxTokensAtom, thinkTokenBudgetAtom } from '@/features/notebook'
import { displayNameAtom } from './settings'
import {
  DEFAULT_USER_SETTINGS,
  ensureUserSettings,
  writeUserSettings,
  type UserSettings,
} from './userSettings'

// Per-user settings sync (TARDIS-181). Owns the seam between the 5 in-memory
// settings atoms and their persisted, user-namespaced records (`settings:<id>`):
//   - on sign-in: load (or create-with-defaults) the user's record and apply it
//     to the atoms; auto-load the model if the user opted in;
//   - on edit: write the changed atom back to the CURRENT user's record;
//   - on sign-out: reset the atoms to defaults so the next user / the login
//     screen never shows the previous account's values.
//
// Started once from `app/model/setup.ts` (like `startThemeSync`).

// Snapshot the live atoms into a settings record (the persisted shape).
function snapshot(): UserSettings {
  return {
    displayName: displayNameAtom(),
    modelId: modelIdAtom(),
    autoLoadModel: autoLoadModelAtom(),
    inBrowserMaxTokens: inBrowserMaxTokensAtom(),
    thinkTokenBudget: thinkTokenBudgetAtom(),
  }
}

// Push a settings record onto the live atoms. Used on sign-in (load) and
// sign-out (defaults).
function apply(s: UserSettings): void {
  displayNameAtom.set(s.displayName)
  modelIdAtom.set(s.modelId)
  autoLoadModelAtom.set(s.autoLoadModel)
  inBrowserMaxTokensAtom.set(s.inBrowserMaxTokens)
  thinkTokenBudgetAtom.set(s.thinkTokenBudget)
}

/**
 * Start the per-user settings sync. Returns an unsubscribe handle that detaches
 * the user subscription and all five atom write-back subscriptions.
 */
export function startSettingsSync(): () => void {
  // The id of the user whose record the atom write-backs target. null while
  // signed out → writes are suppressed (the login screen's defaults are not
  // anyone's settings). Set on sign-in, cleared on sign-out.
  let currentUserId: string | null = null
  // Echo guard: while `apply()` writes the atoms on sign-in/out, the write-back
  // subscriptions must NOT persist those programmatic sets back (they'd just
  // rewrite what we just read, and could clobber the record mid-apply).
  let applying = false

  const applyRecord = (s: UserSettings) => {
    applying = true
    try {
      apply(s)
    } finally {
      applying = false
    }
  }

  // React to sign-in / sign-out / account switch. Wrapped so the async
  // `loadModelAction()` it may trigger carries a Reatom frame under
  // clearStack() (same pattern as startNotebookListSync).
  const stopUser = userAtom.subscribe(
    wrap((user) => {
      const userId = user?.id ?? null
      if (userId === currentUserId) return
      currentUserId = userId

      if (userId === null) {
        // Signed out: clear the atoms so the next account / login screen starts
        // from defaults, never the previous user's values.
        applyRecord({ ...DEFAULT_USER_SETTINGS })
        return
      }

      // Signed in: load the user's record, creating it with defaults on first
      // sign-in (immediate write, not deferred to a first edit).
      const settings = ensureUserSettings(userId)
      applyRecord(settings)

      // Honour the per-user auto-load preference now that the record is applied.
      // Best-effort: loadModelAction owns its own progress/error + sequence
      // guard; gate on a valid catalogue id so a coerced default can't misfire.
      if (settings.autoLoadModel && AVAILABLE_MODELS.includes(settings.modelId)) {
        void loadModelAction()
      }
    }),
  )

  // Persist any settings change to the CURRENT user's record. One handler per
  // atom; all skip while signed out (no namespace) or mid-apply (echo).
  const persist = () => {
    if (applying || currentUserId === null) return
    writeUserSettings(currentUserId, snapshot())
  }
  const stops = [
    displayNameAtom.subscribe(persist),
    modelIdAtom.subscribe(persist),
    autoLoadModelAtom.subscribe(persist),
    inBrowserMaxTokensAtom.subscribe(persist),
    thinkTokenBudgetAtom.subscribe(persist),
  ]

  return () => {
    stopUser()
    stops.forEach((stop) => stop())
  }
}
