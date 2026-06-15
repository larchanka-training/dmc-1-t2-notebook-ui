import { action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode, notebookTitleAtom } from './notebook'
import { enterEdit, focusCell } from './cellMode'

export const cloudGenerateAndInsertCodeAction = action(async (cellId: string) => {
  const cell = cellsAtom().find((c) => c.id === cellId)
  if (!cell) return

  const prompt = cell.code()
  if (!prompt.trim()) return

  const cells = cellsAtom()
  const idx = cells.findIndex((c) => c.id === cellId)
  const contextCells: llm.LlmContextCell[] = cells
    .slice(Math.max(0, idx - 10), idx)
    .map((c) => ({ kind: c.kind === 'code' ? 'code' : 'text', source: c.code() }))

  // Pre-capture before the async boundary — clearStack() drops context after await.
  const insertResult = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })

  const response = await wrap(
    llm.generateCode({
      prompt,
      context: contextCells,
      notebookTitle: notebookTitleAtom() || undefined,
      language: 'javascript',
    }),
  )

  insertResult(response.content)
}, 'notebook.cells.cloudGenerate').extend(withAsync())
