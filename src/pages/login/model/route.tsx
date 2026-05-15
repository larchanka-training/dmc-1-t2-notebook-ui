import { rootRoute } from '@/app/model/routes'
import LoginPage from '../ui/LoginPage'

export const loginRoute = rootRoute.reatomRoute({
  path: 'login',
  render() {
    return <LoginPage />
  },
})
