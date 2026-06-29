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
      startView: 'dashboard',
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
      startView: 'last-opened',
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
      startView: 'dashboard',
    }
    writeUserSettings('keep', custom)

    const result = ensureUserSettings('keep')

    expect(result).toEqual(custom)
    // Untouched on disk too.
    expect(readUserSettings('keep')).toEqual(custom)
  })

  test('self-heals a stored record with stale fields back to disk (write-back once)', () => {
    // A phantom modelId + a non-numeric limit + an extra junk key.
    localStorage.setItem(
      settingsKey('stale'),
      JSON.stringify({
        displayName: 'Stale',
        modelId: 'dropped-from-catalogue',
        autoLoadModel: true,
        inBrowserMaxTokens: 'nope',
        thinkTokenBudget: 1500,
        junk: 42,
      }),
    )

    const result = ensureUserSettings('stale')

    // Coerced in memory: phantom model → default, bad limit → default, valid
    // fields kept.
    expect(result.modelId).toBe(DEFAULT_USER_SETTINGS.modelId)
    expect(result.inBrowserMaxTokens).toBe(DEFAULT_USER_SETTINGS.inBrowserMaxTokens)
    expect(result.displayName).toBe('Stale')
    expect(result.autoLoadModel).toBe(true)
    expect(result.thinkTokenBudget).toBe(1500)

    // And written back to disk: the raw record now equals the canonical coerced
    // record (no phantom id, no junk key left behind).
    expect(localStorage.getItem(settingsKey('stale'))).toBe(JSON.stringify(result))
    expect('junk' in JSON.parse(localStorage.getItem(settingsKey('stale'))!)).toBe(false)
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

  test('resets an unknown startView to the default (TARDIS-183)', () => {
    localStorage.setItem(
      settingsKey('bad-start'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, startView: 'galaxy' }),
    )

    expect(readUserSettings('bad-start')!.startView).toBe(DEFAULT_USER_SETTINGS.startView)
    // Sanity: the default reproduces the pre-183 "open a notebook" behaviour.
    expect(DEFAULT_USER_SETTINGS.startView).toBe('last-opened')
  })

  test('keeps a valid startView (dashboard) unchanged', () => {
    localStorage.setItem(
      settingsKey('dash-start'),
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, startView: 'dashboard' }),
    )

    expect(readUserSettings('dash-start')!.startView).toBe('dashboard')
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
      startView: 'last-opened',
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
