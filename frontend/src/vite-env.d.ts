/// <reference types="vite/client" />

// Build-time version injected by Vite
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN: string | undefined
  readonly VITE_SENTRY_ENVIRONMENT: string | undefined
  readonly VITE_GIPHY_API_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
