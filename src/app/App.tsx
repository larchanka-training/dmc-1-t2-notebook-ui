import { reatomComponent } from '@reatom/react'
import { rootRoute } from './model/routes'
import '@/pages/notebook'
import '@/pages/login'
import '@/pages/about'
import '@/pages/shadcn-components'
import '@/pages/custom-components'

const App = reatomComponent(
  () => (
    <>
      <h1>This is demo pr preview</h1>
      {rootRoute.render()}
    </>
  ),
  'App',
)

export default App
