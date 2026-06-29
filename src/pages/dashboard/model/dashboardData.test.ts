import { describe, expect, test } from 'vitest'
import type { notebook as notebookApi } from '@/shared/api'
import type { LocalNotebookSummary } from '@/features/notebook'
import { mergeDashboardCards } from './dashboardData'

// `formatVersion` is irrelevant to the merge; a literal keeps the test free of
// any persistence/schema import (the page boundary the merge now respects).
const FORMAT_VERSION = 1

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

// Local notebooks now reach the merge as page-safe summaries (cellsCount === 2
// here, matching the assertions below).
const localNb = (id: string, title: string, createdAt: number): LocalNotebookSummary => ({
  id,
  title,
  createdAt,
  updatedAt: createdAt + 5,
  cellsCount: 2,
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

  test('the active notebook card shows the live editor title over a stale server title', () => {
    // The server list still has the pre-rename title; the editor (activeTitle)
    // has the new one. The active card must reflect the live title.
    const server = [serverRow('a', 'Old name', 100)]
    const cards = mergeDashboardCards(server, [], 'a', 'New name')
    expect(cards.find((c) => c.id === 'a')?.title).toBe('New name')
  })

  test('does not override a non-active row with the active title', () => {
    const server = [serverRow('a', 'A title', 100), serverRow('b', 'B title', 200)]
    // 'a' is active; 'b' must keep its own server title.
    const cards = mergeDashboardCards(server, [], 'a', 'Live A')
    expect(cards.find((c) => c.id === 'b')?.title).toBe('B title')
    expect(cards.find((c) => c.id === 'a')?.title).toBe('Live A')
  })
})
