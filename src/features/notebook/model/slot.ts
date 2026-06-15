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

import { action, atom, wrap } from '@reatom/core'
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

// Serializes every operation that tears down and re-arms the bindings
// (`openNotebookInSlot`, `degradeSlotToFloor`): they must never interleave, or two
// `startBindings()` would run without an intervening `stopBindings` and leak
// subscriptions (CL-1/CL-2). A single shared lock instead of a per-entry flag.
let slotOpInFlight = false

/** Deadline for a slot switch's awaits (drain + lazy GET) so a wedged save / hung
 *  fetch cannot strand the lock forever (CL-3). */
const SLOT_OP_TIMEOUT_MS = 15_000

class SlotTimeoutError extends Error {
  constructor(what: string) {
    super(`slot: ${what} timed out after ${SLOT_OP_TIMEOUT_MS}ms`)
    this.name = 'SlotTimeoutError'
  }
}

/**
 * Race `promise` against a deadline so a wedged save / hung fetch cannot strand
 * the slot lock forever (CL-3). The underlying work is not cancelled (best-effort
 * liveness): the timeout only lets the lock release so the slot stays switchable.
 *
 * Deliberately NOT `async` and does NOT `await` internally. Reatom's invariant in
 * this codebase is that every awaited promise is `await wrap(promise)`; an extra
 * unwrapped `await` (which `Promise.race` inside an `async` helper introduces)
 * drops the async stack and makes the next atom write throw `missing async stack`.
 * Callers therefore do `await wrap(raceWithTimeout(...))`, keeping one wrapped
 * await with no detached continuation in between.
 */
function raceWithTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SlotTimeoutError(what)), SLOT_OP_TIMEOUT_MS)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * Start the id-dependent bindings for the notebook currently in the slot.
 * Idempotent / teardown-first (CL-1): always stops any live bindings before
 * re-arming, so a repeated call cannot leave the previous autosave / remote-sync /
 * AI-context bindings running alongside the new ones.
 */
