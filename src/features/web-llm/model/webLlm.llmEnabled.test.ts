// Step 8b — negative guarantee for the web-llm feature: with LLM features OFF,
// no model is downloaded and no local chat runs. The download case is the one
// this whole feature exists for — a user who switched LLM off must never see a
// multi-gigabyte fetch start on sign-in.
//
// Inventory of all guarded entry points: `entities/llm-availability`.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { wrap } from '@reatom/core'

// Same engine stub as `webLlm.test.ts`: the real `loadModelAction` would build an
// MLCEngine and call `reload()` (the actual WASM download).
const reloadMock = vi.fn(async () => undefined)
const unloadMock = vi.fn(async () => undefined)
vi.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: vi.fn(function () {
    return { reload: reloadMock, unload: unloadMock }
  }),
  hasModelInCache: vi.fn(async () => true),
}))

import * as webllm from '@mlc-ai/web-llm'
import { llmEnabledAtom } from '@/entities/llm-availability'
import {
  engineAtom,
  loadModelAction,
  loadedModelIdAtom,
  loadingModelIdAtom,
  messagesAtom,
  sendMessageAction,
} from './webLlm'

beforeEach(() => {
  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  loadingModelIdAtom.set(null)
  messagesAtom.set([])
  reloadMock.mockClear()
  vi.mocked(webllm.MLCEngine).mockClear()
  llmEnabledAtom.set(false)
})

afterEach(() => {
  llmEnabledAtom.set(true)
  messagesAtom.set([])
})

describe('llmEnabled = false', () => {
  test('loadModelAction downloads nothing and leaves no loading state', async () => {
    await wrap(loadModelAction())

    expect(webllm.MLCEngine).not.toHaveBeenCalled()
    expect(reloadMock).not.toHaveBeenCalled()
    expect(engineAtom()).toBeNull()
    // The guard returns BEFORE the progress/loading atoms are armed, so the UI
    // never flashes a spinner for a load that will not happen.
    expect(loadingModelIdAtom()).toBeNull()
  })

  test('sendMessageAction adds no message, not even the "load a model" hint', async () => {
    await wrap(sendMessageAction('hi local'))

    expect(messagesAtom()).toEqual([])
  })
})

describe('llmEnabled = true — the guard does not over-block', () => {
  test('loadModelAction still builds the engine', async () => {
    llmEnabledAtom.set(true)

    await wrap(loadModelAction())

    expect(webllm.MLCEngine).toHaveBeenCalled()
    expect(reloadMock).toHaveBeenCalled()
  })
})
