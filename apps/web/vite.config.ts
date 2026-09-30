import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Em desenvolvimento, a API roda em http://localhost:3000 e o Vite repassa a
// ela as mesmas rotas que o nginx repassa em produção.
const api = process.env.API_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': api,
      '/entrar/entra': api,
      '/oauth': api,
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'graficos'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
})
