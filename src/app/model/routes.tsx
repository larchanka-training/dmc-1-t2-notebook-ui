import { Children } from 'react'
import { reatomRoute } from '@reatom/core'
import { AppLayout } from '../layouts/AppLayout'

export const rootRoute = reatomRoute({
  layout: true,
  render(self) {
    return <AppLayout>{Children.toArray(self.outlet())}</AppLayout>
  },
})
