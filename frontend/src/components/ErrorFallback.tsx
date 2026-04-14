import { useState } from "react"
import {
  Alert,
  Button,
  Code,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core"
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react"

interface ErrorFallbackProps {
  error: Error | null
  componentStack?: string | null
  resetErrorBoundary?: () => void
  /** Render as a compact in-page alert instead of a full-page paper. */
  compact?: boolean
  title?: string
  description?: string
}

const DEFAULT_TITLE = "Noget gik galt"
const DEFAULT_DESCRIPTION =
  "Der opstod en uventet fejl. Prøv at genindlæse siden eller gå til forsiden."

function formatErrorDetails(
  error: Error | null,
  componentStack?: string | null,
): string {
  const parts: string[] = []
  if (error) {
    parts.push(`${error.name || "Error"}: ${error.message}`)
    if (error.stack) {
      parts.push("", error.stack)
    }
  }
  if (componentStack) {
    parts.push("", "Component stack:", componentStack.trim())
  }
  return parts.join("\n")
}

export function ErrorFallback({
  error,
  componentStack,
  resetErrorBoundary,
  compact = false,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: ErrorFallbackProps) {
  const isDev = import.meta.env.DEV
  const canSeeDetails = true
  const [showDetails, setShowDetails] = useState(isDev)

  const handleReload = () => {
    window.location.reload()
  }

  const handleGoHome = () => {
    window.location.href = "/"
  }

  const detailsBlock =
    canSeeDetails && error ? (
      <Stack gap="xs" w="100%">
        <Group justify="space-between" wrap="nowrap">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => setShowDetails((s) => !s)}
            leftSection={
              showDetails ? (
                <IconChevronUp size={14} />
              ) : (
                <IconChevronDown size={14} />
              )
            }
          >
            {showDetails ? "Skjul" : "Vis"}
          </Button>
        </Group>
        {showDetails && (
          <Code
            block
            w="100%"
            style={{
              maxHeight: 300,
              overflow: "auto",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {formatErrorDetails(error, componentStack)}
          </Code>
        )}
      </Stack>
    ) : null

  if (compact) {
    return (
      <Alert
        color="red"
        title={title}
        icon={<IconAlertTriangle size={18} />}
        my="md"
      >
        <Stack gap="sm">
          <Text size="sm">{description}</Text>
          {detailsBlock}
          {resetErrorBoundary && (
            <Group>
              <Button size="xs" variant="light" onClick={resetErrorBoundary}>
                Prøv igen
              </Button>
            </Group>
          )}
        </Stack>
      </Alert>
    )
  }

  return (
    <Container size="sm" py="xl">
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={64} color="var(--mantine-color-red-6)" />
          <Title order={2} ta="center">
            {title}
          </Title>
          <Text c="dimmed" ta="center">
            {description}
          </Text>
          {detailsBlock}
          <Button.Group>
            {resetErrorBoundary ? (
              <Button onClick={resetErrorBoundary} variant="filled">
                Prøv igen
              </Button>
            ) : (
              <Button onClick={handleReload} variant="filled">
                Genindlæs side
              </Button>
            )}
            <Button onClick={handleGoHome} variant="light">
              Gå til forsiden
            </Button>
          </Button.Group>
        </Stack>
      </Paper>
    </Container>
  )
}

export default ErrorFallback
