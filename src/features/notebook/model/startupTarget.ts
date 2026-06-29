// Startup-target resolver (TARDIS-183).
//
// Decides, after sign-in, what the app should do — WITHOUT bypassing or
// duplicating `loadNotebook`. The resolver answers two ORTHOGONAL questions and
// returns them; the caller still runs the existing boot sequence
// (`loadNotebook(true)` + `startSlot()`), and only navigates to the dashboard
// on top of the already-armed slot (the same way `/usage` works today):
//
//   • `notebookId` — which id to load into the slot. The user's owned
//     last-opened notebook when it provably belongs to them, else `null` →
//     leave `LOCAL_NOTEBOOK_ID` so `loadNotebook(true)` runs its own
//     pickNewest/seed machinery. The seed/tombstone/legacy-floor logic stays
//     entirely inside `loadNotebook`; the resolver never reaches into it.
//   • `showDashboard` — whether to navigate to the dashboard after the slot is
//     armed. True only when the user's `startView` setting is `'dashboard'`.
//
// The 4 product rules (clean user → seed; `dashboard`; `last-opened`; default)
// fall out of these two fields — see the per-field comments below.
//
// `startView` is read through an INJECTED reader, not directly: the persisted
// value lives in the per-user settings record owned by `app/model`
// (`readUserSettings`), and a feature must not import the app layer. `app`
// installs the real reader on boot via `setStartViewReader`. Reading the
// persisted value (rather than `startViewAtom`) also avoids the async-hydration
// race — the atom may still hold its default while boot/account-switch runs.

import { resolveOwnedLastOpenedId } from './lastOpened'

/** Mirrors `StartView` from `features/settings`, kept local so this feature
 *  does not import a sibling feature. */
export type StartViewChoice = 'dashboard' | 'last-opened'

export interface StartupTarget {
  /** Notebook id to arm the slot on, or `null` to let `loadNotebook` pick the
   *  newest / seed. Never the local floor id (see `resolveOwnedLastOpenedId`). */
  notebookId: string | null
  /** Whether to navigate to the dashboard after the slot is armed. */
  showDashboard: boolean
}

// Injected by `app/model/setup.ts` on boot. Default reproduces the pre-183
// "open a notebook" behaviour, so before injection (or in isolated tests) the
// resolver never spuriously routes to the dashboard.
let startViewReader: () => StartViewChoice = () => 'last-opened'

/**
 * Install the reader the resolver uses to obtain the current user's `startView`
 * setting. Called once from `app/model/setup.ts`, which reads the persisted
 * per-user settings record directly (`readUserSettings`) to dodge the
 * async-hydration race on `startViewAtom`.
 */
export function setStartViewReader(reader: () => StartViewChoice): void {
  startViewReader = reader
}

/**
 * Resolve what to do on startup. Pure of side effects: it neither touches the
 * slot nor reads `notebookListResource` (which would fire a hidden
 * `GET /notebooks`); ownership of the last-opened id is checked against the
 * provable local set (`resolveOwnedLastOpenedId`).
 *
 * Called from BOTH `setup.ts` (boot) and `slot.ts`
 * (`resetSlotToFloorForAccountChange`) so the two paths can never diverge.
 */
export async function resolveStartupTarget(): Promise<StartupTarget> {
  const startView = startViewReader()
  // Arm the slot on the owned last-opened notebook regardless of start view, so
  // returning to the notebook route shows something sensible. `null` (no stored
  // id, or not owned by this user) lets `loadNotebook(true)` pick the newest or
  // seed — which is exactly rule 1 (clean user) and the rule-4 default.
  const notebookId = await resolveOwnedLastOpenedId()
  return { notebookId, showDashboard: startView === 'dashboard' }
}
