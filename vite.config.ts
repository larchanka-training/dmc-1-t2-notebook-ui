import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crossOriginIsolation } from './vite/coiPlugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), crossOriginIsolation],
  server: {
    allowedHosts: ['notebook.com', 'api.notebook.com', 'pgadmin.notebook.com'],
  },
  resolve: {
    tsconfigPaths: true,
  },
})
