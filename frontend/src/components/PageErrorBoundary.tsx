import type { ReactNode } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { Alert, Button, Stack } from "@mantine/core"
import * as Sentry from "@sentry/react"

function ErrorFallback({
  resetErrorBoundary,
}: {
  resetErrorBoundary: () => void
}) {
  return (
    <Stack align="center" justify="center" p="xl" mt="xl">
      <Alert color="red" title="Noget gik galt" maw={400}>
        Der opstod en uventet fejl. Prøv at genindlæse siden.
      </Alert>
      <Button variant="light" onClick={resetErrorBoundary}>
        Prøv igen
      </Button>
    </Stack>
  )
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        console.error("Page error:", error, info)
        Sentry.captureException(error, {
          extra: { componentStack: info.componentStack },
        })
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
