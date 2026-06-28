import { atom, action, computed, wrap, withLocalStorage } from '@reatom/core'
import { withAsync } from '@reatom/core'
import type { LlmContextCell } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { buildNotebookContext, contextToPromptBlock } from './context-ai/contextBuilder'
import { aiContextModeAtom } from './context-ai/aiContextMode'
import { assembleGenerationContext, whenContextReady } from './context-ai/aiContext'
import { runInBrowserGeneration } from './inBrowserThinking'

// Generation budget for the In-browser tier (TARDIS-168), shared by the bridge
// (enforces it) and the thinking UI (shows the counter denominator). WebLLM
// streams one decode-step per chunk, so counting chunks == counting generated
// tokens. `IN_BROWSER_MAX_TOKENS` is the hard backstop; once a reasoning model's
// chain-of-thought passes `IN_BROWSER_THINK_TOKEN_BUDGET` without emitting any
// code, the run is a degenerate loop and is aborted.
export const IN_BROWSER_MAX_TOKENS = 4096
export const IN_BROWSER_THINK_TOKEN_BUDGET = 2048

// User-tunable overrides for the two budgets above (TARDIS-181). The constants
// stay as the DEFAULTS; these persisted atoms let the Settings page raise/lower
// them per device. Bounds keep a hand-edited localStorage value (or a bad
// Settings input) from disabling generation (0) or asking for an absurd run.
export const MIN_IN_BROWSER_MAX_TOKENS = 256
export const MAX_IN_BROWSER_MAX_TOKENS = 8192
export const MIN_THINK_TOKEN_BUDGET = 256
export const MAX_THINK_TOKEN_BUDGET = 8192

// Round + clamp an arbitrary value into `[min, max]`; a non-finite value (NaN
// from a cleared input, a garbage persisted record) falls back to the default.
function clampTokenBudget(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

// Raw, user-facing settings (bound to the Settings inputs, persisted as-is so a
// half-typed value isn't fought by the field). Generation never reads these
// directly — it reads the clamped `effective*` views below.
export const inBrowserMaxTokensAtom = atom(
  IN_BROWSER_MAX_TOKENS,
  'notebook.settings.inBrowserMaxTokens',
).extend(withLocalStorage('notebook.settings.inBrowserMaxTokens'))

export const thinkTokenBudgetAtom = atom(
  IN_BROWSER_THINK_TOKEN_BUDGET,
  'notebook.settings.thinkTokenBudget',
).extend(withLocalStorage('notebook.settings.thinkTokenBudget'))

// Clamped views the generation path consumes — always a sane integer in range,
// whatever the persisted/raw atom holds.
export const effectiveMaxTokensAtom = computed(
  () =>
    clampTokenBudget(
      inBrowserMaxTokensAtom(),
      MIN_IN_BROWSER_MAX_TOKENS,
      MAX_IN_BROWSER_MAX_TOKENS,
      IN_BROWSER_MAX_TOKENS,
    ),
  'notebook.settings.effectiveMaxTokens',
)

export const effectiveThinkTokenBudgetAtom = computed(
  () =>
    clampTokenBudget(
      thinkTokenBudgetAtom(),
      MIN_THINK_TOKEN_BUDGET,
      MAX_THINK_TOKEN_BUDGET,
      IN_BROWSER_THINK_TOKEN_BUDGET,
    ),
  'notebook.settings.effectiveThinkTokenBudget',
)

// Sampling defaults for in-browser code generation (TARDIS-168 C2). The bridge
// passes these to every `chat.completions.create`. A prompt alone can't stop a
// small quantised model from collapsing into a self-confirming reasoning loop
// ("looks good. yes, that works. all set." forever) on a trivial task — that is
// a SAMPLING pathology, fixed by penalising repetition. Low temperature keeps
// codegen deterministic; the repetition/frequency penalties break the loop.
export const IN_BROWSER_TEMPERATURE = 0.3
export const IN_BROWSER_REPETITION_PENALTY = 1.15
export const IN_BROWSER_FREQUENCY_PENALTY = 0.7

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
  /**
   * Why the result is incomplete (undefined when `incomplete` is false). Lets
   * the UI show a specific recovery hint instead of one generic message, and
   * gives logs a precise category (TARDIS-168 M2):
   *   - `degenerate`  — reasoning ran past the think budget without emitting code;
   *   - `empty`       — the model produced no code at all;
   *   - `unparseable` — the code does not parse (cut off mid-statement);
   *   - `violations`  — the code uses sandbox-forbidden APIs even after repair.
   */
  reason?: InBrowserIncompleteReason
}

