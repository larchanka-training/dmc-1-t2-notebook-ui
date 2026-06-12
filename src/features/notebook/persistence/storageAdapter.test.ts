import { describe, expect, test } from 'vitest'
import { isStaleWrite } from './storageAdapter'

// The conflict rule is shared by both backends' putIfNewer (disk + memory), so
// it is pinned here once — divergence here would diverge their conflict
// semantics, the exact failure the adapter layer prevents.
describe('isStaleWrite', () => {
  test('a null baseline treats any existing record as a conflict', () => {
    expect(isStaleWrite(0, null)).toBe(true)
    expect(isStaleWrite(1_700_000_000_000, null)).toBe(true)
  })

  test('a write is stale when the stored version is strictly newer than the baseline', () => {
    expect(isStaleWrite(20, 10)).toBe(true)
  })

  test('a write is fresh when the stored version equals the baseline', () => {
    expect(isStaleWrite(10, 10)).toBe(false)
  })

  test('a write is fresh when the stored version is older than the baseline', () => {
    expect(isStaleWrite(5, 10)).toBe(false)
  })

  // Guard-doc for the finite-number precondition in the JSDoc: pin the
  // non-finite behaviour so a future refactor can't silently change it.
  test('treats a NaN stored timestamp as a fresh write (NaN comparisons are false)', () => {
    expect(isStaleWrite(NaN, 10)).toBe(false)
  })

  test('a null baseline still wins over a NaN stored timestamp (null short-circuits)', () => {
    expect(isStaleWrite(NaN, null)).toBe(true)
  })

  test('treats Infinity as newer than any finite baseline', () => {
    expect(isStaleWrite(Infinity, 10)).toBe(true)
  })
})
