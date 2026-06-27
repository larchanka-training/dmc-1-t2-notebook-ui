import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { addCell, updateCellCode } from './notebook'
import { enterEdit, focusCell } from './cellMode'
import { cellKindForLlmResult } from './llmResult'
import { codeGeneratorAtom } from './codeGenerator'
import {
  startThinkingAction,
  updateThinkingAction,
  finishThinkingAction,
  failThinkingAction,
} from './inBrowserThinking'

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

// TARDIS-167 (№13): the Ask-agent popup offers TWO tiers, mirroring the cell
// toolbar — cloud (this action) and in-browser (`agentSendInBrowserAction`).
// Previously there was a single "Generate code" button with no hint which agent
// it hit. `agentSendAction` is the CLOUD tier (kept under this name so existing
// callers/tests stay valid).
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

// TARDIS-167 (№13): the in-browser (WebLLM) tier. Uses the same injected
// `codeGeneratorAtom` as the cell toolbar's in-browser generate, so it is only
// usable once a model is loaded (№4) — the dialog disables the button + shows a
// "Load a model first" tooltip when `codeGeneratorAtom()` is null. The local
// generator returns raw code (no result-kind classification), so the inserted
// cell is always a code cell, matching `generateAndInsertCodeAction`.
export const agentSendInBrowserAction = action(async (prompt: string) => {
  const generator = codeGeneratorAtom()
  if (!generator) return
  const afterId = agentInsertAfterIdAtom()

  const insertAndClose = wrap((code: string) => {
    const newCell = addCell(afterId, 'code')
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
    agentChatOpenAtom.set(false)
  })
  // Live reasoning block (TARDIS-168): anchored after the insert target, or at
  // the notebook end when the dialog was opened below all cells (afterId null).
  startThinkingAction(afterId ?? null)
  const onProgress = wrap((p: { thinking: string; tokens: number }) =>
    updateThinkingAction(p.thinking, p.tokens),
  )
  const finish = wrap(() => finishThinkingAction())
  const fail = wrap(() => failThinkingAction())

  const result = await wrap(generator(prompt, onProgress))
  if (result.incomplete) {
    // The model never produced runnable code — surface the failure, insert
    // nothing, and keep the dialog open so the user can rephrase or retry.
    fail()
    return
  }
  finish()
  insertAndClose(result.code)
}, 'notebook.agentChat.sendInBrowser').extend(withAsync())
