import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode, notebookTitleAtom } from './notebook'
import { enterEdit, focusCell } from './cellMode'

// Per-cell tracking so spinner/error appear only on the triggering cell.
export const cloudGeneratingCellIdAtom = atom<string | null>(
  null,
  'notebook.cells.cloudGeneratingCellId',
)
export const cloudGenerateErrorsAtom = atom<Map<string, Error>>(
  new Map(),
  'notebook.cells.cloudGenerateErrors',
)

export const cloudGenerateAndInsertCodeAction = action(async (cellId: string) => {
  const cell = cellsAtom().find((c) => c.id === cellId)
  if (!cell) return

  const prompt = cell.code()
  if (!prompt.trim()) return

  // Clear previous error for this cell and mark it as generating.
  cloudGenerateErrorsAtom.set((m) => {
    const next = new Map(m)
    next.delete(cellId)
    return next
  })
  cloudGeneratingCellIdAtom.set(cellId)

  const cells = cellsAtom()
  const idx = cells.findIndex((c) => c.id === cellId)
  const contextCells: llm.LlmContextCell[] = cells
    .slice(Math.max(0, idx - 10), idx)
    .map((c) => ({ kind: c.kind === 'code' ? 'code' : 'text', source: c.code() }))

  // Pre-capture both callbacks before the async boundary — clearStack() drops context after await.
  const onSuccess = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
    cloudGeneratingCellIdAtom.set(null)
  })
  const onError = wrap((err: Error) => {
    cloudGeneratingCellIdAtom.set(null)
    cloudGenerateErrorsAtom.set((m) => {
      const next = new Map(m)
      next.set(cellId, err)
      return next
    })
  })

  try {
    const response = await wrap(
      llm.generateCode({
        prompt,
        context: contextCells,
        notebookTitle: notebookTitleAtom() || undefined,
        language: 'javascript',
      }),
    )
    onSuccess(response.content)
  } catch (err) {
    onError(err as Error)
    throw err
  }
}, 'notebook.cells.cloudGenerate').extend(withAsync())
