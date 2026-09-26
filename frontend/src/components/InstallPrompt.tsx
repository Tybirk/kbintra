import { useState, useEffect, useLayoutEffect, useRef } from "react"

import {
  Button,
  Paper,
  Group,
  Text,
  Stack,
  CloseButton,
  getDefaultZIndex,
} from "@mantine/core"

import { IconDownload, IconShare } from "@tabler/icons-react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>

  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent

  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

  // Exclude Chrome/Firefox/Edge on iOS — they can't add to home screen either,

  // but the share sheet instructions only apply to Safari

  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)

  return isIos && isSafari
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as { standalone?: boolean }).standalone === true)
  )
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  const [showPrompt, setShowPrompt] = useState(false)

  const [isIos, setIsIos] = useState(false)

  const [dismissed, setDismissed] = useState(false)

  const ref = useRef<HTMLDivElement>(null)

  const visible = showPrompt && !dismissed

  // While shown, the banner claims its space at the bottom of the page (see
  // AppShell.Main in App.tsx), as TestDomainBanner does at the top: otherwise
  // the last button on a page — Gem, a toggle — sits under it for good.
  useLayoutEffect(() => {
    if (!visible) return

    const el = ref.current

    if (!el) return

    const root = document.documentElement

    const apply = () =>
      root.style.setProperty(
        "--install-prompt-height",
        `${el.offsetHeight + 24}px`,
      )

    apply()

    const observer = new ResizeObserver(apply)

    observer.observe(el)

    return () => {
      observer.disconnect()

      root.style.removeProperty("--install-prompt-height")
    }
  }, [visible])

  useEffect(() => {
    const wasDismissed = sessionStorage.getItem("pwa-install-dismissed")

    if (wasDismissed) {
      setDismissed(true)

      return
    }

    // Already running as installed PWA — don't show

    if (isStandalone()) return

    // iOS Safari: show instructions banner

    if (isIosSafari()) {
      setIsIos(true)

      setShowPrompt(true)

      return
    }

    // Android/Chrome: use beforeinstallprompt

    // Check if the event was already captured globally (it fires before React mounts)

    const captured = (window as { __pwaInstallPrompt?: Event })
      .__pwaInstallPrompt

    if (captured) {
      setDeferredPrompt(captured as BeforeInstallPromptEvent)

      setShowPrompt(true)
      ;(window as { __pwaInstallPrompt?: Event | null }).__pwaInstallPrompt =
        null

      return
    }

    // Otherwise listen for it (e.g. if the component mounts before the event fires)

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()

      setDeferredPrompt(e as BeforeInstallPromptEvent)

      setShowPrompt(true)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",

        handleBeforeInstallPrompt,
      )
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return

    await deferredPrompt.prompt()

    const { outcome } = await deferredPrompt.userChoice

    if (outcome === "accepted") {
      setShowPrompt(false)
    }

    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowPrompt(false)

    setDismissed(true)

    sessionStorage.setItem("pwa-install-dismissed", "true")
  }

  if (!visible) {
    return null
  }

  return (
    <Paper
      ref={ref}
      shadow="md"
      p="sm"
      style={{
        position: "fixed",

        bottom: 16,

        left: 16,

        right: 16,

        // Above the page, below modals: an open carousel or zoom covers it.
        zIndex: getDefaultZIndex("app") + 1,

        maxWidth: 400,

        margin: "0 auto",
      }}
    >
      {isIos ? (
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4}>
            <Group gap="sm" wrap="nowrap">
              <IconDownload size={20} />
              <Text size="sm" fw={500}>
                Installér KB Intra som app
              </Text>
            </Group>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Tryk på del-knappen
              </Text>
              <IconShare size={14} color="var(--mantine-color-blue-6)" />
              <Text size="xs" c="dimmed">
                og vælg &quot;Føj til hjemmeskærm&quot;
              </Text>
            </Group>
          </Stack>
          <CloseButton size="sm" onClick={handleDismiss} />
        </Group>
      ) : (
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <IconDownload size={20} />
            <Text size="sm">Installér KB Intra som app</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" onClick={handleInstall}>
              Installér
            </Button>
            <CloseButton size="sm" onClick={handleDismiss} />
          </Group>
        </Group>
      )}
    </Paper>
  )
}
