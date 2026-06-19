import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { cellKindForLlmResult } from './llmResult'

// The cell id after which to insert when the agent responds.
// undefined means append at the end of the notebook.
export const agentInsertAfterIdAtom = atom<string | undefined>(
  undefined,
  'notebook.agentChat.afterId',
)

export const agentChatOpenAtom = atom(false, 'notebook.agentChat.open')

export const openAgentChatAction = action((afterId?: string) => {
  agentInsertAfterIdAtom.set(afterId)
  agentChatOpenAtom.set(true)
}, 'notebook.agentChat.open')

export const closeAgentChatAction = action(() => {
  agentChatOpenAtom.set(false)
}, 'notebook.agentChat.close')

export const agentSendAction = action(async (prompt: string) => {
  const afterId = agentInsertAfterIdAtom()

  // Pre-capture before the async boundary.
  const insertAndClose = wrap((response: llm.GenerateCodeResponse) => {
    const newCell = addCell(afterId, cellKindForLlmResult(response))
    updateCellCode(newCell.id, response.content)
    focusCell(newCell.id)
    enterEdit(newCell.id)
    agentChatOpenAtom.set(false)
  })

  const response = await wrap(
    llm.generateCode({ prompt, language: 'javascript', mode: 'generate' }),
  )

  insertAndClose(response)
}, 'notebook.agentChat.send').extend(withAsync())
