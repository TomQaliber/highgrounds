import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { createProxyMiddleware } from './server/vite-proxy.ts'

function apiProxyPlugin(): Plugin {
  return {
    name: 'high-grounds-api-proxy',
    configureServer(server) {
      createProxyMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      createProxyMiddleware(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
