import { atom, action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import type { LlmContextCell } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { buildNotebookContext, contextToPromptBlock } from './context-ai/contextBuilder'
import { aiContextModeAtom } from './context-ai/aiContextMode'
import { assembleGenerationContext, whenContextReady } from './context-ai/aiContext'
import {
  startThinkingAction,
  updateThinkingAction,
  finishThinkingAction,
  failThinkingAction,
} from './inBrowserThinking'

// Generation budget for the In-browser tier (TARDIS-168), shared by the bridge
// (enforces it) and the thinking UI (shows the counter denominator). WebLLM
// streams one decode-step per chunk, so counting chunks == counting generated
// tokens. `IN_BROWSER_MAX_TOKENS` is the hard backstop; once a reasoning model's
// chain-of-thought passes `IN_BROWSER_THINK_TOKEN_BUDGET` without emitting any
// code, the run is a degenerate loop and is aborted.
export const IN_BROWSER_MAX_TOKENS = 2048
export const IN_BROWSER_THINK_TOKEN_BUDGET = 1024

// Result of one in-browser generation. Reasoning models (DeepSeek-R1-Distill)
// emit a `<think>…</think>` stream before the code; the bridge splits it so the
// notebook only ever inserts `code`, surfaces `thinking` live, and can refuse to
// insert when the model never produced runnable code (TARDIS-168).
export interface InBrowserGenerateResult {
  /** The final code after reasoning, ready to insert (empty when none). */
  code: string
  /** The chain-of-thought text, for the live "thinking" UI. */
  thinking: string
  /** True when no usable code was produced (still-thinking / degenerate / empty). */
  incomplete: boolean
}

/** Live progress emitted per streamed chunk: reasoning text + generated tokens. */
export interface InBrowserProgress {
  /** Cumulative chain-of-thought text so far. */
  thinking: string
  /** Number of tokens generated so far (one decode-step per stream chunk). */
  tokens: number
}

/**
 * In-browser generator contract. `onProgress` (when provided) is called per
 * streamed chunk with the cumulative reasoning text and token count — the caller
 * MUST pass a Reatom-`wrap`ped callback, since it fires across async
 * (`for await`) boundaries.
 */
export type InBrowserGenerator = (
  prompt: string,
  onProgress?: (progress: InBrowserProgress) => void,
) => Promise<InBrowserGenerateResult>

// Dependency-injection slot: set by external code (pages/notebook) when a
// local LLM engine is available. null means no in-browser generator is loaded.
export const codeGeneratorAtom = atom<InBrowserGenerator | null>(null, 'notebook.codeGenerator')

// Display-only mirror of the loaded model's id (TARDIS-167, review PR #88 r2).
// The SINGLE SOURCE OF TRUTH lives in `features/web-llm` (`loadedModelIdAtom`,
// set inside `loadModelAction`). This notebook-side slot is filled ONLY by the
// bridge in `pages/notebook` (the layer allowed to import both features), so
// `NotebookHeader` can read the model name WITHOUT a forbidden cross-feature
// import. null = no model loaded.
export const loadedModelDisplayAtom = atom<string | null>(null, 'notebook.loadedModelDisplay')

export const generateAndInsertCodeAction = action(async (cellId: string) => {
  const generator = codeGeneratorAtom()
  if (!generator) return

  const cell = cellsAtom().find((c) => c.id === cellId)
  if (!cell) return

  const prompt = cell.code()
  if (!prompt.trim()) return

  // Assemble notebook context (Epic 07 / #116) — cells ABOVE this prompt cell,
  // §4.3 — and prepend it to the prompt so the model sees the surrounding cells
  // / declared globals.
  // - 'persisted' mode: flush any pending async persist, then use the
  //   incrementally-maintained working model (cell-aware, with live outputs).
  //   It is kept in sync locally on every action, so this never regenerates from
  //   scratch. Falls back to a fresh build only if the cache is not seeded yet.
  // - 'at-send' mode (default): build it now from the cells above this one.
  let contextItems: LlmContextCell[]
  if (aiContextModeAtom() === 'persisted') {
    await wrap(whenContextReady())
    const working = assembleGenerationContext(cellId)
    contextItems =
      working.length > 0 ? working : buildNotebookContext(cellsAtom(), { beforeCellId: cellId })
  } else {
    contextItems = buildNotebookContext(cellsAtom(), { beforeCellId: cellId })
  }
  const contextBlock = contextToPromptBlock(contextItems)
  const fullPrompt = contextBlock ? `${contextBlock}\n\n${prompt}` : prompt

  // Pre-capture Reatom context before the async boundary — same pattern as
  // sendMessageAction. After await wrap(externalPromise), context may be lost.
  const insertResult = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })
  // Live reasoning block anchored right after the prompt cell (TARDIS-168).
  startThinkingAction(cellId)
  const onProgress = wrap((p: { thinking: string; tokens: number }) =>
    updateThinkingAction(p.thinking, p.tokens),
  )
  const finish = wrap(() => finishThinkingAction())
  const fail = wrap(() => failThinkingAction())

  const result = await wrap(generator(fullPrompt, onProgress))
  if (result.incomplete) {
    // Reasoning loop / empty answer: keep the "couldn't generate" notice, insert
    // nothing (a half-baked or empty cell is worse than an explicit failure).
    fail()
    return
  }
  finish()
  insertResult(result.code)
}, 'notebook.cells.generateAndInsert').extend(withAsync())
