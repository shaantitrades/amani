import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Build Bodogui : PWA statique, servie par Nginx.
 *
 * Contraintes prises en compte :
 *  - bundle leger (< 5 Mo) : pas de framework CSS, icones en SVG inline
 *  - connexions lentes : precache de l'app shell, cache des medias (CacheFirst),
 *    reseau d'abord pour les listes d'annonces, avec repli sur le cache
 *  - publication hors ligne : les annonces en attente vivent dans IndexedDB
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4000', changeOrigin: true },
      '/media': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4000', changeOrigin: true },
      '/voice': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2018', // compatible Android 5+ / Chrome anciens
    sourcemap: false,
    cssCodeSplit: true,
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          maps: ['leaflet', 'react-leaflet'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: false, // manifest statique dans public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,opus}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/media/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Listes d'annonces et referentiels : reseau d'abord, cache en secours
            urlPattern: /\/api\/v1\/(ads|search|bootstrap|categories|districts|groups)(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bodogui-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Photos et messages vocaux : immutables, servis depuis le cache
            urlPattern: /\/media\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bodogui-media',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Messages vocaux du systeme (multilingues)
            urlPattern: /\/voice\/.*\.opus$/,
            handler: 'CacheFirst',
            options: { cacheName: 'bodogui-voice', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            // Fonds de carte OpenStreetMap (tres utiles hors ligne partiel)
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bodogui-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
