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

  // Re-read on every navigation.
  useLocation()

  // React Router's own index into this tab's history: 0 on a cold start (a
  // push opened with the app closed, a pasted link), and a redirect with
  // `replace` leaves it there. The location key changes on a replace too, so
  // it offered a "Tilbage" with nothing behind it.
  const canGoBack = (window.history.state?.idx ?? 0) > 0

  const showBoth = canGoBack && getPreviousPathname() !== to

  return (
    <Box
      data-sticky-top
      style={{
        position: "sticky",

        top: "var(--app-shell-header-offset, 60px)",

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
