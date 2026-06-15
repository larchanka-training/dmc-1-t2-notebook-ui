import { action, atom, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'

export type CloudMessage = { role: 'user' | 'assistant'; content: string }

export const cloudMessagesAtom = atom<CloudMessage[]>([], 'llmPlayground.cloud.messages')

export const cloudSendAction = action(async (prompt: string) => {
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
