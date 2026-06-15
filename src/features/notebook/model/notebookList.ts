import {
  action,
  computed,
  withAsync,
  withAsyncData,
  withRollback,
  withTransaction,
  wrap,
} from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { newId } from '@/shared/lib/id'
import { FORMAT_VERSION } from '../persistence/schema'

export const notebookListResource = computed(
  async () => await wrap(notebookApi.list()),
  'notebook.list',
).extend(withAsyncData({ initState: [] as notebookApi.NotebookListItem[] }))

notebookListResource.data.extend(withRollback())

/** Project a full notebook onto the lightweight list row (same id; FU2 reconcile). */
function toListItem(nb: notebookApi.Notebook): notebookApi.NotebookListItem {
  return {
    id: nb.id,
    title: nb.title,
    formatVersion: nb.formatVersion,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    cellsCount: nb.cells.length,
  }
}

export const createNotebookAction = action(async (title: string) => {
  const trimmed = title.trim()
  if (!trimmed) return null

  // Client-chosen UUID (FU1): the same id is both the optimistic row id AND the
  // `id` sent to POST. Server create is idempotent on the client id, so a lost
  // POST response retried by autosync (#134) cannot create a duplicate notebook.
  const id = newId()
  const now = Date.now()
  const optimistic: notebookApi.NotebookListItem = {
    id,
    title: trimmed,
    formatVersion: FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
    cellsCount: 0,
  }
  notebookListResource.data.set((items) => [...items, optimistic])

  const nb = await wrap(notebookApi.create({ id, title: trimmed, formatVersion: FORMAT_VERSION }))
  // FU2: reconcile the optimistic row with the server's authoritative values
  // (same id) BEFORE the refetch, so the row is correct even if the refetch
  // fails. Without this, a transient list failure after a committed POST would
  // roll the optimistic row back under withTransaction() — a false "create
  // failed" for a notebook that already exists on the server.
  notebookListResource.data.set((items) => items.map((it) => (it.id === id ? toListItem(nb) : it)))
  try {
    await wrap(notebookListResource.retry())
  } catch {
    // Best-effort refetch: the list invalidation is advisory. The reconciled
    // optimistic row stands until the next successful load. The create itself
    // succeeded, so we must not reject (that would roll the row back).
  }
  return nb
}, 'notebook.list.create').extend(withAsync(), withTransaction())
