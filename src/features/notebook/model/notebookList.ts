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

export const notebookListResource = computed(
  async () => await wrap(notebookApi.list()),
  'notebook.list',
).extend(withAsyncData({ initState: [] as notebookApi.Notebook[] }))

notebookListResource.data.extend(withRollback())

export const createNotebookAction = action(async (title: string) => {
  const trimmed = title.trim()
  if (!trimmed) return null

  const optimistic: notebookApi.Notebook = {
    id: `tmp-${crypto.randomUUID()}`,
    title: trimmed,
    createdAt: new Date().toISOString(),
    cells: [],
  }
  notebookListResource.data.set((items) => [...items, optimistic])

  const nb = await wrap(notebookApi.create({ title: trimmed }))
  await wrap(notebookListResource.retry())
  return nb
}, 'notebook.list.create').extend(withAsync(), withTransaction())
