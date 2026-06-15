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
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID, loadNotebook, restoreNotebook } from './notebook'
import { drainAutosave, hasLocalChangesAtom, startAutosave } from './autosave'
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

// Generation fence for in-flight opens (review v4 H1/H2). `openNotebookInSlot`
// runs lock-free mutators (account-change reset, two-phase delete) can interleave
// with — they are NOT serialized by `slotOpInFlight` and are triggered
// non-modally (a `userAtom` subscription, a 401 session-expiry). `runExclusive`
// only guards open-vs-open. So an open parked at its lazy GET could resolve AFTER
// such a mutator cleared the slot and re-adopt the previous owner's / a just-
// deleted notebook. Every reset/delete bumps this counter; an open captures it
// before its first await and re-checks after each await, bailing (`superseded`)
// instead of re-adopting a stale target.
let slotGeneration = 0

/**
 * Invalidate any in-flight `openNotebookInSlot` (review v4 H1/H2). Called by the
 * lock-free slot mutators (account-change reset, notebook delete) BEFORE they
 * clear/replace the slot, so an open that started earlier bails on its next
 * post-await re-check instead of re-adopting a now-stale notebook id + content.
 */
export function bumpSlotGeneration(): void {
  slotGeneration += 1
}

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
function raceWithTimeout<T>(promise: Promise<T>, what: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Cancel the underlying work where possible (M3: abort a hung GET) so it
      // does not leak a detached request; the lock is freed by the rejection.
      onTimeout?.()
      reject(new SlotTimeoutError(what))
    }, SLOT_OP_TIMEOUT_MS)
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
  const notebookId = activeNotebookIdAtom()
  if (notebookId === LOCAL_NOTEBOOK_ID) {
    console.warn('slot: refusing to bind autosave/remoteSync to the legacy floor id')
    return
  }
  // Order matches boot: autosave first so its synchronous subscribe observes the
  // just-loaded content (its "skip first emit" guard then avoids a redundant save),
  // then remote-sync, then optional persisted AI context.
  autosaveTeardown = startAutosave()
  remoteTeardown = startRemoteSync(notebookId)
  aiTeardown = aiContextModeAtom() === 'persisted' ? startAiContextSync(notebookId) : null
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
    console.warn('slot: re-arm failed mid-switch; degrading to the feature-demo floor', error)
    try {
      // LOCAL_NOTEBOOK_ID triggers loadNotebook's per-user demo-id resolution.
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
 * Reset the visible editor slot when the signed-in owner changes (#135).
 *
 * This is an account-boundary safety valve, not a device wipe (#136): it clears
 * the in-memory slot away from the previous owner's backend notebook and re-arms
 * bindings on the feature-demo floor, while leaving IndexedDB records intact.
 */
export const resetSlotToFloorForAccountChange = action(async (): Promise<void> => {
  // Invalidate any in-flight open BEFORE touching the slot (H1): its post-await
  // tail then bails (`superseded`) instead of re-adopting the previous owner's
  // notebook after we reset to the floor — the cross-account leak guard.
  bumpSlotGeneration()
  try {
    // Flush the outgoing (previous owner's) pending edit to its own local id
    // before tearing bindings down (H3): autosave teardown cancels the pending
    // debounce, so skipping the drain drops the last in-memory edit. Best-effort
    // + bounded: a wedged/failed drain must never block an account-boundary reset
    // (it leaves local data intact — not a device wipe, that is #136).
    try {
      await wrap(raceWithTimeout(wrap(drainAutosave()), 'drainAutosave (account reset)'))
    } catch (drainError) {
      console.warn('slot: draining before the account-change reset failed; continuing', drainError)
    }
    stopBindings()
    // LOCAL_NOTEBOOK_ID triggers loadNotebook's per-user demo-id resolution, so
    // the floor becomes THIS owner's deterministic demo notebook.
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    await wrap(loadNotebook())
    startBindings()
    slotOpenErrorAtom.set(null)
  } catch (error) {
    console.error('slot: failed to reset to the local floor after account change', error)
    try {
      startBindings()
    } catch (rearmError) {
      console.error('slot: failed to re-arm after account-change reset failure', rearmError)
    }
  }
}, 'notebook.resetSlotToFloorForAccountChange')

/**
 * Degrade the slot back to the local welcome-seed floor (#135). Called when the
 * notebook currently open in the slot is deleted: leaving the slot on the deleted
 * id would let autosave/remote-sync recreate it. Drains the outgoing notebook's
 * pending save, points the slot at `DEMO_NOTEBOOK_ID`, reloads it from storage
 * (re-seeding the feature-demo notebook if absent) and re-arms the bindings on the
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
    // `loadNotebook` reads the active id, so flip to the demo floor id before loading.
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

// ---------------------------------------------------------------------------
// Two-phase active-notebook delete (review v2 H1 + H2)
// ---------------------------------------------------------------------------
// Deleting the notebook open in the slot must not (H1) let an in-flight push /
// autosave recreate the id during the server DELETE, and must not (H2) let a
// post-commit slot failure roll the committed DELETE back. So the delete action
// drives three phases around its own server request:
//   1. `quiesceActiveSlot()`  — BEFORE the DELETE: flush + stop id-bound bindings
//      (the id is NOT flipped, so the slot can be restored if the DELETE fails).
//   2. the server DELETE (owned by the delete action).
//   3a. on failure → `restoreActiveSlotBindings()` re-arms on the same id.
//   3b. on success → `settleDeletedSlotToFloor()` degrades to the floor, BEST-EFFORT
//       (never throws), so a committed DELETE is never rolled back.
//
// These run WITHOUT `runExclusive`: the delete action is serialized with itself by
// `withTransaction`, and the destructive request must never be skipped because the
// switch lock happens to be held. A concurrent open is prevented in practice by the
// modal, non-dismissable delete dialog (review M4, accepted residual).

/** Phase 1: flush the pending save and stop the id-bound bindings before a delete. */
export const quiesceActiveSlot = action(async (): Promise<void> => {
  await wrap(raceWithTimeout(wrap(drainAutosave()), 'drainAutosave (delete)'))
  stopBindings()
}, 'notebook.quiesceActiveSlot')

/** Phase 3a: the DELETE failed — re-arm bindings on the still-active id. */
export const restoreActiveSlotBindings = action((): void => {
  startBindings()
}, 'notebook.restoreActiveSlotBindings')

/**
 * Phase 3b: the DELETE committed — degrade the slot to the feature-demo floor.
 * BEST-EFFORT: any failure is logged, never thrown, so the surrounding
 * `withTransaction` delete action cannot roll back a delete that already
 * succeeded server-side (H2). `rearmOrDegrade` guarantees the slot ends bound.
 */
export const settleDeletedSlotToFloor = action(async (): Promise<void> => {
  try {
    await wrap(
      rearmOrDegrade(async () => {
        activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
        await wrap(loadNotebook())
      }),
    )
  } catch (error) {
    console.error(
      'slot: settling to the floor after a delete failed; slot may need a reload',
      error,
    )
  }
}, 'notebook.settleDeletedSlotToFloor')

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
 *   - `superseded` — an account-change reset / delete invalidated this open
 *                    mid-flight (generation fence, H1/H2); the slot was left to
 *                    that mutator. The sidebar must NOT navigate on this.
 */
export type OpenOutcome = 'opened' | 'already' | 'busy' | 'unavailable' | 'error' | 'superseded'

/** Last open-into-slot failure, for the UI to surface; cleared on a successful open. */
export const slotOpenErrorAtom = atom<string | null>(null, 'notebook.slotOpenError')

export type SlotOpeningPhase = 'idle' | 'local-first' | 'remote-only'

/**
 * UI-visible GET/pull state for open-into-slot. Remote-sync owns push status;
 * this atom covers the stale-while-revalidate fetch that happens when the user
 * clicks a notebook in the sidebar.
 */
export const slotOpeningPhaseAtom = atom<SlotOpeningPhase>('idle', 'notebook.slotOpeningPhase')

async function fetchServerNotebook(id: string): Promise<notebookApi.Notebook | undefined> {
  const fetchAbort = new AbortController()
  try {
    return await wrap(
      raceWithTimeout(wrap(notebookApi.get(id, fetchAbort.signal)), 'notebook fetch', () =>
        fetchAbort.abort(),
      ),
    )
  } catch (error) {
    console.warn('slot: failed to fetch notebook; falling back to a local copy', error)
    return undefined
  }
}

/**
 * Re-point the slot to `stored` (drain the outgoing edits, tear bindings down,
 * flip + re-arm). Fenced by `expectedGeneration` (H1/H2): the binding flip happens
 * AFTER `await drainAutosave()`, during which a lock-free reset/delete can land and
 * already own the slot. Re-checking the captured generation immediately after the
 * drain — before `stopBindings()` — makes a superseded open bail WITHOUT clobbering
 * that mutator's slot. Returns `false` if it bailed (caller maps to `superseded`).
 */
async function openResolvedNotebook(
  stored: NotebookJSON,
  expectedGeneration: number,
): Promise<boolean> {
  await wrap(raceWithTimeout(wrap(drainAutosave()), 'drainAutosave (open)'))
  // The drain is the widest await inside the flip; a lock-free mutator that ran
  // during it bumped the generation and now owns the slot. Bail before touching
  // bindings so we don't re-adopt the previous owner's / a just-deleted notebook.
  if (expectedGeneration !== slotGeneration) return false
  stopBindings()
  await wrap(rearmOrDegrade(() => restoreNotebook(stored)))
  return true
}

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

  // Capture the slot generation before any await: a lock-free reset/delete that
  // runs while we await bumps it, and each post-await re-check below then bails
  // (`superseded`) instead of re-adopting a now-stale notebook (H1/H2).
  const myGeneration = slotGeneration
  let outcome: OpenOutcome = 'error'
  const ran = await runExclusive('open', async () => {
    try {
      const local = await wrap(notebookStorage.get(id))
      if (myGeneration !== slotGeneration) {
        outcome = 'superseded'
        return
      }
      slotOpeningPhaseAtom.set(local ? 'local-first' : 'remote-only')

      if (local) {
        if (!(await wrap(openResolvedNotebook(local, myGeneration)))) {
          outcome = 'superseded'
          return
        }
        outcome = 'opened'
        slotOpenErrorAtom.set(null)
      }

      // Stale-while-revalidate: a local copy opens immediately; the GET continues
      // under the same slot op and status UI. If the server version is accepted and
      // changes the stored document, reload the slot from storage. Dirty local docs
      // are preserved by `pullServerNotebook` and therefore re-read unchanged.
      const server = await wrap(fetchServerNotebook(id))
      // The GET is the widest await window; bail before pulling/re-adopting if a
      // reset/delete landed meanwhile (H1/H2). The local-first open above is left
      // for that mutator's teardown-first re-arm to supersede.
      if (myGeneration !== slotGeneration) {
        outcome = 'superseded'
        return
      }
      if (server) await wrap(pullServerNotebook(server))

      const target = await wrap(notebookStorage.get(id))
      if (!target) {
        console.warn('slot: could not load the notebook; keeping the current slot')
        slotOpenErrorAtom.set('Could not open the notebook. Check your connection and try again.')
        outcome = local ? 'opened' : 'unavailable'
        return
      }

      // Final guard before re-adopting the resolved target (a reset/delete may
      // have landed during the pull + read-back).
      if (myGeneration !== slotGeneration) {
        outcome = 'superseded'
        return
      }
      // Re-open only if the pull actually changed the stored document. Skip the
      // wholesale re-adopt when the editor has unsaved in-memory edits for this id
      // (M1/A3): the local-first open already showed them, and `restoreNotebook`
      // would clobber a keystroke typed inside the pull window. Autosave/remote-
      // sync reconcile it next, mirroring remoteSync.applyServerBaseline's guard.
      const dirtyInEditor = id === activeNotebookIdAtom() && hasLocalChangesAtom()
      if ((!local || target.updatedAt !== local.updatedAt) && !dirtyInEditor) {
        if (!(await wrap(openResolvedNotebook(target, myGeneration)))) {
          outcome = 'superseded'
          return
        }
      }
      slotOpenErrorAtom.set(null)
      outcome = 'opened'
    } catch (error) {
      // M2: contain ALL throws at the op boundary so the documented `'error'`
      // outcome is real (not dead code) and the sidebar never sees an unhandled
      // rejection. Reachable throws: a drain-timeout `SlotTimeoutError`, a
      // `NewerFormatError` from storage.get, a rearm double-failure rethrow.
      console.warn('slot: open failed', error)
      slotOpenErrorAtom.set('Could not open the notebook. Please try again.')
      outcome = 'error'
    } finally {
      slotOpeningPhaseAtom.set('idle')
    }
  })
  if (!ran) return 'busy'
  return outcome
}, 'notebook.openInSlot')
