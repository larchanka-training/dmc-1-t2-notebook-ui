import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { cellsAtom, addCell, updateCellCode, notebookTitleAtom } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { cellKindForLlmResult } from './llmResult'

// Per-cell tracking so concurrent Cloud requests do not clear each other's spinner.
export const cloudGeneratingCellIdsAtom = atom<Set<string>>(
  new Set<string>(),
  'notebook.cells.cloudGeneratingCellIds',
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
  cloudGeneratingCellIdsAtom.set((ids) => new Set(ids).add(cellId))
  const stopGenerating = wrap(() => {
    cloudGeneratingCellIdsAtom.set((ids) => {
      const next = new Set(ids)
      next.delete(cellId)
      return next
    })
  })

  const cells = cellsAtom()
  const idx = cells.findIndex((c) => c.id === cellId)
  const contextCells: llm.LlmContextCell[] = cells
    .slice(Math.max(0, idx - 10), idx)
    .map((c) => ({ kind: c.kind === 'code' ? 'code' : 'text', source: c.code() }))

  // Pre-capture both callbacks before the async boundary — clearStack() drops context after await.
  const onSuccess = wrap((response: llm.GenerateCodeResponse) => {
    const newCell = addCell(cellId, cellKindForLlmResult(response))
    updateCellCode(newCell.id, response.content)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })
  const onError = wrap((err: Error) => {
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
    onSuccess(response)
  } catch (err) {
    onError(err as Error)
    throw err
  } finally {
    stopGenerating()
  }
}, 'notebook.cells.cloudGenerate').extend(withAsync())
