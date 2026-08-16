import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Qnote — Katalog Ayat & Insight',
        short_name: 'Qnote',
        description:
          'Outliner offline-first untuk mengumpulkan ayat, mencatat tadabbur, dan melatih hafalan.',
        theme_color: '#0f766e',
        background_color: '#fbfaf7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'id',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Data Quran (2.9 MB, 114 file) SENGAJA tidak di-precache — menabrak batas
        // 2 MiB Workbox dan tidak perlu ada sebelum user membukanya. Font Arab justru
        // WAJIB precache: tanpa itu kartu ayat rusak total saat offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/data/quran/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/data\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Isinya tidak pernah berubah → CacheFirst, umur panjang.
            urlPattern: ({ url }) => url.pathname.startsWith('/data/quran/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'qnote-quran-data',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
