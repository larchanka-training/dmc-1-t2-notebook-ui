import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AVAILABLE_MODELS } from '@/features/web-llm'
import { IN_BROWSER_MAX_TOKENS, IN_BROWSER_THINK_TOKEN_BUDGET } from '@/features/notebook'
import {
  DEFAULT_USER_SETTINGS,
  ensureUserSettings,
  readUserSettings,
  settingsKey,
  writeUserSettings,
  type UserSettings,
} from './userSettings'

// TARDIS-181: pure persistence helpers for the per-user settings record stored
// under `settings:<userId>`. The auto-loaded test setup provides an in-memory
// localStorage; clear it around every test so records never leak across cases.
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('settingsKey', () => {
  test('namespaces the storage key by user id', () => {
    expect(settingsKey('u1')).toBe('settings:u1')
  })
})

describe('readUserSettings', () => {
  test('returns null when no record exists', () => {
    expect(readUserSettings('nobody')).toBeNull()
  })

  test('returns the parsed record when present', () => {
    const record: UserSettings = {
      displayName: 'Reader',
      modelId: AVAILABLE_MODELS[3],
      autoLoadModel: true,
      inBrowserMaxTokens: 1234,
      thinkTokenBudget: 567,
    }
    localStorage.setItem(settingsKey('present'), JSON.stringify(record))

    expect(readUserSettings('present')).toEqual(record)
  })

  test('returns null on malformed JSON', () => {
    localStorage.setItem(settingsKey('broken'), '{ this is not json ]')

    expect(readUserSettings('broken')).toBeNull()
  })
})

describe('writeUserSettings', () => {
  test('round-trips through localStorage as JSON under settings:<id>', () => {
    const record: UserSettings = {
      displayName: 'Round Trip',
      modelId: AVAILABLE_MODELS[4],
      autoLoadModel: false,
      inBrowserMaxTokens: 2000,
      thinkTokenBudget: 1000,
    }

    writeUserSettings('rt', record)

    // The helper reads back an equal object …
    expect(readUserSettings('rt')).toEqual(record)
    // … and the raw cell is JSON stored under the namespaced key.
    const raw = localStorage.getItem('settings:rt')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual(record)
  })
})

describe('ensureUserSettings', () => {
  test('creates defaults immediately for a fresh id (create-on-login is not deferred)', () => {
    const result = ensureUserSettings('fresh')

    expect(result).toEqual(DEFAULT_USER_SETTINGS)
    // The write is immediate, not deferred to a first edit.
    expect(localStorage.getItem('settings:fresh')).not.toBeNull()
    expect(readUserSettings('fresh')).toEqual(DEFAULT_USER_SETTINGS)
  })

  test('returns the stored record without overwriting an existing one', () => {
    const custom: UserSettings = {
      displayName: 'Existing',
      modelId: AVAILABLE_MODELS[2],
      autoLoadModel: true,
      inBrowserMaxTokens: 3333,
      thinkTokenBudget: 1111,
    }
    writeUserSettings('keep', custom)

    const result = ensureUserSettings('keep')

    expect(result).toEqual(custom)
    // Untouched on disk too.
    expect(readUserSettings('keep')).toEqual(custom)
  })
})

describe('coerce (exercised via readUserSettings)', () => {
  test('resets an unknown modelId to the catalogue default', () => {
    localStorage.setItem(
      settingsKey('bad-model'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, modelId: 'phantom-model-id' }),
    )

    expect(readUserSettings('bad-model')!.modelId).toBe(DEFAULT_USER_SETTINGS.modelId)
    // Sanity: the default is the catalogue's second entry, not a hardcoded id.
    expect(DEFAULT_USER_SETTINGS.modelId).toBe(AVAILABLE_MODELS[1])
  })

  test('coerces a non-boolean autoLoadModel to false', () => {
    localStorage.setItem(
      settingsKey('bad-bool'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, autoLoadModel: 'yes' }),
    )

    expect(readUserSettings('bad-bool')!.autoLoadModel).toBe(false)
  })

  test('falls back to the default limits for non-number values', () => {
    localStorage.setItem(
      settingsKey('bad-nums'),
      JSON.stringify({
        ...DEFAULT_USER_SETTINGS,
        inBrowserMaxTokens: 'lots',
        thinkTokenBudget: null,
      }),
    )

    const result = readUserSettings('bad-nums')!
    expect(result.inBrowserMaxTokens).toBe(IN_BROWSER_MAX_TOKENS)
    expect(result.thinkTokenBudget).toBe(IN_BROWSER_THINK_TOKEN_BUDGET)
  })

  test('falls back to an empty string for a non-string displayName', () => {
    localStorage.setItem(
      settingsKey('bad-name'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, displayName: 123 }),
    )

    expect(readUserSettings('bad-name')!.displayName).toBe('')
  })

  test('passes valid values through unchanged', () => {
    const valid: UserSettings = {
      displayName: 'Valid User',
      modelId: AVAILABLE_MODELS[5],
      autoLoadModel: true,
      inBrowserMaxTokens: 1000,
      thinkTokenBudget: 500,
    }
    localStorage.setItem(settingsKey('valid'), JSON.stringify(valid))

    expect(readUserSettings('valid')).toEqual(valid)
  })

  test('keeps an out-of-range numeric limit RAW (not clamped here)', () => {
    localStorage.setItem(
      settingsKey('huge'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, inBrowserMaxTokens: 999999 }),
    )

    expect(readUserSettings('huge')!.inBrowserMaxTokens).toBe(999999)
  })
})
