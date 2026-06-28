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
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', size: '~4.3 GB' },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', size: '~0.8 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', size: '~2 GB' },
  { id: 'Llama-3.1-8B-Instruct-q4f32_1-MLC', size: '~5 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', size: '~1.82 GB' },
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

// TARDIS-167 (№5): ids of models downloaded into the browser. The real weights
// live in WebLLM's Cache Storage; this localStorage list drives the UI highlight
// and is kept honest two ways: appended after each successful `loadModelAction`,
// and reconciled against the actual cache on startup via
// `reconcileDownloadedModelsAction` (review PR #88) — so a list entry whose
// weights were evicted / cleared is dropped rather than shown with a stale check.
export const downloadedModelIdsAtom = atom<string[]>([], 'webLlm.downloadedModelIds').extend(
  withLocalStorage('webLlm.downloadedModelIds'),
)

export const loadProgressAtom = atom<LoadProgress | null>(null, 'webLlm.loadProgress')

export const engineAtom = atom<webllm.MLCEngine | null>(null, 'webLlm.engine')

// TARDIS-167 (review PR #88 r3): sanitise the localStorage-restored model state.
// `localStorage` outlives the code — a record can be a stale id (a model dropped
// from the catalogue), the wrong type after a manual DevTools edit / bad
// migration, or an array with garbage entries. The UI then does
// `new Set(downloadedModelIdsAtom())` and `<Select value={modelId}>`; a non-array
// throws on render and a phantom id breaks the select. Normalise both atoms
// synchronously at boot (called from setup before first paint):
//   - downloaded ids → only known string ids from AVAILABLE_MODELS, de-duped;
//   - selected id    → reset to the default when it is not in the catalogue.
// Writing back also repairs the persisted storage, not just the in-memory atom.
export function normalizeWebLlmPersistedState(): void {
  const known = new Set(AVAILABLE_MODELS)

  const rawDownloaded: unknown = downloadedModelIdsAtom()
  const cleaned = Array.isArray(rawDownloaded)
    ? rawDownloaded.filter((id): id is string => typeof id === 'string' && known.has(id))
    : []
  const deduped = [...new Set(cleaned)]
  // Replace only when it actually changed (avoid a redundant storage write).
  if (
    !Array.isArray(rawDownloaded) ||
    deduped.length !== rawDownloaded.length ||
    deduped.some((id, i) => id !== rawDownloaded[i])
  ) {
    downloadedModelIdsAtom.set(deduped)
  }

  if (!known.has(modelIdAtom())) {
    modelIdAtom.set(AVAILABLE_MODELS[1])
  }
}

// TARDIS-167 (№15): id of the model currently LOADED into the engine (not the
// one selected in the dropdown). The two differ once the user picks another
// model after loading one — that is exactly when the action button must read
// "Load model" (it will load the newly selected model) rather than "Reload"
// (which only makes sense for re-initialising the already-loaded model).
export const loadedModelIdAtom = atom<string | null>(null, 'webLlm.loadedModelId')

export const messagesAtom = atom<ChatMessage[]>([], 'webLlm.messages')

export const streamingResponseAtom = atom('', 'webLlm.streamingResponse')

// Id of the model currently being loaded (null when idle). Lets the model picker
// stay ENABLED during a load and the Load button switch targets mid-load: the
// user can pick another model and start it, superseding the in-flight load via
// the H5 sequence guard above (TARDIS-168). Without this the UI couldn't tell
// which model the spinner belongs to.
export const loadingModelIdAtom = atom<string | null>(null, 'webLlm.loadingModelId')

// Monotonic load token (TARDIS-168 H5). Each `loadModelAction` run claims the
// next value; only the run whose token still equals `latestLoadSeq` may publish
// its engine, drive the progress bar, or reset the shared atoms. When the user
// picks another model mid-load (or double-clicks), the older run is superseded:
// it silently unloads its now-orphan engine instead of clobbering the winner —
// which would otherwise leave the app on the wrong model AND leak a WebGPU
// device. A plain module counter is enough: actions run on one JS thread, so
// `++latestLoadSeq` is atomic between awaits.
let latestLoadSeq = 0

