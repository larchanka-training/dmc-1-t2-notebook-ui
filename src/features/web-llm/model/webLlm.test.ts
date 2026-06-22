import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { peek, wrap } from '@reatom/core'

// `loadModelAction` drives `webllm.CreateMLCEngine` (a heavy WASM download), so
// mock it with a stub engine. This lets the test exercise the REAL action — not
// a re-implementation of its append rule — and catch a regression in the action
// itself (review PR #88).
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn(async () => ({ stub: 'engine' })),
  hasModelInCache: vi.fn(async () => true),
}))

import * as webllm from '@mlc-ai/web-llm'
import {
  AVAILABLE_MODELS,
  downloadedModelIdsAtom,
  engineAtom,
  loadModelAction,
  loadedModelIdAtom,
  modelIdAtom,
  normalizeWebLlmPersistedState,
  reconcileDownloadedModelsAction,
} from './webLlm'

beforeEach(() => {
  downloadedModelIdsAtom.set([])
  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  vi.mocked(webllm.CreateMLCEngine).mockClear()
  vi.mocked(webllm.hasModelInCache).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  downloadedModelIdsAtom.set([])
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
    expect(vi.mocked(webllm.CreateMLCEngine)).toHaveBeenCalledTimes(2)
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
