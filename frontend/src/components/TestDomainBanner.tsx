import { useLayoutEffect, useRef } from "react"

import { Box, Stack, Text } from "@mantine/core"

import { IconAlertTriangle } from "@tabler/icons-react"

// Hostnames that are NOT the real production site. Users sometimes land on the
// dev server by mistake (e.g. an old installed "app" pointing at the test
// domain), so we warn them loudly and tell them to use kb-intra.dk instead.
const TEST_HOSTNAMES = ["kbintra.top"]

function isTestDomain(): boolean {
  return TEST_HOSTNAMES.includes(window.location.hostname)
}

// Shows a fixed red warning banner at the very top of the page when the app is
// served from a test domain. It also publishes its height as the
// `--test-banner-height` CSS variable so the layout can offset itself (see the
// usages in App.tsx). On the real domain it renders nothing and never sets the
// variable, so the offsets fall back to 0.
export function TestDomainBanner() {
  const ref = useRef<HTMLDivElement>(null)

  const show = isTestDomain()

  useLayoutEffect(() => {
    if (!show) return

    const el = ref.current
    if (!el) return

    const root = document.documentElement

    const apply = () => {
      root.style.setProperty("--test-banner-height", `${el.offsetHeight}px`)
    }

    apply()

    const observer = new ResizeObserver(apply)
    observer.observe(el)

    return () => {
      observer.disconnect()
      root.style.removeProperty("--test-banner-height")
    }
  }, [show])

  if (!show) return null

  return (
    <Box
      ref={ref}
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        insetInline: 0,
        zIndex: 300,
        backgroundColor: "var(--mantine-color-red-7)",
        color: "var(--mantine-color-white)",
        padding: "12px 16px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
      }}
    >
      <Stack gap={4} align="center" ta="center">
        <Text
          fw={700}
          size="md"
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <IconAlertTriangle size={20} />
          Dette er en testside
        </Text>
        <Text size="sm">
          Gå til{" "}
          <Text
            component="a"
            href="https://kb-intra.dk"
            fw={700}
            inherit
            style={{
              color: "var(--mantine-color-white)",
              textDecoration: "underline",
            }}
          >
            kb-intra.dk
          </Text>{" "}
          for at bruge den rigtige side. Hvis du har installeret denne som en
          "app", skal du afinstallere den, gå til kb-intra.dk og installere
          igen.
        </Text>
      </Stack>
    </Box>
  )
}
