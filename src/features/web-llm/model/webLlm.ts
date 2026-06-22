import { atom, action, wrap, withLocalStorage } from '@reatom/core'
import { withAsync } from '@reatom/core'
import * as webllm from '@mlc-ai/web-llm'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type LoadProgress = { progress: number; text: string }

export type ModelEntry = { id: string; size: string }

export const MODEL_CATALOG: ModelEntry[] = [
  { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', size: '~1 GB' },
  { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', size: '~2 GB' },
  { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', size: '~4.5 GB' },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', size: '~0.8 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', size: '~2 GB' },
  { id: 'Llama-3.1-8B-Instruct-q4f32_1-MLC', size: '~5 GB' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', size: '~2.2 GB' },
  { id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', size: '~4.5 GB' },
  { id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', size: '~4.5 GB' },
  { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', size: '~1 GB' },
]

export const AVAILABLE_MODELS = MODEL_CATALOG.map((m) => m.id)

// TARDIS-167 (№5): remember the selected model across reloads. Read reactively
// from components, so plain `withLocalStorage` (same pattern as themeModeAtom /
// notebook.settings.lineNumbers) is enough.
export const modelIdAtom = atom(AVAILABLE_MODELS[1], 'webLlm.modelId').extend(
  withLocalStorage('webLlm.modelId'),
)

// TARDIS-167 (№5): ids of models that HAVE BEEN downloaded into the browser at
// least once. WebLLM caches the real weights in Cache Storage; this is only a
// localStorage hint for the UI highlight, NOT a guarantee the weights are still
// cached — the user can clear site data or the browser can evict them, leaving
// this list optimistic. Hence the tooltip says "previously downloaded", not
// "no re-download" (review PR #88). A real Cache Storage cross-check
// (`webllm.hasModelInCache`) is a possible follow-up. Appended after each
// successful `loadModelAction`.
export const downloadedModelIdsAtom = atom<string[]>([], 'webLlm.downloadedModelIds').extend(
  withLocalStorage('webLlm.downloadedModelIds'),
)

export const loadProgressAtom = atom<LoadProgress | null>(null, 'webLlm.loadProgress')

export const engineAtom = atom<webllm.MLCEngine | null>(null, 'webLlm.engine')

// TARDIS-167 (№15): id of the model currently LOADED into the engine (not the
// one selected in the dropdown). The two differ once the user picks another
// model after loading one — that is exactly when the action button must read
// "Load model" (it will load the newly selected model) rather than "Reload"
// (which only makes sense for re-initialising the already-loaded model).
export const loadedModelIdAtom = atom<string | null>(null, 'webLlm.loadedModelId')

export const messagesAtom = atom<ChatMessage[]>([], 'webLlm.messages')

export const streamingResponseAtom = atom('', 'webLlm.streamingResponse')

export const loadModelAction = action(async () => {
  const modelId = modelIdAtom()

  engineAtom.set(null)
  loadedModelIdAtom.set(null)
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
  loadedModelIdAtom.set(modelId)
  loadProgressAtom.set(null)
  // Record this model as downloaded (de-duped) so the list can mark it local.
  downloadedModelIdsAtom.set((ids) => (ids.includes(modelId) ? ids : [...ids, modelId]))
}, 'webLlm.loadModel').extend(withAsync())

export const sendMessageAction = action(async (input: string) => {
  if (!input.trim()) return

  const engine = engineAtom()
  const userMsg: ChatMessage = { role: 'user', content: input.trim() }
  messagesAtom.set((msgs) => [...msgs, userMsg])

  if (!engine) {
    // No model loaded — show a placeholder so the Local column isn't silent
    // while Cloud responds.
    messagesAtom.set((msgs) => [
      ...msgs,
      { role: 'assistant', content: '— Load a model to see a local response —' },
    ])
    return
  }

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
