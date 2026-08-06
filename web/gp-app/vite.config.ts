import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Production: FastAPI serves /gp → index.html and /gp/assets/* from dist.
export default defineConfig({
  plugins: [react()],
  base: '/gp/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'https://portfolio.dgacapital.com',
        changeOrigin: true,
        secure: true,
      },
      '/branding': {
        target: process.env.VITE_API_PROXY || 'https://portfolio.dgacapital.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
