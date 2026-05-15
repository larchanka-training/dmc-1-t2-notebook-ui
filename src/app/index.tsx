import { rootFrame } from '../setup'
import { reatomContext } from '@reatom/react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './providers/AppProviders'
import { startBrowserMocking } from './mocks/browser'
import App from './App'
import './styles/index.css'

await startBrowserMocking()

// Import after mocks are intercepting — `./model/setup` triggers a session-restore
// fetch that must hit the mocked backend when MSW is enabled.
await import('./model/setup')

createRoot(document.getElementById('root')!).render(
  <reatomContext.Provider value={rootFrame}>
    <AppProviders>
      <App />
    </AppProviders>
  </reatomContext.Provider>,
)
