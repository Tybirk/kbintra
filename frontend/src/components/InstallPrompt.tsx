import { useState, useEffect } from "react"
import { Button, Paper, Group, Text, CloseButton } from "@mantine/core"
import { IconDownload } from "@tabler/icons-react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if already dismissed this session
    const wasDismissed = sessionStorage.getItem("pwa-install-dismissed")
    if (wasDismissed) {
      setDismissed(true)
      return
    }

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

  if (!showPrompt || dismissed) {
    return null
  }

  return (
    <Paper
      shadow="md"
      p="sm"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 1000,
        maxWidth: 400,
        margin: "0 auto",
      }}
    >
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
    </Paper>
  )
}
