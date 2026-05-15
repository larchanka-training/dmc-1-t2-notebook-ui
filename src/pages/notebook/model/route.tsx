import { rootRoute } from '@/app/model/routes'
import NotebookPage from '../ui/NotebookPage'

export const notebookRoute = rootRoute.reatomRoute({
  path: '',
  render() {
    return <NotebookPage />
  },
})
