import './model/setup'

import { rootFrame } from '../setup'
import { reatomContext } from '@reatom/react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './providers/AppProviders'
import App from './App'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <reatomContext.Provider value={rootFrame}>
    <AppProviders>
      <App />
    </AppProviders>
  </reatomContext.Provider>,
)
