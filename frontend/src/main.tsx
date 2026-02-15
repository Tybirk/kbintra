import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MantineProvider, createTheme } from "@mantine/core"
import { Notifications } from "@mantine/notifications"

import "@mantine/core/styles.css"
import "@mantine/carousel/styles.css"
import "@mantine/notifications/styles.css"
import "@mantine/dates/styles.css"
import "@mantine/dropzone/styles.css"
import "@mantine/tiptap/styles.css"
import "@mantine/spotlight/styles.css"

import App from "./App"

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
  fontFamily: "Inter, system-ui, sans-serif",
  headings: {
    fontFamily: "Inter, system-ui, sans-serif",
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
