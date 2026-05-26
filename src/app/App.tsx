import { reatomComponent } from '@reatom/react'
import { rootRoute } from './model/routes'
import '@/pages/notebook'
import '@/pages/login'
import '@/pages/about'
import '@/pages/shadcn-components'
import '@/pages/custom-components'
import '@/features/notebook/_spike/spike-route'

const App = reatomComponent(() => rootRoute.render(), 'App')

export default App
