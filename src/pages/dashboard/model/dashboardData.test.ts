import { describe, expect, test } from 'vitest'
import type { notebook as notebookApi } from '@/shared/api'
import type { NotebookJSON } from '@/features/notebook/persistence/schema'
import { FORMAT_VERSION } from '@/features/notebook/persistence/schema'
import { mergeDashboardCards } from './dashboardData'

const serverRow = (
  id: string,
  title: string,
  createdAt: number,
  cellsCount = 3,
): notebookApi.NotebookListItem => ({
  id,
  title,
  formatVersion: FORMAT_VERSION,
  createdAt,
  updatedAt: createdAt + 10,
  cellsCount,
})

const localNb = (id: string, title: string, createdAt: number): NotebookJSON => ({
  formatVersion: FORMAT_VERSION,
  id,
  title,
  createdAt,
  updatedAt: createdAt + 5,
  cells: [
    { id: 'c1', kind: 'code', content: '', updatedAt: createdAt },
    { id: 'c2', kind: 'code', content: '', updatedAt: createdAt },
  ],
})

const FLOOR = '00000000-0000-4000-8000-000000000001'

describe('mergeDashboardCards (TARDIS-183)', () => {
  test('merges server rows and owned local rows (server metadata wins on id collision)', () => {
    const server = [serverRow('a', 'Server A', 100)]
    const local = [localNb('a', 'Local A stale', 100), localNb('b', 'Local-only B', 200)]

    const cards = mergeDashboardCards(server, local, 'a', 'Server A')

    // 'a' appears once, from the server row (its cellsCount=3, not the local 2).
    const a = cards.filter((c) => c.id === 'a')
    expect(a).toHaveLength(1)
    expect(a[0].title).toBe('Server A')
    expect(a[0].cellsCount).toBe(3)
    // 'b' is the local-only notebook, carried from IndexedDB.
    const b = cards.find((c) => c.id === 'b')
    expect(b).toMatchObject({ title: 'Local-only B', cellsCount: 2 })
  })

  test('orders newest-first by createdAt', () => {
    const server = [serverRow('old', 'Old', 100), serverRow('new', 'New', 300)]
    const cards = mergeDashboardCards(server, [], 'new', 'New')
    expect(cards.map((c) => c.id)).toEqual(['new', 'old'])
  })

  test('offline (no server rows) shows owned local notebooks only', () => {
    // Server list unavailable → empty (the resource init/offline state); the
    // dashboard still lists the owned local notebooks.
    const cards = mergeDashboardCards([], [localNb('x', 'Local X', 50)], 'x', 'Local X')
    expect(cards.map((c) => c.id)).toEqual(['x'])
    expect(cards[0]).toMatchObject({ title: 'Local X', cellsCount: 2 })
  })

  test('adds a synthetic floor card for the active id when absent, sorted last', () => {
    const server = [serverRow('a', 'A', 100)]
    const cards = mergeDashboardCards(server, [], FLOOR, 'My seed')

    const floor = cards.find((c) => c.id === FLOOR)
    expect(floor).toEqual({ id: FLOOR, title: 'My seed' })
    // No createdAt on the floor → it sorts after the dated server row.
    expect(cards[cards.length - 1].id).toBe(FLOOR)
  })

  test('does NOT double the floor card when the seed is already a local row (dedupe by id)', () => {
    // The seed exists locally (id === active id) AND would also be the floor —
    // only one card must result.
    const local = [localNb(FLOOR, 'Welcome', 10)]
    const cards = mergeDashboardCards([], local, FLOOR, 'Welcome')
    expect(cards.filter((c) => c.id === FLOOR)).toHaveLength(1)
    // The real local row (with metadata) is kept, not a bare floor card.
    expect(cards[0]).toMatchObject({ id: FLOOR, title: 'Welcome', cellsCount: 2 })
  })

  test('uses the fallback title for a floor card with an empty active title', () => {
    const cards = mergeDashboardCards([], [], FLOOR, '')
    expect(cards).toEqual([{ id: FLOOR, title: 'Untitled notebook' }])
  })
})
