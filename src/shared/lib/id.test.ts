import { afterEach, describe, expect, test } from 'vitest'
import { newId } from './id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('newId', () => {
  const originalRandomUUID = crypto.randomUUID

  afterEach(() => {
    // Restore the native API regardless of what a test did to it.
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: originalRandomUUID,
    })
  })

  test('returns a real UUID when crypto.randomUUID is available', () => {
    // jsdom runs in a secure context, so the native API is present.
    expect(newId()).toMatch(UUID_RE)
  })

  test('still returns a UUID via getRandomValues when randomUUID is missing', () => {
    // Simulate an insecure origin (http://notebook.com, bare-HTTP deploy): the
    // `crypto` global exists but `randomUUID` is undefined. The fallback must
    // still produce a UUID-shaped id, because the persisted/backend contract is
    // `format: uuid` — a non-UUID id here would break dev sync.
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    expect(newId()).toMatch(UUID_RE)
  })

  test('generated UUIDs are unique', () => {
    expect(newId()).not.toBe(newId())
  })
})
