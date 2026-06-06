import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import AboutPage from '../ui/AboutPage'

export const aboutRoute = rootRoute.reatomRoute({
  path: 'about',
  render() {
    return (
      <AuthRouteGuard>
        <AboutPage />
      </AuthRouteGuard>
    )
  },
})