export const loadModelAction = action(async () => {
  const seq = ++latestLoadSeq
  const modelId = modelIdAtom()

  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  loadingModelIdAtom.set(modelId)
  messagesAtom.set([])
  loadProgressAtom.set({ progress: 0, text: 'Initializing...' })

  // Build the engine ourselves (instead of CreateMLCEngine) so we keep a handle
  // to it even when `reload()` throws. A failed load (a flaky weights download,
  // or a transient WebGPU hiccup) otherwise LEAVES a half-initialised engine
  // holding the WebGPU device; the next attempt then can't acquire an adapter and
  // reports a misleading "Unable to find a compatible GPU" — which a full page
  // reload "fixes" only because it drops the leaked device. We release it in
  // `catch` so a retry starts clean, and always clear the loader in `finally`
  // (TARDIS-168).
  const engine = new webllm.MLCEngine({
    // initProgressCallback is called by WebLLM outside Reatom context — must wrap.
    // Ignore progress from a superseded load so a slow older run can't drive the
    // bar after the user already kicked off a newer one.
    initProgressCallback: wrap((report: webllm.InitProgressReport) => {
      if (seq === latestLoadSeq) {
        loadProgressAtom.set({ progress: report.progress, text: report.text })
      }
    }),
  })

  try {
    await wrap(engine.reload(modelId))

    // A newer load started while this one was initialising → this engine is an
    // orphan. Drop its WebGPU device and leave the shared atoms to the winner;
    // publishing here would point the app at the stale model and leak the live
    // engine (TARDIS-168 H5).
    if (seq !== latestLoadSeq) {
      await wrap(Promise.resolve(engine.unload()).catch(() => undefined))
      return
    }

    // Set the loaded id BEFORE the engine (review PR #88 r3): the code-generator
    // bridge subscribes to `engineAtom` and reads `loadedModelIdAtom()` inside the
    // callback. If the engine were set first, that subscriber would fire while the
    // id still held the PREVIOUS model, mirroring a stale name into the notebook
    // header. Writing the id first means the engine-triggered read sees the fresh one.
    loadedModelIdAtom.set(modelId)
    engineAtom.set(engine)
    // Record this model as downloaded (de-duped) so the list can mark it local.
    downloadedModelIdsAtom.set((ids) => (ids.includes(modelId) ? ids : [...ids, modelId]))
  } catch (err) {
    // Free the leaked WebGPU device so a retry isn't poisoned. Best-effort:
    // unload() may itself reject on a broken engine — swallow that and rethrow
    // the ORIGINAL load error for the UI (`loadModelAction.error()`).
    await wrap(Promise.resolve(engine.unload()).catch(() => undefined))
    // Only the current run owns the shared atoms; a superseded run must not wipe
    // the winner's engine/id on its own late failure.
    if (seq === latestLoadSeq) {
      engineAtom.set(null)
      loadedModelIdAtom.set(null)
    }
    throw err
  } finally {
    // Stop the spinner only for the current run; a stale run finishing later must
    // not clear the live load's progress (nor the loading-id of the winner).
    if (seq === latestLoadSeq) {
      loadProgressAtom.set(null)
      loadingModelIdAtom.set(null)
    }
  }
}, 'webLlm.loadModel').extend(withAsync())

// TARDIS-167 (№5, review PR #88): reconcile the persisted downloaded-list with
// the REAL WebLLM cache on startup. localStorage and Cache Storage are
// independent: the user can clear site data or the browser can evict weights,
// after which the list would still claim a model is local. Cross-check each id
// with `webllm.hasModelInCache` and keep only those actually cached, so the UI
// highlight reflects reality instead of a stale hint. Best-effort: any probe
// failure leaves that id as-is (we don't drop a model just because the check
// itself errored), and the whole action never throws into boot.
export const reconcileDownloadedModelsAction = action(async () => {
  const ids = downloadedModelIdsAtom()
  if (ids.length === 0) return
  const checks = await wrap(
    Promise.all(
      ids.map(async (id) => {
        try {
          return { id, cached: await webllm.hasModelInCache(id) }
        } catch {
          // Probe failed — don't penalise the id on an inconclusive check.
          return { id, cached: true }
        }
      }),
    ),
  )
  const stillCached = checks.filter((c) => c.cached).map((c) => c.id)
  if (stillCached.length !== ids.length) {
    downloadedModelIdsAtom.set(stillCached)
  }
}, 'webLlm.reconcileDownloadedModels').extend(withAsync())

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
