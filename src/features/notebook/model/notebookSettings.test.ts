import { afterEach, describe, expect, test } from 'vitest'
import { peek } from '@reatom/core'
import {
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
  MIN_IN_BROWSER_MAX_TOKENS,
  MAX_IN_BROWSER_MAX_TOKENS,
  MIN_THINK_TOKEN_BUDGET,
  MAX_THINK_TOKEN_BUDGET,
  inBrowserMaxTokensAtom,
  thinkTokenBudgetAtom,
  effectiveMaxTokensAtom,
  effectiveThinkTokenBudgetAtom,
} from './codeGenerator'

afterEach(() => {
  inBrowserMaxTokensAtom.set(IN_BROWSER_MAX_TOKENS)
  thinkTokenBudgetAtom.set(IN_BROWSER_THINK_TOKEN_BUDGET)
})

describe('raw tunable token-limit atoms (TARDIS-181)', () => {
  test('inBrowserMaxTokensAtom defaults to IN_BROWSER_MAX_TOKENS (4096)', () => {
    expect(IN_BROWSER_MAX_TOKENS).toBe(4096)
    expect(peek(inBrowserMaxTokensAtom)).toBe(4096)
  })

  test('thinkTokenBudgetAtom defaults to IN_BROWSER_THINK_TOKEN_BUDGET (2048)', () => {
    expect(IN_BROWSER_THINK_TOKEN_BUDGET).toBe(2048)
    expect(peek(thinkTokenBudgetAtom)).toBe(2048)
  })

  // These atoms are no longer self-persisted: their value is namespaced per
  // user by the settings sync layer (see settingsSync). The clamp behaviour the
  // generation path relies on is covered by the effective* views below.
})

describe('effectiveMaxTokensAtom (clamped generation view)', () => {
  test('passes an in-range value through unchanged', () => {
    inBrowserMaxTokensAtom.set(4000)
    expect(peek(effectiveMaxTokensAtom)).toBe(4000)
  })

  test('clamps a value below MIN up to MIN', () => {
    inBrowserMaxTokensAtom.set(MIN_IN_BROWSER_MAX_TOKENS - 1)
    expect(peek(effectiveMaxTokensAtom)).toBe(MIN_IN_BROWSER_MAX_TOKENS)
  })

  test('clamps a value above MAX down to MAX', () => {
    inBrowserMaxTokensAtom.set(MAX_IN_BROWSER_MAX_TOKENS + 1000)
    expect(peek(effectiveMaxTokensAtom)).toBe(MAX_IN_BROWSER_MAX_TOKENS)
  })

  test('falls back to the default 4096 for a NaN raw value', () => {
    inBrowserMaxTokensAtom.set(Number.NaN)
    expect(peek(effectiveMaxTokensAtom)).toBe(IN_BROWSER_MAX_TOKENS)
  })

  test('rounds a float to the nearest integer', () => {
    inBrowserMaxTokensAtom.set(4000.6)
    expect(peek(effectiveMaxTokensAtom)).toBe(4001)
  })
})

describe('effectiveThinkTokenBudgetAtom (clamped generation view)', () => {
  test('passes an in-range value through unchanged', () => {
    thinkTokenBudgetAtom.set(1000)
    expect(peek(effectiveThinkTokenBudgetAtom)).toBe(1000)
  })

  test('clamps a value below MIN up to MIN', () => {
    thinkTokenBudgetAtom.set(MIN_THINK_TOKEN_BUDGET - 1)
    expect(peek(effectiveThinkTokenBudgetAtom)).toBe(MIN_THINK_TOKEN_BUDGET)
  })

  test('clamps a value above MAX down to MAX', () => {
    thinkTokenBudgetAtom.set(MAX_THINK_TOKEN_BUDGET + 1000)
    expect(peek(effectiveThinkTokenBudgetAtom)).toBe(MAX_THINK_TOKEN_BUDGET)
  })

  test('falls back to the default 2048 for a NaN raw value', () => {
    thinkTokenBudgetAtom.set(Number.NaN)
    expect(peek(effectiveThinkTokenBudgetAtom)).toBe(IN_BROWSER_THINK_TOKEN_BUDGET)
  })

  test('rounds a float to the nearest integer', () => {
    thinkTokenBudgetAtom.set(1000.4)
    expect(peek(effectiveThinkTokenBudgetAtom)).toBe(1000)
  })
})
