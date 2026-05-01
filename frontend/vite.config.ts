import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { writeFileSync } from 'fs';

// Generate version based on build timestamp
const appVersion = new Date().toISOString();

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    // Only generate source maps when SENTRY_AUTH_TOKEN is present so they get uploaded and deleted.
    // Without the token the .map files would be committed to the dist and served publicly.
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN,
    // Generate version.json file after build
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendors needed for first paint on every route
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mantine-core': [
            '@mantine/core',
            '@mantine/hooks',
            '@mantine/notifications',
            '@mantine/dates',
          ],
          // Mantine extras only used by specific (lazy) pages — split out so
          // they don't ship with the initial bundle.
          'vendor-mantine-tiptap': ['@mantine/tiptap'],
          'vendor-mantine-schedule': ['@mantine/schedule'],
          'vendor-mantine-carousel': ['@mantine/carousel'],
          'vendor-mantine-dropzone': ['@mantine/dropzone'],
          'vendor-mantine-spotlight': ['@mantine/spotlight'],
          'vendor-tiptap': [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-link',
            '@tiptap/extension-mention',
            '@tiptap/extension-placeholder',
            '@tiptap/suggestion',
            '@tiptap/core',
          ],
          'vendor-sentry': ['@sentry/react'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
      plugins: [
        {
          name: 'generate-version',
          writeBundle() {
            writeFileSync(
              'dist/version.json',
              JSON.stringify({ version: appVersion, buildTime: appVersion })
            );
          },
        },
      ],
    },
  },
  plugins: [
    ...(command === 'serve'
      ? [
          {
            name: 'dev-title',
            transformIndexHtml(html: string) {
              return html.replace('<title>KB Intra</title>', '<title>DEV - KB Intra</title>');
            },
          },
        ]
      : []),
    react(),
    // Upload source maps to Sentry at build time (only when auth token is provided, e.g. in CI/CD)
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: `kb-intra@${appVersion}` },
            // Source maps are deleted from the dist after upload so they're not publicly served
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          }),
        ]
      : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'KB Intra',
        short_name: 'KBIntra',
        description: 'Community communication platform',
        theme_color: '#228be6',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallbackDenylist: [/^\/admin/, /^\/api/, /^\/media/, /^\/static/],
      },
      // Use custom service worker to handle push notifications
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
    },
  },
}));
