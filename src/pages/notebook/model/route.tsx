import { wrap } from '@reatom/core'
import { rootRoute } from '@/app/model/routes'
import { notebook as notebookApi } from '@/shared/api'
import { notebookListAtom } from '@/features/notebook'
import NotebookPage from '../ui/NotebookPage'

export const notebookRoute = rootRoute.reatomRoute({
  path: '',
  async loader() {
    const items = await wrap(notebookApi.list())
    notebookListAtom.set(items)
    return items
  },
  render() {
    return <NotebookPage />
  },
})
