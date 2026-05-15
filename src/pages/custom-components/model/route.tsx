import { rootRoute } from '@/app/model/routes'
import CustomComponentsPage from '../ui/CustomComponentsPage'

export const customComponentsRoute = rootRoute.reatomRoute({
  path: 'components/custom',
  render() {
    return <CustomComponentsPage />
  },
})
