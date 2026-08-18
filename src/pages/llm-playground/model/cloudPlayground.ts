import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { llmEnabledAtom } from '@/entities/llm-availability'

export type CloudMessage = { role: 'user' | 'assistant'; content: string }

export const cloudMessagesAtom = atom<CloudMessage[]>([], 'llmPlayground.cloud.messages')

export const cloudSendAction = action(async (prompt: string) => {
  // Step 8b master switch. Before the optimistic user-message append, so a
  // disabled LLM leaves no orphan message in the transcript.
  if (!llmEnabledAtom()) return
  cloudMessagesAtom.set((msgs) => [...msgs, { role: 'user', content: prompt }])

  const insertResponse = wrap((content: string) => {
    cloudMessagesAtom.set((msgs) => [...msgs, { role: 'assistant', content }])
  })

  const response = await wrap(
    llm.generateCode({
      prompt,
      language: 'javascript',
      mode: 'generate',
    }),
  )

  insertResponse(response.content)
}, 'llmPlayground.cloud.send').extend(withAsync())
