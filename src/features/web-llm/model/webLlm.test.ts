import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { peek, wrap } from '@reatom/core'

// `loadModelAction` builds a `webllm.MLCEngine` and calls `reload()` (a heavy
// WASM download), so mock the class with a stub whose `reload`/`unload` are
// spies. This exercises the REAL action — not a re-implementation — and lets us
// assert the failure path frees the engine (TARDIS-168).
const reloadMock = vi.fn(async () => undefined)
const unloadMock = vi.fn(async () => undefined)
vi.mock('@mlc-ai/web-llm', () => ({
  // `new MLCEngine(cfg)` is called with `new`, so the mock must be constructable:
  // a `function` (not an arrow) returning the stub instance.
  MLCEngine: vi.fn(function () {
    return { reload: reloadMock, unload: unloadMock }
  }),
  hasModelInCache: vi.fn(async () => true),
}))

import * as webllm from '@mlc-ai/web-llm'
import {
  AVAILABLE_MODELS,
  downloadedModelIdsAtom,
  engineAtom,
  loadModelAction,
  loadedModelIdAtom,
  messagesAtom,
  modelIdAtom,
  normalizeWebLlmPersistedState,
  reconcileDownloadedModelsAction,
  sendMessageAction,
} from './webLlm'

beforeEach(() => {
  downloadedModelIdsAtom.set([])
  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  messagesAtom.set([])
  vi.mocked(webllm.MLCEngine).mockClear()
  reloadMock.mockClear().mockResolvedValue(undefined)
  unloadMock.mockClear().mockResolvedValue(undefined)
  vi.mocked(webllm.hasModelInCache).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  downloadedModelIdsAtom.set([])
  messagesAtom.set([])
  modelIdAtom.set(AVAILABLE_MODELS[1])
})

