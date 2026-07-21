import { rootRoute } from '@/app/model/routes'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderShadcnComponentsPage = lazyRoutePage(() => import('../ui/ShadcnComponentsPage'))

export const shadcnComponentsRoute = rootRoute.reatomRoute({
  path: 'components/shadcn',
  render() {
    return renderShadcnComponentsPage()
  },
})
