import { reatomRoute } from '@reatom/core'
import { AppLayout } from '../layouts/AppLayout'
import { NotFoundPage } from '@/pages/not-found'

// Base path for the whole app. Vite sets import.meta.env.BASE_URL from the
// build-time `base` ('/' normally, '/pr-42/' for per-PR previews). Giving the
// root route this prefix makes every nested route compose under it
// (e.g. '/pr-42/login'), so the same build works under any path prefix.
const basePath = import.meta.env.BASE_URL.replace(/^\/|\/$/g, '')

export const rootRoute = reatomRoute({
  path: basePath,
  layout: true,
  render(self) {
    // TARDIS-167 (№14): the root is a layout, so `outlet()` holds the rendered
    // children of whichever child route matched. When NO child matches (an
    // unknown URL under the base path), the outlet is empty — render the 404
    // page instead of a blank shell. The exact base URL is handled by the
    // notebook route (path ''), so an empty outlet means a genuine no-match.
    const children = self.outlet()
    const content = children.length > 0 ? children : <NotFoundPage />
    return <AppLayout>{content}</AppLayout>
  },
})
