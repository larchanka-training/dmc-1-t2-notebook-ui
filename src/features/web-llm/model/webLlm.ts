import { atom, action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import * as webllm from '@mlc-ai/web-llm'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type LoadProgress = { progress: number; text: string }

export const AVAILABLE_MODELS = [
  'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', // ~1 GB  — fast, code-focused
  'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', // ~2 GB  — best code/size tradeoff
  'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', // ~4.5 GB — best code quality
  'Llama-3.2-1B-Instruct-q4f32_1-MLC', // ~0.8 GB — tiny, general
  'Llama-3.2-3B-Instruct-q4f32_1-MLC', // ~2 GB  — general reasoning
  'Llama-3.1-8B-Instruct-q4f32_1-MLC', // ~5 GB  — strong reasoning + code
  'Phi-3.5-mini-instruct-q4f16_1-MLC', // ~2.2 GB — Microsoft, compact
  'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', // ~4.5 GB — solid all-rounder
  'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', // ~4.5 GB — reasoning model
  'SmolLM2-1.7B-Instruct-q4f16_1-MLC', // ~1 GB  — ultra-light fallback
]

export const modelIdAtom = atom(AVAILABLE_MODELS[1], 'webLlm.modelId')

export const loadProgressAtom = atom<LoadProgress | null>(null, 'webLlm.loadProgress')

export const engineAtom = atom<webllm.MLCEngine | null>(null, 'webLlm.engine')

export const messagesAtom = atom<ChatMessage[]>([], 'webLlm.messages')

export const streamingResponseAtom = atom('', 'webLlm.streamingResponse')

export const loadModelAction = action(async () => {
  const modelId = modelIdAtom()

  engineAtom.set(null)
  messagesAtom.set([])
  loadProgressAtom.set({ progress: 0, text: 'Initializing...' })

  const engine = await wrap(
    webllm.CreateMLCEngine(modelId, {
      // initProgressCallback is called by WebLLM outside Reatom context — must wrap
      initProgressCallback: wrap((report: webllm.InitProgressReport) => {
        loadProgressAtom.set({ progress: report.progress, text: report.text })
      }),
    }),
  )

  engineAtom.set(engine)
  loadProgressAtom.set(null)
}, 'webLlm.loadModel').extend(withAsync())

export const sendMessageAction = action(async (input: string) => {
  const engine = engineAtom()
  if (!engine || !input.trim()) return

  const userMsg: ChatMessage = { role: 'user', content: input.trim() }
  messagesAtom.set((msgs) => [...msgs, userMsg])
  streamingResponseAtom.set('')

  // Pre-capture Reatom context NOW (sync, before any await).
  // wrap(fn) captures the current context at call time — calling wrap() inside the
  // for-await loop would fail because each iteration is an unwrapped async boundary
  // under clearStack(). Creating the setters here lets us call them safely later.
  const setStreaming = wrap((text: string) => streamingResponseAtom.set(text))
  const finalize = wrap((text: string) => {
    messagesAtom.set((msgs) => [...msgs, { role: 'assistant', content: text }])
    streamingResponseAtom.set('')
  })

  const history = messagesAtom().map((m) => ({ role: m.role, content: m.content }))

  const stream = await wrap(
    engine.chat.completions.create({
      messages: history,
      stream: true,
    }),
  )

  let fullResponse = ''
  for await (const chunk of stream) {
    fullResponse += chunk.choices[0]?.delta.content ?? ''
    setStreaming(fullResponse)
  }

  finalize(fullResponse)
}, 'webLlm.sendMessage').extend(withAsync())
