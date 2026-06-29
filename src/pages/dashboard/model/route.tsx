import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import DashboardPage from '../ui/DashboardPage'

// TARDIS-183: the dashboard lists the signed-in user's notebooks, so it requires
// a user — gated by AuthRouteGuard like the notebook/settings routes.
export const dashboardRoute = rootRoute.reatomRoute({
  path: 'dashboard',
  render() {
    return (
      <AuthRouteGuard>
        <DashboardPage />
      </AuthRouteGuard>
    )
  },
})
