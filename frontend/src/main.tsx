import { StrictMode, useEffect } from "react"

import { createRoot } from "react-dom/client"

import {
  BrowserRouter,
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { MantineProvider } from "@mantine/core"

import { DatesProvider } from "@mantine/dates"

import { Notifications } from "@mantine/notifications"

import * as Sentry from "@sentry/react"

import dayjs from "dayjs"

import relativeTime from "dayjs/plugin/relativeTime"

import "dayjs/locale/da"

dayjs.locale("da")

dayjs.extend(relativeTime)

// Only CSS used by always-mounted components belongs here. Per-feature CSS
// (tiptap, dropzone, schedule, carousel, spotlight) is imported alongside the
// lazy components that need it, so Vite code-splits it into the route chunks.

import "@mantine/core/styles.css"

import "@mantine/notifications/styles.css"

import "@mantine/dates/styles.css"

import "./index.css"

import "./accessibility.css"

import App from "./App"

import { theme } from "./theme"

import { initAccessibilityMode } from "./hooks/useAccessibilityMode"

// Apply stored accessibility preference before first render to avoid flash

initAccessibilityMode()

// Sentry: deferred to idle time so its DOM observers (Replay, BrowserTracing)
// don't compete with the first React render. Errors during the first ~50 ms are
// extremely rare and acceptably traded for a faster first paint.
// VITE_SENTRY_DSN must be set at build time; if absent, Sentry is a no-op.

const sentryDsn = import.meta.env.VITE_SENTRY_DSN

if (sentryDsn) {
  const initSentry = () => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "development",
      release: `kb-intra@${__APP_VERSION__}`,
      integrations: [
        Sentry.reactRouterV6BrowserTracingIntegration({
          useEffect,
          useLocation,
          useNavigationType,
          createRoutesFromChildren,
          matchRoutes,
        }),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.0,
      replaysOnErrorSampleRate: 1.0,
    })
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(initSentry, { timeout: 2000 })
  } else {
    setTimeout(initSentry, 200)
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 15, // 15 seconds

      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response
          ?.status

        if (status && status >= 400 && status < 500) return false

        return failureCount < 2
      },
    },
  },
})

// Defer the first React render so the browser can paint the inline splash
// from index.html before React's synchronous mount blocks the main thread.
// A single rAF fires *before* the next paint, so React would still mount in
// the same frame as the splash. Double rAF gives the browser one paint with
// the splash, then mounts on the next frame.
const mount = () => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <DatesProvider settings={{ locale: "da" }}>
            <Notifications position="top-right" />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </DatesProvider>
        </MantineProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

requestAnimationFrame(() => requestAnimationFrame(mount))
