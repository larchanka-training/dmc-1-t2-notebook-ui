import { atom, action, wrap } from '@reatom/core'
import {
  IN_BROWSER_MAX_TOKENS,
  interruptInBrowserAtom,
  type InBrowserGenerator,
} from './codeGenerator'

// Live "thinking" session for the In-browser reasoning models (TARDIS-168).
//
// Reasoning models stream a `<think>…</think>` monologue before (sometimes
// instead of) the code. This atom drives a transient block, shown in the
// notebook flow while the model reasons and removed once it produces code.
//
// Positioning mirrors where the generation was triggered:
//   - `afterCellId` set   → render right after that cell (Ask-agent between
//     cells, or a text-cell toolbar generate);
//   - `afterCellId` null  → render at the very end of the notebook (Ask-agent
//     invoked below all cells / on the end inserter).

export type ThinkingPhase = 'thinking' | 'failed'

export interface ThinkingSession {
  /** Cell to anchor the block after; null → render at the end of the notebook. */
  afterCellId: string | null
  /** Cumulative reasoning text streamed so far. */
  thinking: string
  /** Tokens generated so far (one decode-step per stream chunk). */
  tokens: number
  /** Hard token cap for this run — the counter's denominator. */
  maxTokens: number
  /** True once the user clicked Stop — the run is winding down. */
  stopRequested: boolean
  /** `thinking` while the model runs; `failed` when it produced no usable code. */
  phase: ThinkingPhase
}

// Single active session: only one in-browser generation runs at a time. WebLLM
// serves one generation per engine behind a single `interruptGenerate`, so two
// concurrent runs would clobber this session and leave two `create()` calls
// behind one interrupt — leaking the engine lock (TARDIS-168 H1). The UI also
// disables the buttons, but `startThinkingAction` is the model-level guard that
// makes single-flight hold even for a programmatic/racing trigger.
export const thinkingSessionAtom = atom<ThinkingSession | null>(null, 'notebook.inBrowserThinking')

/**
 * Open a fresh thinking block anchored after `afterCellId` (null = end).
 *
 * Single-flight guard: returns `false` WITHOUT touching the session when a run
 * is already active (`phase === 'thinking'`), so the caller can bail before
 * starting a second WebLLM generation. Returns `true` when a new session was
 * opened. A `failed` session is not active and is replaced normally.
 */
export const startThinkingAction = action((afterCellId: string | null): boolean => {
  const current = thinkingSessionAtom()
  if (current && current.phase === 'thinking') return false
  thinkingSessionAtom.set({
    afterCellId,
    thinking: '',
    tokens: 0,
    maxTokens: IN_BROWSER_MAX_TOKENS,
    stopRequested: false,
    phase: 'thinking',
  })
  return true
}, 'notebook.inBrowserThinking.start')

/**
 * User-requested stop (TARDIS-168). Marks the session as stopping and asks the
 * engine to interrupt; the generator's loop then ends and returns whatever code
 * it produced so far (the caller inserts it only if it parses). Idempotent: a
 * second click while already stopping is a no-op.
 */
export const requestStopAction = action(() => {
  const session = thinkingSessionAtom()
  if (!session || session.phase !== 'thinking' || session.stopRequested) return
  thinkingSessionAtom.set({ ...session, stopRequested: true })
  void interruptInBrowserAtom()?.()
}, 'notebook.inBrowserThinking.requestStop')

/** Replace the streamed reasoning text + token count (cumulative values). */
export const updateThinkingAction = action((thinking: string, tokens: number) => {
  const session = thinkingSessionAtom()
  if (!session || session.phase !== 'thinking') return
  thinkingSessionAtom.set({ ...session, thinking, tokens })
}, 'notebook.inBrowserThinking.update')

/** Close the block after a successful insert (no trace left behind). */
export const finishThinkingAction = action(() => {
  thinkingSessionAtom.set(null)
}, 'notebook.inBrowserThinking.finish')

/** Mark the session failed (model produced no runnable code) — keep it visible. */
export const failThinkingAction = action(() => {
  const session = thinkingSessionAtom()
  if (!session) return
  thinkingSessionAtom.set({ ...session, phase: 'failed' })
}, 'notebook.inBrowserThinking.fail')

/** Dismiss a failed block (user acknowledged the "couldn't generate" notice). */
export const dismissThinkingAction = action(() => {
  thinkingSessionAtom.set(null)
}, 'notebook.inBrowserThinking.dismiss')

/** Side-effects the two in-browser entry points (toolbar + Ask-agent) plug in. */
export interface InBrowserRunHandlers {
  /** Insert the produced code into the notebook (run only on success). */
  onInsert: (code: string) => void
  /** Ran once after the single-flight guard passes, before streaming starts
   *  (e.g. mark the originating cell busy). Not called when a run was refused. */
  onStarted?: () => void
  /** Per-cell error sink (toolbar tier). When provided, an engine throw resolves
   *  the block via finish() + onError; when omitted (agent tier), it fails the
   *  block so the failure notice stays visible. */
  onError?: (err: Error) => void
  /** Always ran after a started attempt (success, incomplete, or throw) — e.g.
   *  clear the busy cell id. Not called when the run was refused. */
  onSettled?: () => void
}

/**
 * Run one in-browser generation through the shared thinking lifecycle
 * (TARDIS-168 H1). Single entry point for BOTH the cell toolbar and the
 * Ask-agent dialog so the start/progress/finish/fail/try-catch flow lives in one
 * place and the two paths can't drift.
 *
 * Single-flight: refuses (returns `false`, runs nothing) when a generation is
 * already active, so a racing/programmatic second trigger can't clobber the
 * session or leave two WebLLM `create()` calls behind one `interruptGenerate`.
 *
 * The only intentional asymmetry between the two callers is the error path,
 * expressed by whether `onError` is supplied (see {@link InBrowserRunHandlers}).
 */
export async function runInBrowserGeneration(
  generator: InBrowserGenerator,
  prompt: string,
  afterCellId: string | null,
  handlers: InBrowserRunHandlers,
): Promise<boolean> {
  // Model-level single-flight guard — the real protection, not just disabled UI.
  if (!startThinkingAction(afterCellId)) return false

  // Pre-wrap every callback BEFORE the first await: they fire across the
  // generator's internal async boundaries, where the Reatom context is lost.
  const onProgress = wrap((p: { thinking: string; tokens: number }) =>
    updateThinkingAction(p.thinking, p.tokens),
  )
  const finish = wrap(() => finishThinkingAction())
  const fail = wrap(() => failThinkingAction())
  const insert = wrap(handlers.onInsert)
  const onError = handlers.onError ? wrap(handlers.onError) : undefined
  const settled = handlers.onSettled ? wrap(handlers.onSettled) : undefined

  handlers.onStarted?.()
  try {
    const result = await wrap(generator(prompt, onProgress))
    if (result.incomplete) {
      // No usable code. Distinguish WHY (TARDIS-168): a user-requested Stop is
      // not a model failure — the user chose to abort, so just close the block
      // quietly instead of accusing the model with "couldn't generate runnable
      // code". A genuine degenerate/empty result keeps the failed notice.
      if (thinkingSessionAtom()?.stopRequested) {
        finish()
      } else {
        fail()
      }
      return true
    }
    finish()
    insert(result.code)
    return true
  } catch (err) {
    if (onError) {
      // Toolbar tier: resolve the block, surface a per-cell error on the row.
      finish()
      onError(err as Error)
    } else {
      // Agent tier: keep the failed block visible (no per-cell error channel).
      fail()
    }
    throw err
  } finally {
    settled?.()
  }
}
