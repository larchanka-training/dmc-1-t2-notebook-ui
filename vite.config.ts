import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crossOriginIsolation } from './vite/coiPlugin'

export default defineConfig({
  // Base public path. Defaults to '/'; set VITE_BASE (e.g. '/pr-42/') at build
  // time to serve the app under a path prefix (per-PR previews behind one
  // CloudFront/S3). Drives asset URLs and import.meta.env.BASE_URL.
  base: process.env['VITE_BASE'] ?? '/',
  plugins: [react(), tailwindcss(), crossOriginIsolation],
  server: {
    allowedHosts: ['notebook.com', 'api.notebook.com', 'pgadmin.notebook.com'],
  },
  resolve: {
    tsconfigPaths: true,
  },
})
