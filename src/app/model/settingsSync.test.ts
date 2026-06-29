import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { peek } from '@reatom/core'

// `startSettingsSync` may trigger `loadModelAction()` (which constructs a
// `webllm.MLCEngine` and calls `reload()` — a heavy WASM download) when an
// applied record opts into auto-load. Mock the class exactly like
// webLlm.test.ts: a constructable stub whose `reload`/`unload` are spies. This
// exercises the REAL sync + action, not a re-implementation.
const reloadMock = vi.fn(async () => undefined)
const unloadMock = vi.fn(async () => undefined)
vi.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: vi.fn(function () {
    return { reload: reloadMock, unload: unloadMock }
  }),
  hasModelInCache: vi.fn(async () => true),
}))

import * as webllm from '@mlc-ai/web-llm'
import { userAtom } from '@/entities/session'
import {
  AVAILABLE_MODELS,
  autoLoadModelAtom,
  engineAtom,
  loadedModelIdAtom,
  modelIdAtom,
} from '@/features/web-llm'
import { inBrowserMaxTokensAtom, thinkTokenBudgetAtom } from '@/features/notebook'
import { displayNameAtom } from '@/features/settings'
import { DEFAULT_USER_SETTINGS, readUserSettings, writeUserSettings } from './userSettings'
import { startSettingsSync } from './settingsSync'

// Reatom atom subscriptions (userAtom → sync, atoms → write-back) fire
// asynchronously, so a macrotask flush is needed after each triggering `.set`
// before the effect is observable. Same pattern as notebookList.test.ts.
const flush = () => new Promise((resolve) => setTimeout(resolve))

function resetAtomsToDefaults(): void {
  displayNameAtom.set(DEFAULT_USER_SETTINGS.displayName)
  modelIdAtom.set(DEFAULT_USER_SETTINGS.modelId)
  autoLoadModelAtom.set(DEFAULT_USER_SETTINGS.autoLoadModel)
  inBrowserMaxTokensAtom.set(DEFAULT_USER_SETTINGS.inBrowserMaxTokens)
  thinkTokenBudgetAtom.set(DEFAULT_USER_SETTINGS.thinkTokenBudget)
}

function expectAtomsAreDefaults(): void {
  expect(peek(displayNameAtom)).toBe(DEFAULT_USER_SETTINGS.displayName)
  expect(peek(modelIdAtom)).toBe(DEFAULT_USER_SETTINGS.modelId)
  expect(peek(autoLoadModelAtom)).toBe(DEFAULT_USER_SETTINGS.autoLoadModel)
  expect(peek(inBrowserMaxTokensAtom)).toBe(DEFAULT_USER_SETTINGS.inBrowserMaxTokens)
  expect(peek(thinkTokenBudgetAtom)).toBe(DEFAULT_USER_SETTINGS.thinkTokenBudget)
}

const user = (id: string) => ({ id, email: `${id}@x`, displayName: null, roles: [] })

beforeEach(() => {
  localStorage.clear()
  userAtom.set(null)
  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  resetAtomsToDefaults()
  vi.mocked(webllm.MLCEngine).mockClear()
  reloadMock.mockClear().mockResolvedValue(undefined)
  unloadMock.mockClear().mockResolvedValue(undefined)
})

afterEach(() => {
  userAtom.set(null)
  engineAtom.set(null)
  loadedModelIdAtom.set(null)
  resetAtomsToDefaults()
  localStorage.clear()
})

describe('startSettingsSync — sign-in / record application', () => {
  test('sign-in with NO existing record creates defaults immediately', async () => {
    const stop = startSettingsSync()
    try {
      userAtom.set(user('alice'))
      await flush()

      // Create-on-login: the record is written the moment the user signs in.
      expect(localStorage.getItem('settings:alice')).not.toBeNull()
      expect(readUserSettings('alice')).toEqual(DEFAULT_USER_SETTINGS)
      expectAtomsAreDefaults()
    } finally {
      stop()
    }
  })

  test('sign-in with an EXISTING record applies it to the atoms', async () => {
    const stored = {
      displayName: 'Bob',
      modelId: AVAILABLE_MODELS[4],
      autoLoadModel: false,
      inBrowserMaxTokens: 3000,
      thinkTokenBudget: 1500,
    }
    writeUserSettings('bob', stored)

    const stop = startSettingsSync()
    try {
      userAtom.set(user('bob'))
      await flush()

      expect(peek(displayNameAtom)).toBe('Bob')
      expect(peek(modelIdAtom)).toBe(AVAILABLE_MODELS[4])
      expect(peek(autoLoadModelAtom)).toBe(false)
      expect(peek(inBrowserMaxTokensAtom)).toBe(3000)
      expect(peek(thinkTokenBudgetAtom)).toBe(1500)

      // Echo guard: applying the record on sign-in must not corrupt it.
      expect(readUserSettings('bob')).toEqual(stored)
    } finally {
      stop()
    }
  })
})

