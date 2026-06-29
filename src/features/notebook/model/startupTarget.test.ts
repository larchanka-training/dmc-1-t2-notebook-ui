import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION } from '../persistence/schema'
import { writeLastOpenedId } from './lastOpened'
import { resolveStartupTarget, setStartViewReader, type StartViewChoice } from './startupTarget'

const USER = { id: 'owner-A', roles: [] }
const NB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

// Ownership lives only in the sync-state ownerId (NotebookJSON carries none).
const putOwned = async (id: string, ownerId: string) => {
  await notebookStorage.put({
    formatVersion: FORMAT_VERSION,
    id,
    title: `nb-${id}`,
    createdAt: 1,
    updatedAt: 1,
    cells: [],
  })
  await notebookStorage.putSyncState({
    notebookId: id,
    remoteCreated: true,
    dirty: false,
    ownerId,
    deletedCells: [],
  })
}

const setStartView = (v: StartViewChoice) => setStartViewReader(() => v)

describe('resolveStartupTarget (TARDIS-183, 4 rules)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await notebookStorage.clearAll()
    userAtom.set(USER as never)
    // Default reader between tests; individual tests override as needed.
    setStartView('last-opened')
  })
  afterEach(async () => {
    localStorage.clear()
    await notebookStorage.clearAll()
    userAtom.set(null)
    setStartView('last-opened')
  })

  // Rule 1: clean user (no owned local, no stored last-opened) → arm the slot on
  // nothing (loadNotebook seeds), no dashboard.
  test('rule 1 — clean user: notebookId null, showDashboard false', async () => {
    setStartView('last-opened')
    expect(await resolveStartupTarget()).toEqual({ notebookId: null, showDashboard: false })
  })

  // Rule 2: startView=dashboard → showDashboard true (slot still armed underneath).
  test('rule 2 — startView dashboard: showDashboard true', async () => {
    setStartView('dashboard')
    const target = await resolveStartupTarget()
    expect(target.showDashboard).toBe(true)
  })

  // Rule 3: startView=last-opened + an owned stored last-opened → arm that id.
  test('rule 3 — last-opened: notebookId is the owned stored id', async () => {
    await putOwned(NB, USER.id)
    writeLastOpenedId(USER.id, NB)
    setStartView('last-opened')
    expect(await resolveStartupTarget()).toEqual({ notebookId: NB, showDashboard: false })
  })

  // Rule 4 (default): no explicit dashboard choice + owned last-opened present →
  // open it; otherwise null (loadNotebook picks newest). Same as rule 3 path.
  test('rule 4 — default opens owned last-opened when present', async () => {
    await putOwned(NB, USER.id)
    writeLastOpenedId(USER.id, NB)
    // Default reader is 'last-opened'.
    const target = await resolveStartupTarget()
    expect(target).toEqual({ notebookId: NB, showDashboard: false })
  })

  test('rule 4 — default falls back to null (newest) when no last-opened is stored', async () => {
    await putOwned(NB, USER.id) // owned, but never recorded as last-opened
    const target = await resolveStartupTarget()
    expect(target.notebookId).toBeNull()
  })

  // Cross-account safety (§11): a stored last-opened owned by another account is
  // never armed for the current user.
  test('does not arm a last-opened id owned by another account', async () => {
    await putOwned(NB, 'someone-else')
    writeLastOpenedId(USER.id, NB)
    setStartView('last-opened')
    expect(await resolveStartupTarget()).toEqual({ notebookId: null, showDashboard: false })
  })

  // dashboard + an owned last-opened: the slot is still armed on that id, and we
  // additionally navigate to the dashboard.
  test('dashboard view still arms the owned last-opened underneath', async () => {
    await putOwned(NB, USER.id)
    writeLastOpenedId(USER.id, NB)
    setStartView('dashboard')
    expect(await resolveStartupTarget()).toEqual({ notebookId: NB, showDashboard: true })
  })
})
