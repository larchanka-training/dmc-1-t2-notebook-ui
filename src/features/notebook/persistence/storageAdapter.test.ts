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
})
