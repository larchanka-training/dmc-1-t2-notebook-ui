import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import UsagePage from '../ui/UsagePage'

export const usageRoute = rootRoute.reatomRoute({
  path: 'usage',
  render() {
    return (
      <AuthRouteGuard>
        <UsagePage />
      </AuthRouteGuard>
    )
  },
})
