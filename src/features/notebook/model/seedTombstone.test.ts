import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { clearSeedTombstone, isSeedTombstoned, setSeedTombstone } from './seedTombstone'

const USER = {
  id: 'AB-CD',
  email: 'a@b.com',
  displayName: null,
  createdAt: '2024-01-01T00:00:00Z',
  roles: [],
}

describe('seed tombstone (TARDIS-167 №23)', () => {
  beforeEach(async () => {
    await notebookStorage.clearAll()
    userAtom.set(USER)
  })
  afterEach(async () => {
    await notebookStorage.clearAll()
    userAtom.set(null)
  })

  test('is false before any deletion', async () => {
    expect(await isSeedTombstoned()).toBe(false)
  })

  test('set then is-tombstoned round-trips for the current user', async () => {
    await setSeedTombstone()
    expect(await isSeedTombstoned()).toBe(true)
  })

  test('clear removes the marker', async () => {
    await setSeedTombstone()
    await clearSeedTombstone()
    expect(await isSeedTombstoned()).toBe(false)
  })

  test('is keyed per account (case-insensitive owner id)', async () => {
    await setSeedTombstone()
    userAtom.set({ ...USER, id: 'other-user' })
    expect(await isSeedTombstoned()).toBe(false)
    // Same id in different case resolves to the same marker.
    userAtom.set({ ...USER, id: 'ab-cd' })
    expect(await isSeedTombstoned()).toBe(true)
  })

  test('is a no-op when signed out', async () => {
    userAtom.set(null)
    await setSeedTombstone()
    expect(await isSeedTombstoned()).toBe(false)
  })
})
