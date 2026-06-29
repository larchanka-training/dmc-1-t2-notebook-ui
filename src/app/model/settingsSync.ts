import { isDeepEqual, wrap } from '@reatom/core'
import { userAtom } from '@/entities/session'
import {
  modelIdAtom,
  autoLoadModelAtom,
  loadModelAction,
  cancelModelLoad,
  AVAILABLE_MODELS,
} from '@/features/web-llm'
import { inBrowserMaxTokensAtom, thinkTokenBudgetAtom } from '@/features/notebook'
import { displayNameAtom } from '@/features/settings'
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
// Lives in `app/model` (not `features/settings`) because it is orchestration: it
// composes three features (auth/session, web-llm, notebook) + the settings
// record. Cross-feature wiring belongs to the app layer; a feature must not
// import a sibling feature. Started once from `app/model/setup.ts` (like
// `startThemeSync`).

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
  // The record currently believed to be in storage for `currentUserId`. The
  // write-back guard compares the live snapshot against THIS instead of a
  // synchronous `applying` flag: Reatom atom subscriptions fire ASYNCHRONOUSLY
  // (the tests await a macrotask after each `.set`), so a sync
  // `applying = true … = false` window is already closed by the time `persist`
  // runs — it never actually suppresses the echo. Comparing by value skips the
  // sign-in echo reliably and stays correct even if `apply` later normalises
  // values. Updated on apply (storage == applied record) AND after each write,
  // so reverting an edit back to the stored value still persists correctly.
  let lastSynced: UserSettings | null = null

  const applyRecord = (s: UserSettings) => {
    apply(s)
    lastSynced = snapshot()
  }

  // React to sign-in / sign-out / account switch. Wrapped so the async
  // `loadModelAction()` it may trigger carries a Reatom frame under
  // clearStack() (same pattern as startNotebookListSync).
  const stopUser = userAtom.subscribe(
    wrap((user) => {
      const userId = user?.id ?? null
      if (userId === currentUserId) return
      currentUserId = userId

      // The user changed (sign-in of another account, or sign-out). Invalidate
      // any in-flight / published model load BEFORE applying the new settings,
      // so a slow `loadModelAction` started for the previous account can't
      // resolve later and publish that account's model into this session
      // (TARDIS-181: keeps the loaded engine from bleeding across accounts).
      cancelModelLoad()

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
  // atom; skips while signed out (no namespace). The echo from `applyRecord`'s
  // own `.set`s is skipped by value: if the live snapshot still equals the
  // record we just applied, there is nothing new to write (idempotent).
  const persist = () => {
    if (currentUserId === null) return
    const current = snapshot()
    if (lastSynced !== null && isDeepEqual(current, lastSynced)) return
    writeUserSettings(currentUserId, current)
    lastSynced = current
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
