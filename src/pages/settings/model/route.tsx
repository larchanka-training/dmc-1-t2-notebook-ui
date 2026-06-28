import { rootRoute } from '@/app/model/routes'
import SettingsPage from '../ui/SettingsPage'

// TARDIS-181: Settings is in-browser only (device-local prefs in localStorage),
// so it is public — no AuthRouteGuard. The display-name field still only affects
// the sidebar when signed in, but model/limits prefs apply logged-out too.
export const settingsRoute = rootRoute.reatomRoute({
  path: 'settings',
  render() {
    return <SettingsPage />
  },
})
