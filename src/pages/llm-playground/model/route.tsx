import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import LlmPlaygroundPage from '../ui/LlmPlaygroundPage'

export const llmPlaygroundRoute = rootRoute.reatomRoute({
  path: 'llm-playground',
  render() {
    return (
      <AuthRouteGuard>
        <LlmPlaygroundPage />
      </AuthRouteGuard>
    )
  },
})
