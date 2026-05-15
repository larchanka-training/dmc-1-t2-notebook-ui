import { action, atom, withAsync, wrap } from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'

export const notebookListAtom = atom<notebookApi.Notebook[]>([], 'notebook.list')

export const createNotebookAction = action(async (title: string) => {
  const trimmed = title.trim()
  if (!trimmed) return null
  const nb = await wrap(notebookApi.create({ title: trimmed }))
  notebookListAtom.set((items) => [...items, nb])
  return nb
}, 'notebook.list.create').extend(withAsync())
