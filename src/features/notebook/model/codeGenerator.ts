import { atom, action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { cellsAtom, addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'

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

  // Pre-capture Reatom context before the async boundary — same pattern as
  // sendMessageAction. After await wrap(externalPromise), context may be lost.
  const insertResult = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })

  const code = await wrap(generator(prompt))
  insertResult(code)
}, 'notebook.cells.generateAndInsert').extend(withAsync())
