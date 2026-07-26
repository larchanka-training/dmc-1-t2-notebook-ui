import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crossOriginIsolation } from './vite/coiPlugin'

// HMR WebSocket target when running behind the nginx proxy in Docker.
// In the container Vite listens on 5173 (host-mapped to 3000), but the browser
// reaches the app through the proxy on notebook.com. Vite can't infer the
// externally reachable WS endpoint, so it falls back to localhost:5173 and HMR
// never connects. These env vars (set by docker-compose) point the HMR client
// straight at Vite via the host-mapped port, bypassing nginx. Left unset for a
// bare `pnpm dev`, so Vite keeps its localhost:5173 default and HMR works too.
// See https://vite.dev/config/server-options.html#server-hmr
const hmrHost = process.env['VITE_HMR_HOST']
const hmrClientPort = process.env['VITE_HMR_CLIENT_PORT']
const hmrProtocol = process.env['VITE_HMR_PROTOCOL']

const hmr =
  hmrHost || hmrClientPort || hmrProtocol
    ? {
        ...(hmrHost ? { host: hmrHost } : {}),
        ...(hmrClientPort ? { clientPort: Number(hmrClientPort) } : {}),
        ...(hmrProtocol ? { protocol: hmrProtocol } : {}),
      }
    : undefined

// File-watching via polling. Docker Desktop on Windows mounts the host source
// over a WSL2/virtiofs bind, which does NOT forward inotify events, so the
// native watcher never fires and HMR stays silent even though file contents
// sync fine. Enabled by VITE_USE_POLLING=true (set by docker-compose). Off for
// a bare `pnpm dev`, where native FS events work and polling would just burn CPU.
const usePolling = process.env['VITE_USE_POLLING'] === 'true'
const watch = usePolling ? { usePolling: true, interval: 100 } : undefined

export default defineConfig({
  // Base public path. Defaults to '/'; set VITE_BASE (e.g. '/pr-42/') at build
  // time to serve the app under a path prefix (per-PR previews behind one
  // CloudFront/S3). Drives asset URLs and import.meta.env.BASE_URL.
  base: process.env['VITE_BASE'] ?? '/',
  plugins: [react(), tailwindcss(), crossOriginIsolation],
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party libraries out of the single ~6 MB main chunk
        // into their own hashed vendor chunks. These libs change far less often
        // than app code, so separate chunks let a returning user re-use them from
        // cache across deploys, enable parallel fetches, and clear Vite's
        // >500 kB single-chunk warning. Initial *bytes* are largely unchanged
        // while WebLLM/QuickJS are statically imported at bootstrap — deferring
        // those to dynamic import() is a separate follow-up.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@mlc-ai/web-llm')) return 'webllm'
          if (id.includes('quickjs')) return 'quickjs'
          if (id.includes('@codemirror') || id.includes('@lezer')) return 'codemirror'
          if (id.includes('katex') || id.includes('rehype-katex') || id.includes('remark-math'))
            return 'katex'
          if (id.includes('highlight.js') || id.includes('rehype-highlight')) return 'highlight'
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/scheduler/')
          )
            return 'react-vendor'
        },
      },
    },
  },
  server: {
    // Listen on all interfaces so the container is reachable from the host.
    host: true,
    port: 5173,
    allowedHosts: ['notebook.com', 'api.notebook.com', 'pgadmin.notebook.com'],
    ...(hmr ? { hmr } : {}),
    ...(watch ? { watch } : {}),
  },
  resolve: {
    tsconfigPaths: true,
  },
})
