// Editor slot lifecycle controller (#135). The app shows exactly one notebook at
// a time (the "slot"). Before #135 the slot was pinned to LOCAL_NOTEBOOK_ID and
// its id-dependent bindings (autosave, remote-sync, AI context) were started once
// on boot and never moved. This controller owns those bindings and performs a
// SAFE switch to another notebook (open-into-slot): it persists the outgoing
// notebook's pending edits under its own id, tears the bindings down (aborting an
// in-flight push), loads the target, and re-arms the bindings on the new id.
//
// The hard part is concurrency (research §5.1): if the active id flipped while a
// save/push of the old notebook were still running, those writes would land under
// the new id. The switch sequence below closes that window — drain first, flip
// only after.

import { action, wrap } from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID, loadNotebook, restoreNotebook } from './notebook'
import { drainAutosave, startAutosave } from './autosave'
import { startRemoteSync } from './remoteSync'
import { startAiContextSync } from './context-ai/aiContext'
import { aiContextModeAtom } from './context-ai/aiContextMode'
import { pullServerNotebook } from './pull'

// Live teardown handles for the bindings of the notebook currently in the slot.
// `null` when a binding is not running (AI context only runs in persisted mode).
let autosaveTeardown: (() => void) | null = null
let remoteTeardown: (() => void) | null = null
let aiTeardown: (() => void) | null = null

// Guards against a concurrent switch (e.g. two quick clicks on different rows):
// a switch that tears down and re-arms bindings must not interleave with another.
let switchInFlight = false

/** Start the id-dependent bindings for the notebook currently in the slot. */
function startBindings(): void {
  // Order matches boot: autosave first so its synchronous subscribe observes the
  // just-loaded content (its "skip first emit" guard then avoids a redundant save),
  // then remote-sync, then optional persisted AI context.
  autosaveTeardown = startAutosave()
  remoteTeardown = startRemoteSync(activeNotebookIdAtom())
  aiTeardown =
    aiContextModeAtom() === 'persisted' ? startAiContextSync(activeNotebookIdAtom()) : null
}

/** Tear down the current slot's bindings (remote-sync teardown aborts an in-flight push). */
function stopBindings(): void {
  autosaveTeardown?.()
  autosaveTeardown = null
  remoteTeardown?.()
  remoteTeardown = null
  aiTeardown?.()
  aiTeardown = null
}

/**
 * Start the slot for the notebook already loaded in memory (boot). Called once
 * from app setup AFTER `loadNotebook()` has restored content and set the active
 * id. Replaces the previous one-shot start of the three bindings.
 */
export function startSlot(): void {
  startBindings()
}

/** Stop the slot's bindings. Exposed for teardown symmetry / tests. */
export function stopSlot(): void {
  stopBindings()
}

/**
 * Degrade the slot back to the local welcome-seed floor (#135). Called when the
 * notebook currently open in the slot is deleted: leaving the slot on the deleted
 * id would let autosave/remote-sync recreate it. Points the slot at
 * `LOCAL_NOTEBOOK_ID` and reloads it from storage (re-seeding the welcome notebook
 * if absent), re-arming the bindings on that floor id.
 *
 * The caller (delete action) MUST stop the deleted notebook's bindings before its
 * own per-notebook storage cleanup; this re-arms fresh bindings for the floor.
 */
export const degradeSlotToFloor = action(async (): Promise<void> => {
  stopBindings()
  // Point the slot at the floor id BEFORE loading, since `loadNotebook` reads the
  // active id. `loadNotebook` restores the stored welcome notebook or re-seeds one.
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  await wrap(loadNotebook())
  startBindings()
}, 'notebook.degradeSlotToFloor')

/**
 * Open a notebook from the sidebar list into the single editor slot. Loads the
 * full document — from local storage if present, otherwise via ONE lazy
 * `GET /notebooks/{id}` reconciled through the accept-server-version pull rule —
 * then switches the slot to it.
 *
 * Safety order (research §5.1):
 *   1. Resolve the target document BEFORE touching the live slot, so a network
 *      failure leaves the working slot intact.
 *   2. Drain autosave (flush pending + await in-flight) so the OUTGOING notebook's
 *      edits persist under its own id — the active id has not changed yet.
 *   3. Tear the bindings down (remote-sync teardown aborts an in-flight push).
 *   4. `restoreNotebook` loads the target and points the slot id at it.
 *   5. Re-arm the bindings on the new id.
 */
export const openNotebookInSlot = action(async (id: string): Promise<void> => {
  if (id === activeNotebookIdAtom()) return
  if (switchInFlight) {
    // A switch is mid-flight; ignore the concurrent request rather than interleave
    // two teardown/re-arm sequences. The user can retry once the first settles.
    console.warn('slot: a notebook switch is already in progress; ignoring concurrent open')
    return
  }
  switchInFlight = true
  try {
    // 1. Resolve the document first. Prefer a local copy (no network); only fetch
    //    when absent. A locally-dirty copy is intentionally preferred here too —
    //    the conflict rule keeps it until the next push reconciles with the server.
    let target = await wrap(notebookStorage.get(id))
    if (!target) {
      let server: notebookApi.Notebook
      try {
        server = await wrap(notebookApi.get(id))
      } catch (error) {
        console.warn('slot: failed to fetch notebook; keeping the current slot', error)
        return
      }
      // Accept the server version into storage under the conflict rule, then read
      // it back. (`kept-local-dirty` cannot happen here — no local copy existed.)
      await wrap(pullServerNotebook(server))
      target = await wrap(notebookStorage.get(id))
    }
    if (!target) {
      // Server payload was rejected by the boundary guard, or storage failed.
      // Leave the working slot untouched rather than blank the editor.
      console.warn('slot: could not load the notebook; keeping the current slot')
      return
    }

    // 2. Persist the outgoing notebook's pending edits under its own (still-active)
    //    id, and wait for any in-flight write to land.
    await wrap(drainAutosave())
    // 3. Drop the outgoing bindings; remote-sync teardown aborts an in-flight push.
    stopBindings()
    // 4. Load the target; `restoreNotebook` sets `activeNotebookIdAtom` to its id.
    restoreNotebook(target)
    // 5. Re-arm the bindings on the new id.
    startBindings()
  } finally {
    switchInFlight = false
  }
}, 'notebook.openInSlot')
