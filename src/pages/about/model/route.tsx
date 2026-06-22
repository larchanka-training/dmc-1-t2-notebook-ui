import { rootRoute } from '@/app/model/routes'
import AboutPage from '../ui/AboutPage'

// TARDIS-167 (№22): About is public — a reference page must not require sign-in.
// No AuthRouteGuard wrapper.
export const aboutRoute = rootRoute.reatomRoute({
  path: 'about',
  render() {
    return <AboutPage />
  },
})
