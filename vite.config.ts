import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Cross-origin isolation headers. They put the page into a "cross-origin
// isolated" context, which is the precondition for `SharedArrayBuffer`.
// The runtime uses a SAB to interrupt a blocked QuickJS VM (Stop / Stop All)
// without tearing down the worker, so the shared scope survives a stop.
// Without isolation the runtime falls back to terminating the worker.
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: { middlewares: { use: (fn: CoiMiddleware) => void } }) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      next()
    })
  },
}

type CoiMiddleware = (
  req: unknown,
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
) => void

export default defineConfig({
  plugins: [react(), tailwindcss(), crossOriginIsolation],
  server: {
    allowedHosts: ['notebook.com', 'api.notebook.com', 'pgadmin.notebook.com'],
  },
  resolve: {
    tsconfigPaths: true,
  },
})
