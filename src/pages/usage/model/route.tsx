import { rootRoute } from '@/app/model/routes'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderUsagePage = lazyRoutePage(() => import('../ui/UsagePage'))

// TARDIS-167 (№22): Usage (Help) is public — a reference page must not require
// sign-in. No AuthRouteGuard wrapper. The seed-restore block inside UsagePage is
// gated on the signed-in user (the demo id is per-owner).
export const usageRoute = rootRoute.reatomRoute({
  path: 'usage',
  render() {
    return renderUsagePage()
  },
})
