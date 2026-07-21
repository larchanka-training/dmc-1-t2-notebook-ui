import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import { lazyRoutePage } from '@/app/ui/lazyRoutePage'

// Lazily loaded — non-critical route split out of the initial bundle.
const renderLlmPlaygroundPage = lazyRoutePage(() => import('../ui/LlmPlaygroundPage'))

export const llmPlaygroundRoute = rootRoute.reatomRoute({
  path: 'llm-playground',
  render() {
    return <AuthRouteGuard>{renderLlmPlaygroundPage()}</AuthRouteGuard>
  },
})
