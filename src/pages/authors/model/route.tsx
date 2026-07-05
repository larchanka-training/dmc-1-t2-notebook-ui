import { rootRoute } from '@/app/model/routes'
import AuthorsPage from '../ui/AuthorsPage'

// Authors is public — a credits/reference page must not require sign-in
// (same reasoning as About, TARDIS-167 №22). No AuthRouteGuard wrapper.
export const authorsRoute = rootRoute.reatomRoute({
  path: 'authors',
  render() {
    return <AuthorsPage />
  },
})
