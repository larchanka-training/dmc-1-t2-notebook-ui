import { rootRoute } from '@/app/model/routes'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderAuthorsPage = lazyRoutePage(() => import('../ui/AuthorsPage'))

// Authors is public — a credits/reference page must not require sign-in
// (same reasoning as About, TARDIS-167 №22). No AuthRouteGuard wrapper.
export const authorsRoute = rootRoute.reatomRoute({
  path: 'authors',
  render() {
    return renderAuthorsPage()
  },
})
