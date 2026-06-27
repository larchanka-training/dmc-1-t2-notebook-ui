import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// `@/setup`'s real module calls clearStack() at import and owns the production
// rootFrame, which fights the shared `context.reset()` in test setup. Mock it so
// `rootFrame.run(fn)` runs `fn` in the test's ambient frame (same pattern as
// crossTabSync.test.ts).
vi.mock('@/setup', () => ({ rootFrame: { run: (fn: () => unknown) => fn() } }))

import { peek } from '@reatom/core'
import { userAtom } from '@/entities/session'
import { notebook as notebookApi } from '@/shared/api'
import { FORMAT_VERSION } from '../persistence/schema'
import { notebookListResource } from './notebookList'
import { startNotebookListCrossTabSync } from './notebookListCrossTab'

const STORAGE_KEY = 'notebook.list.crosstab'
const OWNER = 'owner-1'

function listItem(id: string, title: string): notebookApi.NotebookListItem {
  return { id, title, formatVersion: FORMAT_VERSION, createdAt: 0, updatedAt: 0, cellsCount: 0 }
}

function broadcast(ownerId: string, items: notebookApi.NotebookListItem[]): string {
  return JSON.stringify({ ownerId, items })
}

function emitStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('startNotebookListCrossTabSync', () => {
  let stop: () => void

  beforeEach(() => {
    localStorage.clear()
    userAtom.set({ id: OWNER, email: 'a@b.c', displayName: null, roles: [] })
    notebookListResource.data.set([])
    stop = startNotebookListCrossTabSync()
  })

  afterEach(() => {
    stop()
    localStorage.clear()
    notebookListResource.data.set([])
    userAtom.set(null)
  })

  test('WRITER: a local list change is written to localStorage (owner-stamped)', async () => {
    const rows = [listItem('a', 'A')]
    notebookListResource.data.set(rows)
    // `withChangeHook` fires the side-effect asynchronously (enqueued as a hook).
    await new Promise((resolve) => setTimeout(resolve))

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(stored).toEqual({ ownerId: OWNER, items: rows })
  })

  test('READER: an incoming list from another tab is applied to the resource', () => {
    const rows = [listItem('a', 'A'), listItem('b', 'B')]
    emitStorage(STORAGE_KEY, broadcast(OWNER, rows))
    expect(peek(notebookListResource.data)).toEqual(rows)
  })

  test('READER: ignores a payload owned by a different account', () => {
    notebookListResource.data.set([listItem('mine', 'Mine')])
    emitStorage(STORAGE_KEY, broadcast('someone-else', [listItem('theirs', 'Theirs')]))
    expect(peek(notebookListResource.data)).toEqual([listItem('mine', 'Mine')])
  })

  test('echo-safe: applying a remote update does not re-broadcast a different value', async () => {
    const rows = [listItem('a', 'A')]
    emitStorage(STORAGE_KEY, broadcast(OWNER, rows))
    await new Promise((resolve) => setTimeout(resolve))
    // The applied value equals the incoming one, so the writer must not rewrite a
    // different record (no ping-pong). The stored key stays the same payload.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(stored.items).toEqual(rows)
  })

  test('stops applying after the returned unsubscribe', () => {
    stop()
    emitStorage(STORAGE_KEY, broadcast(OWNER, [listItem('late', 'Late')]))
    expect(peek(notebookListResource.data)).toEqual([])
  })
})
