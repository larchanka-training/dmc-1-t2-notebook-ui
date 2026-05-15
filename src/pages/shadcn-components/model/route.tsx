import { rootRoute } from '@/app/model/routes'
import ShadcnComponentsPage from '../ui/ShadcnComponentsPage'

export const shadcnComponentsRoute = rootRoute.reatomRoute({
  path: 'components/shadcn',
  render() {
    return <ShadcnComponentsPage />
  },
})