function startBindings(): void {
  stopBindings()
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
 * Re-point the slot to a loaded document and re-arm bindings, guarding the
 * teardown→flip→re-arm window (CL-2): if any step throws, the slot is degraded to
 * the local floor instead of being left permanently unbound (autosave + remote-sync
 * down for the session with a normal-looking UI). `flip` performs the id change
 * (`restoreNotebook` for a target, or the floor reset).
 */
async function rearmOrDegrade(flip: () => void | Promise<void>): Promise<void> {
  try {
    // Reatom: if `flip` is async, re-bind the stack with `wrap` so the atom reads
    // in `startBindings()` run IN-FRAME. A bare `await flip()` drops the async
    // stack and makes `startBindings`/`activeNotebookIdAtom.set` throw
    // `missing async stack` under production `clearStack()`. A sync `flip`
    // (restoreNotebook) needs no await — `startBindings` then runs synchronously.
    const pending = flip()
    if (pending instanceof Promise) await wrap(pending)
    startBindings()
  } catch (error) {
    console.warn('slot: re-arm failed mid-switch; degrading to the local floor', error)
    try {
      activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
      await wrap(loadNotebook())
      startBindings()
    } catch (degradeError) {
      // Last resort: re-arm on whatever id is active so persistence/sync are not
      // silently dead, then surface the failure.
      console.error('slot: degrade-to-floor also failed; re-arming on the active id', degradeError)
      startBindings()
      throw degradeError
    }
    throw error
  }
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
 * id would let autosave/remote-sync recreate it. Drains the outgoing notebook's
 * pending save, points the slot at `LOCAL_NOTEBOOK_ID`, reloads it from storage
 * (re-seeding the welcome notebook if absent) and re-arms the bindings on the
 * floor id.
 *
 * Goes through the shared slot lock (CL-1) so it cannot interleave with an
 * `openNotebookInSlot`, and through `rearmOrDegrade` (CL-2) so a mid-switch throw
 * cannot leave the slot unbound. Drains autosave first (CL-4) so a delete of the
 * open notebook does not drop a pending edit.
 */
export const degradeSlotToFloor = action(async (): Promise<void> => {
  await runExclusive('degrade', async () => {
    // Flush the outgoing notebook's pending edit under its own (still-active) id
    // before tearing anything down. Bounded so a wedged save cannot strand the lock.
    await wrap(raceWithTimeout(wrap(drainAutosave()), 'drainAutosave (degrade)'))
    stopBindings()
    // `loadNotebook` reads the active id, so flip to the floor id before loading.
    // `wrap` keeps the post-await continuation in-frame (invariant: every awaited
    // promise is `await wrap(...)`), even though nothing reads an atom after it here.
    await wrap(
      rearmOrDegrade(async () => {
        activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
        await wrap(loadNotebook())
      }),
    )
  })
}, 'notebook.degradeSlotToFloor')

/**
 * Run `op` under the shared slot lock. If the lock is held, the caller is told via
 * `false` (open returns a distinct outcome; degrade simply skips — a concurrent
 * switch is already re-establishing a valid slot). The lock is always released.
 */
async function runExclusive(label: 'open' | 'degrade', op: () => Promise<void>): Promise<boolean> {
  if (slotOpInFlight) {
    console.warn(`slot: a slot operation is already in progress; ignoring concurrent ${label}`)
    return false
  }
  slotOpInFlight = true
  try {
    // `wrap` re-binds the Reatom frame across `op`'s boundary so this helper's
    // continuation (and the outer action's continuation after `await runExclusive`)
    // runs in-frame under production `clearStack()` (invariant: `await wrap(x)`).
    await wrap(op())
    return true
  } finally {
    slotOpInFlight = false
  }
}

/**
 * Outcome of an open-into-slot attempt, so the caller (sidebar) can gate
 * navigation and surface feedback instead of fire-and-forget (CL-5):
 *   - `opened`     — the slot now holds `id`.
 *   - `already`    — `id` was already the active slot.
 *   - `busy`       — another slot op is in flight; nothing changed.
 *   - `unavailable`— fetch failed / payload rejected / storage miss; slot kept.
 *   - `error`      — an unexpected throw; slot kept or safely degraded.
 */
export type OpenOutcome = 'opened' | 'already' | 'busy' | 'unavailable' | 'error'

/** Last open-into-slot failure, for the UI to surface; cleared on a successful open. */
export const slotOpenErrorAtom = atom<string | null>(null, 'notebook.slotOpenError')

/**
 * Open a notebook from the sidebar list into the single editor slot. Loads the
 * full document — from local storage if present, otherwise via ONE lazy
 * `GET /notebooks/{id}` reconciled through the accept-server-version pull rule —
 * then switches the slot to it.
 *
 * Safety order (research §5.1), all under the shared slot lock (CL-1) and the
 * re-arm guard (CL-2):
 *   1. Resolve the target document BEFORE touching the live slot, so a network
 *      failure leaves the working slot intact.
 *   2. Drain autosave (flush pending + await in-flight) so the OUTGOING notebook's
 *      edits persist under its own id — the active id has not changed yet.
 *   3. Tear the bindings down (remote-sync teardown aborts an in-flight push).
 *   4. `restoreNotebook` loads the target and points the slot id at it.
 *   5. Re-arm the bindings on the new id.
 *
 * Returns an `OpenOutcome`; the awaits (drain + lazy GET) are bounded so a wedged
 * save / hung fetch cannot strand the lock (CL-3).
 */
export const openNotebookInSlot = action(async (id: string): Promise<OpenOutcome> => {
  if (id === activeNotebookIdAtom()) return 'already'

  let outcome: OpenOutcome = 'error'
  const ran = await runExclusive('open', async () => {
    // 1. ALWAYS fetch the server version first so a click picks up edits made on
    //    another device (the user's #1 concern: a stale local copy must not win).
    //    `pullServerNotebook` reconciles it under the conflict rule — it accepts
    //    the server doc only when the local copy is clean/absent and KEEPS a
    //    locally-dirty copy (its unsynced edits push first). If the fetch fails
    //    (offline / 5xx) we fall back to whatever is in local storage, so an
    //    already-downloaded notebook still opens offline.
    let server: notebookApi.Notebook | undefined
    try {
      server = await wrap(raceWithTimeout(wrap(notebookApi.get(id)), 'notebook fetch'))
    } catch (error) {
      console.warn('slot: failed to fetch notebook; falling back to a local copy', error)
    }
    if (server) {
      // accept-server-if-clean (keeps a dirty local copy); ignores the outcome —
      // we read the reconciled document back from storage next either way.
      await wrap(pullServerNotebook(server))
    }
    const target = await wrap(notebookStorage.get(id))
    if (!target) {
      // No server doc (offline / rejected payload) AND no local copy → cannot open.
      // Leave the working slot untouched rather than blank the editor.
      console.warn('slot: could not load the notebook; keeping the current slot')
      slotOpenErrorAtom.set('Could not open the notebook. Check your connection and try again.')
      outcome = 'unavailable'
      return
    }
    const loaded = target

    // 2. Persist the outgoing notebook's pending edits under its own (still-active)
    //    id, and wait for any in-flight write to land. Bounded (CL-3).
    await wrap(raceWithTimeout(wrap(drainAutosave()), 'drainAutosave (open)'))
    // 3. Drop the outgoing bindings; remote-sync teardown aborts an in-flight push.
    stopBindings()
    // 4+5. Flip to the target and re-arm; a mid-switch throw degrades to the floor
    //      rather than leaving the slot unbound (CL-2).
    // `wrap` re-binds the frame so `slotOpenErrorAtom.set(null)` below runs
    // IN-FRAME. A bare `await rearmOrDegrade(...)` drops the async stack and makes
    // the next atom write throw `missing async stack` under production clearStack().
    await wrap(rearmOrDegrade(() => restoreNotebook(loaded)))
    slotOpenErrorAtom.set(null)
    outcome = 'opened'
  })
  if (!ran) return 'busy'
  return outcome
}, 'notebook.openInSlot')
