import { Component } from "react"
import type { ReactNode } from "react"
import {
  Container,
  Title,
  Text,
  Button,
  Stack,
  Paper,
  Code,
} from "@mantine/core"
import { IconAlertTriangle } from "@tabler/icons-react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    console.error("ErrorBoundary caught an error:", error, errorInfo)

    // In production, you could send this to an error tracking service
    // e.g., Sentry.captureException(error, { extra: errorInfo });
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = "/"
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <Container size="sm" py="xl">
          <Paper withBorder p="xl" radius="md">
            <Stack align="center" gap="md">
              <IconAlertTriangle size={64} color="var(--mantine-color-red-6)" />
              <Title order={2} ta="center">
                Noget gik galt
              </Title>
              <Text c="dimmed" ta="center">
                Der opstod en uventet fejl. Prøv at genindlæse siden eller gå
                til forsiden.
              </Text>
              {import.meta.env.DEV && this.state.error && (
                <Code
                  block
                  w="100%"
                  style={{ maxHeight: 200, overflow: "auto" }}
                >
                  {this.state.error.message}
                  {"\n\n"}
                  {this.state.error.stack}
                </Code>
              )}
              <Button.Group>
                <Button onClick={this.handleReload} variant="filled">
                  Genindlæs side
                </Button>
                <Button onClick={this.handleGoHome} variant="light">
                  Gå til forsiden
                </Button>
              </Button.Group>
            </Stack>
          </Paper>
        </Container>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
