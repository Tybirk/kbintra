import { useState, useEffect } from "react"

import { useNavigate } from "react-router-dom"

import { Modal, Button, Group, Stack, Text, ThemeIcon } from "@mantine/core"

import { IconBell } from "@tabler/icons-react"

import { notificationsApi } from "../api/notifications"

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

      // Don't prompt if the user disabled all push categories on the server

      // (e.g. via the "Deaktiver" button). This survives localStorage clearing.

      try {
        const prefs = await notificationsApi.getPreferences()

        const anyPushEnabled =
          prefs.push_messages ||
          prefs.push_announcements ||
          prefs.push_announcement_updates ||
          prefs.push_forum_subscriptions ||
          prefs.push_thread_replies ||
          prefs.push_subgroup_activity ||
          prefs.push_post_reactions ||
          prefs.push_events ||
          prefs.push_event_reminders ||
          prefs.push_food_tickets ||
          prefs.push_mentions ||
          // Must stay in step with get_user_push_preference in the backend —
          // this list once omitted car sharing, so a resident who muted
          // everything else was never asked to subscribe while the server was
          // still willing to push bildeling events at them.
          prefs.push_car_sharing

        if (!anyPushEnabled) return
      } catch {
        // If we can't fetch preferences, don't block the prompt
      }

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
