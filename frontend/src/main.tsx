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
import { MantineProvider, Typography, createTheme } from "@mantine/core"
import { Notifications } from "@mantine/notifications"
import * as Sentry from "@sentry/react"

import "@mantine/core/styles.css"
import "@mantine/carousel/styles.css"
import "@mantine/notifications/styles.css"
import "@mantine/dates/styles.css"
import "@mantine/dropzone/styles.css"
import "@mantine/tiptap/styles.css"
import "@mantine/spotlight/styles.css"
import "@mantine/schedule/styles.css"
import "./accessibility.css"

import App from "./App"
import { initAccessibilityMode } from "./hooks/useAccessibilityMode"

// Apply stored accessibility preference before first render to avoid flash
initAccessibilityMode()

// Sentry: initialize before the app renders so all errors are captured from the start.
// VITE_SENTRY_DSN must be set at build time; if absent, Sentry is a no-op.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "development",
    release: `kb-intra@${__APP_VERSION__}`,
    integrations: [
      // Performance: tracks navigation and page load times per route pattern
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      // Session Replay: records user interactions leading up to an error
      Sentry.replayIntegration({
        maskAllText: true, // Mask all text for privacy
        blockAllMedia: true, // Block media elements
      }),
    ],
    // Performance: sample 10% of navigations as traces
    tracesSampleRate: 0.1,
    // Session Replay: don't record every session, but always capture when there's an error
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
  })
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
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
)
