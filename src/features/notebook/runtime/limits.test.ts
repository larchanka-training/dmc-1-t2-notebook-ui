import { describe, expect, test } from 'vitest'
import { clampTimeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from './limits'

describe('clampTimeoutMs', () => {
  test('passes a normal value through unchanged', () => {
    expect(clampTimeoutMs(5_000)).toBe(5_000)
  })

  test('raises a too-small / zero / negative value to MIN', () => {
    expect(clampTimeoutMs(0)).toBe(MIN_TIMEOUT_MS)
    expect(clampTimeoutMs(-1)).toBe(MIN_TIMEOUT_MS)
    expect(clampTimeoutMs(10)).toBe(MIN_TIMEOUT_MS)
  })

  test('caps a too-large value at MAX', () => {
    expect(clampTimeoutMs(60 * 60_000)).toBe(MAX_TIMEOUT_MS)
  })

  test('falls back to the default for non-finite input', () => {
    expect(clampTimeoutMs(NaN)).toBe(DEFAULT_TIMEOUT_MS)
    expect(clampTimeoutMs(Infinity)).toBe(DEFAULT_TIMEOUT_MS)
  })

  test('the bounds are ordered MIN < DEFAULT < MAX', () => {
    expect(MIN_TIMEOUT_MS).toBeLessThan(DEFAULT_TIMEOUT_MS)
    expect(DEFAULT_TIMEOUT_MS).toBeLessThan(MAX_TIMEOUT_MS)
  })
})
