import { Button, Box, Group } from "@mantine/core"
import { IconArrowLeft } from "@tabler/icons-react"
import { useNavigate, useLocation } from "react-router-dom"
import { getPreviousPathname } from "../utils/navigationHistory"

interface BackButtonProps {
  to: string
  label: string
}

export function BackButton({ to, label }: BackButtonProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const canGoBack = location.key !== "default"
  const showBoth = canGoBack && getPreviousPathname() !== to

  return (
    <Box
      style={{
        position: "sticky",
        top: "var(--app-shell-header-height, 60px)",
        zIndex: 100,
        backgroundColor: "var(--mantine-color-body)",
        paddingTop: "var(--mantine-spacing-xs)",
        paddingBottom: "var(--mantine-spacing-xs)",
        marginBottom: "var(--mantine-spacing-md)",
      }}
    >
      <Group gap="xs">
        {showBoth ? (
          <>
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate(-1)}
              px={0}
            >
              Tilbage
            </Button>
            <Button
              variant="subtle"
              onClick={() => navigate(to)}
              px={0}
              c="dimmed"
              size="sm"
            >
              {label}
            </Button>
          </>
        ) : (
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => (canGoBack ? navigate(-1) : navigate(to))}
            px={0}
          >
            {label}
          </Button>
        )}
      </Group>
    </Box>
  )
}
