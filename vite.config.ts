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
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
