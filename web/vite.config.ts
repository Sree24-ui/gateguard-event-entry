import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'GateGuard — Event Entry',
        short_name: 'GateGuard',
        description: 'QR ticketing, gate scanning and live attendance for college events.',
        theme_color: '#0f0e12',
        background_color: '#f6f8f7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // The API is deliberately absent from runtimeCaching. Caching
        // authenticated responses would let one operator's device serve
        // another's data, and a stale attendance count is worse than none.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true
      },
      devOptions: { enabled: false }
    })
  ],
  server: {
    port: 5173,
    // Same-origin in development too, so session cookies behave exactly as
    // they do in production.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true }
    }
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false
  }
});
