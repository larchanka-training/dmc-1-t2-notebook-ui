import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isOnlineAtom, startOnlineTracking } from './online'

describe('online tracking', () => {
  let stop: () => void

  beforeEach(() => {
    isOnlineAtom.set(true)
    stop = startOnlineTracking()
  })

  afterEach(() => {
    stop()
    isOnlineAtom.set(true)
  })

  test('flips to offline on the offline event and back on online', () => {
    window.dispatchEvent(new Event('offline'))
    expect(isOnlineAtom()).toBe(false)
    window.dispatchEvent(new Event('online'))
    expect(isOnlineAtom()).toBe(true)
  })

  test('stops mirroring events after teardown', () => {
    stop()
    window.dispatchEvent(new Event('offline'))
    expect(isOnlineAtom()).toBe(true)
  })
})
