import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderSettingsPage = lazyRoutePage(() => import('../ui/SettingsPage'))

// TARDIS-181: Settings holds per-user preferences (namespaced by user id), so it
// requires a signed-in user — gated by AuthRouteGuard like the notebook route.
export const settingsRoute = rootRoute.reatomRoute({
  path: 'settings',
  render() {
    return <AuthRouteGuard>{renderSettingsPage()}</AuthRouteGuard>
  },
})