export type InBrowserIncompleteReason = 'degenerate' | 'empty' | 'unparseable' | 'violations'

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

// DI slot for cancelling the active in-browser generation (TARDIS-168). Filled
// by the same bridge as `codeGeneratorAtom` with `engine.interruptGenerate`, so
// the notebook feature can stop a long run WITHOUT a forbidden import of the
// web-llm feature. Calling it makes the generator's `for await` loop end; the
// generator then returns whatever it produced so far (the caller decides whether
// the partial code is usable). null when no engine is loaded.
export const interruptInBrowserAtom = atom<(() => Promise<void>) | null>(
  null,
  'notebook.interruptInBrowser',
)

// Display-only mirror of the loaded model's id (TARDIS-167, review PR #88 r2).
// The SINGLE SOURCE OF TRUTH lives in `features/web-llm` (`loadedModelIdAtom`,
// set inside `loadModelAction`). This notebook-side slot is filled ONLY by the
// bridge in `pages/notebook` (the layer allowed to import both features), so
// `NotebookHeader` can read the model name WITHOUT a forbidden cross-feature
// import. null = no model loaded.
export const loadedModelDisplayAtom = atom<string | null>(null, 'notebook.loadedModelDisplay')

// Per-cell in-browser generation state (TARDIS-168). The `withAsync` action has
// a SINGLE global `.ready()`/`.error()`, so reading those per row made the
// spinner/Stop and the error appear on EVERY markdown cell at once. WebLLM runs
// one generation at a time (a single engine, a global `interruptGenerate`), so
// the "which cell is busy" state is one id, not a Set like the Cloud tier
// (`cloudGeneratingCellIdsAtom`). Errors stay in a Map so a finished cell can
// keep showing its own failure while another cell generates.
export const inBrowserGeneratingCellIdAtom = atom<string | null>(
  null,
  'notebook.cells.inBrowserGeneratingCellId',
)
export const inBrowserGenerateErrorsAtom = atom<Map<string, Error>>(
  new Map(),
  'notebook.cells.inBrowserGenerateErrors',
)

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

  // Toolbar tier: a live reasoning block anchored after the prompt cell, PLUS
  // per-cell busy/error state so the spinner/Stop and any error render only on
  // this row (not on every markdown cell). The shared helper owns the
  // single-flight guard and the start/progress/finish/fail lifecycle; the
  // handlers below are just this tier's side-effects (TARDIS-168 H1).
  await wrap(
    runInBrowserGeneration(generator, fullPrompt, cellId, {
      onStarted: () => {
        inBrowserGenerateErrorsAtom.set((m) => {
          const next = new Map(m)
          next.delete(cellId)
          return next
        })
        inBrowserGeneratingCellIdAtom.set(cellId)
      },
      onInsert: (code) => {
        const newCell = addCell(cellId)
        updateCellCode(newCell.id, code)
        focusCell(newCell.id)
        enterEdit(newCell.id)
      },
      onError: (err) => {
        inBrowserGenerateErrorsAtom.set((m) => {
          const next = new Map(m)
          next.set(cellId, err)
          return next
        })
      },
      onSettled: () => inBrowserGeneratingCellIdAtom.set(null),
    }),
  )
}, 'notebook.cells.generateAndInsert').extend(withAsync())