describe('webLlm model bookkeeping (TARDIS-167 №5)', () => {
  test('modelIdAtom is persisted (withLocalStorage) so the choice survives reloads', () => {
    modelIdAtom.set('Phi-3.5-mini-instruct-q4f16_1-MLC')
    expect(peek(modelIdAtom)).toBe('Phi-3.5-mini-instruct-q4f16_1-MLC')
  })

  test('loadModelAction records the loaded model and de-dupes on a re-load', async () => {
    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')

    await wrap(loadModelAction())
    // After a successful load: the engine is set, the loaded-id reflects it, and
    // the model is recorded as downloaded.
    expect(peek(loadedModelIdAtom)).toBe('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    expect(peek(downloadedModelIdsAtom)).toEqual(['Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'])

    // Re-loading the SAME model must not duplicate it in the downloaded list.
    await wrap(loadModelAction())
    expect(peek(downloadedModelIdsAtom)).toEqual(['Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'])
    expect(vi.mocked(webllm.MLCEngine)).toHaveBeenCalledTimes(2)
  })

  test('loading a second model appends it (keeps both downloaded)', async () => {
    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    await wrap(loadModelAction())
    modelIdAtom.set('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    await wrap(loadModelAction())

    expect(peek(downloadedModelIdsAtom)).toEqual([
      'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
      'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    ])
    expect(peek(loadedModelIdAtom)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC')
  })

  test('switching models unloads the previously loaded engine exactly once (TARDIS-168)', async () => {
    // Happy-path device hygiene: load A, then load B. The old engine must be
    // unload()-ed so its WebGPU device is freed (not just dropped on the floor).
    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    await wrap(loadModelAction())
    expect(unloadMock).not.toHaveBeenCalled() // nothing to free on the first load

    modelIdAtom.set('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    await wrap(loadModelAction())

    // The first engine was released once; the new one stays live.
    expect(unloadMock).toHaveBeenCalledTimes(1)
    expect(peek(engineAtom)).not.toBeNull()
    expect(peek(loadedModelIdAtom)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC')
  })

  test('a failed load frees the engine and clears state so a retry starts clean (TARDIS-168)', async () => {
    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    // First attempt: reload rejects (a flaky download / transient WebGPU error).
    reloadMock.mockRejectedValueOnce(new Error('network blip'))

    await expect(wrap(loadModelAction())).rejects.toThrow('network blip')

    // The leaked WebGPU device is released and no half-loaded engine lingers.
    expect(unloadMock).toHaveBeenCalledTimes(1)
    expect(peek(engineAtom)).toBeNull()
    expect(peek(loadedModelIdAtom)).toBeNull()
    // A failed model is NOT recorded as downloaded.
    expect(peek(downloadedModelIdsAtom)).toEqual([])

    // Second attempt succeeds — the earlier failure didn't poison it.
    await wrap(loadModelAction())
    expect(peek(engineAtom)).not.toBeNull()
    expect(peek(loadedModelIdAtom)).toBe('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
  })

  test('a superseded concurrent load unloads its engine and does not clobber the winner (H5)', async () => {
    // First load hangs on reload(); a second load starts and finishes first.
    let releaseFirst!: () => void
    const firstReload = new Promise<void>((r) => {
      releaseFirst = r
    })
    // Two engine instances so we can tell which one gets published / unloaded.
    const firstUnload = vi.fn(async () => undefined)
    const secondUnload = vi.fn(async () => undefined)
    vi.mocked(webllm.MLCEngine)
      .mockImplementationOnce(function () {
        return { reload: vi.fn(() => firstReload), unload: firstUnload }
      } as never)
      .mockImplementationOnce(function () {
        return { reload: vi.fn(async () => undefined), unload: secondUnload }
      } as never)

    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    const firstRun = wrap(loadModelAction())
    // Second load supersedes the first while it is still initialising.
    modelIdAtom.set('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    await wrap(loadModelAction())

    // Winner published; spinner cleared by the winner.
    expect(peek(loadedModelIdAtom)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    expect(peek(engineAtom)).not.toBeNull()
    expect(secondUnload).not.toHaveBeenCalled()

    // Now let the stale first load finish: it must unload its orphan engine and
    // leave the winner's atoms untouched.
    releaseFirst()
    await firstRun
    expect(firstUnload).toHaveBeenCalledTimes(1)
    expect(peek(loadedModelIdAtom)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    expect(peek(engineAtom)).not.toBeNull()
  })

  test('a superseded load that FAILS late does not surface its error over the winner (TARDIS-168)', async () => {
    // First load hangs, then rejects; a second load wins in between. The stale
    // failure must be swallowed — not re-thrown onto the shared loadModelAction
    // .error(), which would show "load failed" on top of a model that loaded fine.
    let rejectFirst!: (e: Error) => void
    const firstReload = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })
    const firstUnload = vi.fn(async () => undefined)
    vi.mocked(webllm.MLCEngine)
      .mockImplementationOnce(function () {
        return { reload: vi.fn(() => firstReload), unload: firstUnload }
      } as never)
      .mockImplementationOnce(function () {
        return { reload: vi.fn(async () => undefined), unload: vi.fn(async () => undefined) }
      } as never)

    modelIdAtom.set('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC')
    const firstRun = wrap(loadModelAction())
    modelIdAtom.set('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    await wrap(loadModelAction()) // winner

    // Stale load now fails — it must resolve WITHOUT throwing (error swallowed).
    rejectFirst(new Error('stale GPU error'))
    await expect(firstRun).resolves.toBeUndefined()

    // The orphan engine was freed, and the winner's state is untouched.
    expect(firstUnload).toHaveBeenCalledTimes(1)
    expect(peek(loadedModelIdAtom)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC')
    expect(peek(engineAtom)).not.toBeNull()
  })
})

describe('reconcileDownloadedModelsAction (TARDIS-167 №5, review PR #88)', () => {
  test('drops ids whose weights are no longer in the WebLLM cache', async () => {
    downloadedModelIdsAtom.set(['cached-model', 'evicted-model'])
    vi.mocked(webllm.hasModelInCache).mockImplementation(
      async (id: string) => id === 'cached-model',
    )

    await wrap(reconcileDownloadedModelsAction())

    expect(peek(downloadedModelIdsAtom)).toEqual(['cached-model'])
  })

  test('keeps an id when the cache probe throws (inconclusive, do not penalise)', async () => {
    downloadedModelIdsAtom.set(['flaky-model'])
    vi.mocked(webllm.hasModelInCache).mockRejectedValue(new Error('probe boom'))

    await wrap(reconcileDownloadedModelsAction())

    expect(peek(downloadedModelIdsAtom)).toEqual(['flaky-model'])
  })

  test('no-op on an empty list (no cache probes)', async () => {
    downloadedModelIdsAtom.set([])

    await wrap(reconcileDownloadedModelsAction())

    expect(vi.mocked(webllm.hasModelInCache)).not.toHaveBeenCalled()
  })
})

describe('normalizeWebLlmPersistedState (TARDIS-167, review PR #88 r3)', () => {
  test('drops non-string / unknown / duplicate downloaded ids', () => {
    const known = AVAILABLE_MODELS[0]
    // Simulate a corrupt persisted record (manual edit / bad migration).
    downloadedModelIdsAtom.set([known, 'ghost-model', known, 123, null] as unknown as string[])

    normalizeWebLlmPersistedState()

    expect(peek(downloadedModelIdsAtom)).toEqual([known])
  })

  test('resets the downloaded list to [] when the persisted value is not an array', () => {
    downloadedModelIdsAtom.set({ junk: true } as unknown as string[])

    normalizeWebLlmPersistedState()

    expect(peek(downloadedModelIdsAtom)).toEqual([])
  })

  test('resets a phantom selected model id to the default', () => {
    modelIdAtom.set('removed-from-catalogue')

    normalizeWebLlmPersistedState()

    expect(peek(modelIdAtom)).toBe(AVAILABLE_MODELS[1])
  })

  test('keeps a valid selected id untouched', () => {
    modelIdAtom.set(AVAILABLE_MODELS[3])

    normalizeWebLlmPersistedState()

    expect(peek(modelIdAtom)).toBe(AVAILABLE_MODELS[3])
  })
})

describe('sendMessageAction placeholder branch', () => {
  test('adds a local placeholder response when no in-browser model is loaded', async () => {
    engineAtom.set(null)

    await wrap(sendMessageAction('  explain maps  '))

    expect(peek(messagesAtom)).toEqual([
      { role: 'user', content: 'explain maps' },
      { role: 'assistant', content: '— Load a model to see a local response —' },
    ])
  })
})