describe('startSettingsSync — write-back', () => {
  test('editing an atom while signed in writes back to that user record', async () => {
    writeUserSettings('bob', { ...DEFAULT_USER_SETTINGS, displayName: 'Bob' })

    const stop = startSettingsSync()
    try {
      userAtom.set(user('bob'))
      await flush()

      displayNameAtom.set('Bobby')
      await flush()

      expect(readUserSettings('bob')!.displayName).toBe('Bobby')
    } finally {
      stop()
    }
  })
})

describe('startSettingsSync — account isolation', () => {
  test('switching accounts shows the new user values and leaves the other record untouched', async () => {
    const stop = startSettingsSync()
    try {
      // Alice signs in (defaults), then renames herself.
      userAtom.set(user('alice'))
      await flush()
      displayNameAtom.set('Alice')
      await flush()
      expect(readUserSettings('alice')!.displayName).toBe('Alice')

      // Bob signs in on the same browser with his own (default) record.
      userAtom.set(user('bob'))
      await flush()

      // The atoms now reflect Bob, never Alice's name — the core multi-account
      // guarantee on a shared browser.
      expect(peek(displayNameAtom)).toBe(DEFAULT_USER_SETTINGS.displayName)
      expect(peek(displayNameAtom)).not.toBe('Alice')

      // Alice's persisted record is intact.
      expect(readUserSettings('alice')!.displayName).toBe('Alice')
    } finally {
      stop()
    }
  })
})

describe('startSettingsSync — sign-out', () => {
  test('sign-out resets atoms to defaults and suppresses writes while signed out', async () => {
    const stop = startSettingsSync()
    try {
      userAtom.set(user('alice'))
      await flush()
      displayNameAtom.set('Alice')
      inBrowserMaxTokensAtom.set(1234)
      await flush()

      userAtom.set(null)
      await flush()

      expectAtomsAreDefaults()
      // No write happened to a `settings:null`-style key (writes suppressed when
      // signed out).
      expect(localStorage.getItem('settings:null')).toBeNull()
    } finally {
      stop()
    }
  })
})

describe('startSettingsSync — auto-load opt-in', () => {
  test('applies a record with autoLoadModel:true by loading the model', async () => {
    writeUserSettings('carol', {
      ...DEFAULT_USER_SETTINGS,
      modelId: AVAILABLE_MODELS[0],
      autoLoadModel: true,
    })

    const stop = startSettingsSync()
    try {
      userAtom.set(user('carol'))
      await flush()

      expect(vi.mocked(webllm.MLCEngine)).toHaveBeenCalled()
      expect(reloadMock).toHaveBeenCalledWith(AVAILABLE_MODELS[0])
    } finally {
      stop()
    }
  })

  test('does NOT load the model when autoLoadModel is false', async () => {
    writeUserSettings('dave', {
      ...DEFAULT_USER_SETTINGS,
      modelId: AVAILABLE_MODELS[0],
      autoLoadModel: false,
    })

    const stop = startSettingsSync()
    try {
      userAtom.set(user('dave'))
      await flush()

      expect(vi.mocked(webllm.MLCEngine)).not.toHaveBeenCalled()
      expect(reloadMock).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })
})

describe('startSettingsSync — model load invalidation on user change', () => {
  test('a user change drops the previously loaded engine (no cross-account bleed)', async () => {
    const stop = startSettingsSync()
    try {
      userAtom.set(user('alice'))
      await flush()
      const aliceEngine = { unload: unloadMock }
      engineAtom.set(aliceEngine as unknown as ReturnType<typeof engineAtom>)
      loadedModelIdAtom.set(AVAILABLE_MODELS[0])

      userAtom.set(user('bob'))
      await flush()

      // Alice's engine must not bleed into Bob's session: dropped + unloaded.
      expect(peek(engineAtom)).toBeNull()
      expect(peek(loadedModelIdAtom)).toBeNull()
      expect(unloadMock).toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  test('a late-resolving load started before sign-out does not publish its engine', async () => {
    writeUserSettings('alice', {
      ...DEFAULT_USER_SETTINGS,
      modelId: AVAILABLE_MODELS[0],
      autoLoadModel: true,
    })
    // Hold the reload promise open so the load is still pending at sign-out.
    let resolveReload: () => void = () => {}
    reloadMock.mockImplementationOnce(
      () => new Promise<undefined>((res) => (resolveReload = () => res(undefined))),
    )

    const stop = startSettingsSync()
    try {
      userAtom.set(user('alice'))
      await flush()
      expect(reloadMock).toHaveBeenCalled()

      // Sign out while the load is still pending, then let it resolve.
      userAtom.set(null)
      await flush()
      resolveReload()
      await flush()

      // The superseded load must not publish Alice's model into the signed-out
      // session.
      expect(peek(engineAtom)).toBeNull()
      expect(peek(loadedModelIdAtom)).toBeNull()
    } finally {
      stop()
    }
  })
})
