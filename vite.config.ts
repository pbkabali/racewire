import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Racewire's dev port. Fixed so it never collides with the other projects
 *  on this machine -- 5173 is already taken locally. */
const DEV_PORT = 5399

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: DEV_PORT,
    // Fail rather than silently moving to the next free port. A drifting port
    // means screenshots and smoke tests can end up hitting a different app
    // entirely, which is exactly what happened on 5173.
    strictPort: true,
  },
  preview: {
    port: DEV_PORT,
    strictPort: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest lets us own the service worker file, which is required:
      // Firebase Cloud Messaging needs its background handler in the same
      // worker, and a generated one cannot host that.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
      },
      devOptions: {
        /*
         * Off in dev, on purpose.
         *
         * A service worker in development buys nothing and breaks things in
         * ways that look like application bugs. It has cost us twice: a stale
         * registration served an outdated dynamic import ("Failed to fetch
         * dynamically imported module"), and then intercepted Firebase's
         * sendVerificationCode call so phone auth failed with
         * network-request-failed alongside a 400.
         *
         * Production is unaffected and still ships the full worker; offline
         * behaviour is tested against a deployed build, which is the only place
         * it behaves realistically anyway.
         */
        enabled: false,
        type: 'module',
      },
      manifest: {
        name: 'Racewire',
        short_name: 'Racewire',
        description: 'Live noticeboard for race day.',
        theme_color: '#0b0b0c',
        background_color: '#0b0b0c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
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
    }),
  ],
})
