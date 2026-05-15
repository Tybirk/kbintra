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

import {
  MantineProvider,
  SegmentedControl,
  Title,
  Typography,
  createTheme,
} from "@mantine/core"

import { DateInput, DatePickerInput, DatesProvider } from "@mantine/dates"

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

const theme = createTheme({
  primaryColor: "blue",

  // Automatically flip button/badge text to black or white based on background luminance

  autoContrast: true,

  fontFamily: "Inter, system-ui, sans-serif",

  fontSizes: {
    xs: "0.8125rem", // 13px (was 12px)
    sm: "0.9375rem", // 15px (was 14px)
    md: "1.0625rem", // 17px (was 16px)
    lg: "1.1875rem", // 19px (was 18px)
    xl: "1.3125rem", // 21px (was 20px)
  },

  headings: {
    fontFamily: "Inter, system-ui, sans-serif",
  },

  // Higher contrast dark palette:

  //   dark[0] → text color in dark mode (brighter, toward white)

  //   dark[7] → page body background (deeper, toward black)

  colors: {
    dark: [
      "#E8EAED", // [0] primary text — near-white (default ~#C9C9C9)

      "#C9CDD6", // [1]

      "#A0A5B0", // [2] dimmed text

      "#696E7B", // [3]

      "#4A4F5C", // [4] borders

      "#383C48", // [5] inner item card hover backgrounds

      "#232630", // [6] section card backgrounds (Paper) — elevated above body

      "#0C0D12", // [7] body background — near black (default ~#242424)

      "#08090D", // [8]

      "#050507", // [9] darkest
    ],
  },

  components: {
    Typography: Typography.extend({
      styles: {
        root: { overflowWrap: "break-word" },
      },
    }),

    Title: Title.extend({
      styles: {
        root: { overflowWrap: "break-word" },
      },
    }),

    DateInput: DateInput.extend({
      defaultProps: { valueFormat: "D. MMMM YYYY" },
    }),

    DatePickerInput: DatePickerInput.extend({
      defaultProps: { valueFormat: "D. MMMM YYYY" },
    }),

    SegmentedControl: SegmentedControl.extend({
      defaultProps: { color: "blue" },
    }),
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
