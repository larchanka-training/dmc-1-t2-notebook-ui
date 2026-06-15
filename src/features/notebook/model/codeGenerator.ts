import { atom, action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import type { LlmContextCell } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { buildNotebookContext, contextToPromptBlock } from './context-ai/contextBuilder'
import { aiContextModeAtom } from './context-ai/aiContextMode'
import { assembleGenerationContext, whenContextReady } from './context-ai/aiContext'

// Dependency-injection slot: set by external code (pages/notebook) when a
// local LLM engine is available. null means no in-browser generator is loaded.
export const codeGeneratorAtom = atom<((prompt: string) => Promise<string>) | null>(
  null,
  'notebook.codeGenerator',
)

// DI slot: set by the bridge when an engine is loaded; null means no model loaded.
export const loadedModelAtom = atom<string | null>(null, 'notebook.loadedModel')

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

  const code = await wrap(generator(fullPrompt))
  insertResult(code)
}, 'notebook.cells.generateAndInsert').extend(withAsync())
