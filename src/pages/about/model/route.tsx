import { rootRoute } from '@/app/model/routes'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderAboutPage = lazyRoutePage(() => import('../ui/AboutPage'))

// TARDIS-167 (№22): About is public — a reference page must not require sign-in.
// No AuthRouteGuard wrapper.
export const aboutRoute = rootRoute.reatomRoute({
  path: 'about',
  render() {
    return renderAboutPage()
  },
})
