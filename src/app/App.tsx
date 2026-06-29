import { reatomComponent } from '@reatom/react'
import { rootRoute } from './model/routes'
import '@/pages/notebook'
import '@/pages/dashboard'
import '@/pages/login'
import '@/pages/about'
import '@/pages/usage'
import '@/pages/settings'
import '@/pages/shadcn-components'
import '@/pages/custom-components'
import '@/pages/llm-playground'

const App = reatomComponent(() => rootRoute.render(), 'App')

export default App
