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
  await wrap(notebookListResource.retry())
  return nb
}, 'notebook.list.create').extend(withAsync(), withTransaction())
