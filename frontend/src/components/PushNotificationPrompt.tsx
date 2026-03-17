import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Modal, Button, Group, Stack, Text, ThemeIcon } from "@mantine/core"
import { IconBell } from "@tabler/icons-react"

import {
  isPushSupported,
  isPushConfigured,
  isPushSubscribed,
  getPushOptedOut,
  subscribeToPushNotificationsWithReason,
  getNotificationPermission,
} from "../utils/pushNotifications"

export function PushNotificationPrompt() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    const checkShouldShow = async () => {
      // Check all conditions
      if (!isPushSupported()) return
      if (localStorage.getItem("push-prompt-status") === "declined") return
      if (getPushOptedOut()) return
      if (getNotificationPermission() === "denied") return

      const [configured, subscribed] = await Promise.all([
        isPushConfigured(),
        isPushSubscribed(),
      ])

      if (!configured) return
      if (subscribed) return

      // All conditions met — show after 2 second delay
      timeout = setTimeout(() => setVisible(true), 2000)
    }

    checkShouldShow()

    return () => clearTimeout(timeout)
  }, [])

  const handleAccept = async () => {
    setLoading(true)
    try {
      const result = await subscribeToPushNotificationsWithReason()
      if (result.success) {
        localStorage.setItem("push-prompt-status", "accepted")
        setVisible(false)
        navigate("/notifikationer/indstillinger?tab=push")
      } else if (result.reason === "permission_denied") {
        localStorage.setItem("push-prompt-status", "declined")
        setVisible(false)
      }
      // On other errors (e.g. "error", "not_configured"), don't persist — prompt reappears next time
    } finally {
      setLoading(false)
    }
  }

  const handleDecline = () => {
    localStorage.setItem("push-prompt-status", "declined")
    setVisible(false)
  }

  return (
    <Modal
      opened={visible}
      onClose={handleDecline}
      withCloseButton={false}
      closeOnEscape={false}
      closeOnClickOutside={false}
      centered
      overlayProps={{ blur: 3 }}
    >
      <Stack align="center" gap="md" py="md">
        <ThemeIcon size={64} radius="xl" variant="light" color="blue">
          <IconBell size={32} />
        </ThemeIcon>

        <Text fw={600} size="lg" ta="center">
          Vil du modtage push-notifikationer?
        </Text>

        <Text size="sm" c="dimmed" ta="center">
          Få besked direkte på din enhed når der er nye beskeder, opslag eller
          begivenheder i fællesskabet — også når du ikke har appen åben.
        </Text>

        <Group justify="center" mt="md">
          <Button variant="light" color="gray" onClick={handleDecline}>
            Nej tak
          </Button>
          <Button onClick={handleAccept} loading={loading}>
            Ja, aktivér
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
