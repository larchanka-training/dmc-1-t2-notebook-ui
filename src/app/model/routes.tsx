import { reatomRoute } from '@reatom/core'
import { AppLayout } from '../layouts/AppLayout'

// Base path for the whole app. Vite sets import.meta.env.BASE_URL from the
// build-time `base` ('/' normally, '/pr-42/' for per-PR previews). Giving the
// root route this prefix makes every nested route compose under it
// (e.g. '/pr-42/login'), so the same build works under any path prefix.
const basePath = import.meta.env.BASE_URL.replace(/^\/|\/$/g, '')

export const rootRoute = reatomRoute({
  path: basePath,
  layout: true,
  render(self) {
    return <AppLayout>{self.outlet()}</AppLayout>
  },
})
