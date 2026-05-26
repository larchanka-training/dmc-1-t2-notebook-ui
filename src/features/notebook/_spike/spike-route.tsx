// SPIKE — TARDIS-70. Self-registering route at /_spike/tardis-70.
// Imported once from App.tsx as a side effect, then dropped together with
// the rest of _spike/ at cleanup.
import { rootRoute } from '@/app/model/routes'
import SpikePage from './SpikePage'

export const spikeRoute = rootRoute.reatomRoute({
  path: '_spike/tardis-70',
  render() {
    return <SpikePage />
  },
})
