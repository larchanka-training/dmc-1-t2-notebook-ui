import { Suspense, lazy, type ComponentType, type ReactElement } from 'react'
import { PageFallback } from '@/app/ui/PageFallback'

/**
 * Route-level code splitting helper.
 *
 * Wraps a dynamic `import()` of a page component in `React.lazy` (created once,
 * at module scope — call this at the top of a page's `model/route.tsx`, not
 * inside `render()`, so the lazy identity stays stable across renders) and
 * returns a render function that mounts it inside a `Suspense` boundary with the
 * shared `PageFallback`.
 *
 * The route module itself stays eagerly imported (so `reatomRoute(...)`
 * registers the path at load time), while the heavy page component is split into
 * its own chunk fetched on first navigation.
 *
 *   const renderPage = lazyRoutePage(() => import('../ui/DashboardPage'))
 *   export const dashboardRoute = rootRoute.reatomRoute({
 *     path: 'dashboard',
 *     render: () => <AuthRouteGuard>{renderPage()}</AuthRouteGuard>,
 *   })
 */
export function lazyRoutePage(
  loader: () => Promise<{ default: ComponentType }>,
): () => ReactElement {
  const LazyPage = lazy(loader)
  return () => (
    <Suspense fallback={<PageFallback />}>
      <LazyPage />
    </Suspense>
  )
}
