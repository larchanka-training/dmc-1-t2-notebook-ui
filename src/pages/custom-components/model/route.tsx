import { rootRoute } from '@/app/model/routes'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderCustomComponentsPage = lazyRoutePage(() => import('../ui/CustomComponentsPage'))

export const customComponentsRoute = rootRoute.reatomRoute({
  path: 'components/custom',
  render() {
    return renderCustomComponentsPage()
  },
})
