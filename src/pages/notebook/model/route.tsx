import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import NotebookPage from '../ui/NotebookPage'

export const notebookRoute = rootRoute.reatomRoute({
  path: '',
  render() {
    return (
      <AuthRouteGuard>
        <NotebookPage />
      </AuthRouteGuard>
    )
  },
})
