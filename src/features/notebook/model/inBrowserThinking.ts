import { atom, action } from '@reatom/core'
import { IN_BROWSER_MAX_TOKENS } from './codeGenerator'

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
  /** `thinking` while the model runs; `failed` when it produced no usable code. */
  phase: ThinkingPhase
}

// Single active session: only one in-browser generation runs at a time (the
// toolbar/dialog buttons are disabled while `agent*` actions are pending).
export const thinkingSessionAtom = atom<ThinkingSession | null>(null, 'notebook.inBrowserThinking')

/** Open a fresh thinking block anchored after `afterCellId` (null = end). */
export const startThinkingAction = action((afterCellId: string | null) => {
  thinkingSessionAtom.set({
    afterCellId,
    thinking: '',
    tokens: 0,
    maxTokens: IN_BROWSER_MAX_TOKENS,
    phase: 'thinking',
  })
}, 'notebook.inBrowserThinking.start')

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
