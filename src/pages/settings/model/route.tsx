import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import SettingsPage from '../ui/SettingsPage'

// TARDIS-181: Settings holds per-user preferences (namespaced by user id), so it
// requires a signed-in user — gated by AuthRouteGuard like the notebook route.
export const settingsRoute = rootRoute.reatomRoute({
  path: 'settings',
  render() {
    return (
      <AuthRouteGuard>
        <SettingsPage />
      </AuthRouteGuard>
    )
  },
})
