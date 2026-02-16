import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Button,
  Loader,
  Center,
  Stack,
  Switch,
  Tabs,
  Box,
  Alert,
  Code,
  Divider,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconBell,
  IconMessage,
  IconDeviceMobile,
  IconInfoCircle,
  IconTestPipe,
} from "@tabler/icons-react"

import { notificationsApi, type TestPushResult } from "../api/notifications"
import {
  isPushSupported,
  getNotificationPermission,
  isPushSubscribed,
  isPushConfigured,
  subscribeToPushNotificationsWithReason,
  unsubscribeFromPushNotifications,
} from "../utils/pushNotifications"
import type { NotificationPreference } from "../types"

export default function NotificationPreferencesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [pushSupported] = useState(isPushSupported())
  const [pushPermission, setPushPermission] = useState(
    getNotificationPermission(),
  )
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [testPushLoading, setTestPushLoading] = useState(false)
  const [testPushDelayedLoading, setTestPushDelayedLoading] = useState(false)
  const [testPushResult, setTestPushResult] = useState<TestPushResult | null>(
    null,
  )
  const [testPushError, setTestPushError] = useState<string | null>(null)

  // Check push subscription status and server configuration on mount
  useEffect(() => {
    if (pushSupported) {
      isPushSubscribed().then(setPushSubscribed)
      isPushConfigured().then(setPushConfigured)
      setPushPermission(getNotificationPermission())
    }
  }, [pushSupported])

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: notificationsApi.getPreferences,
  })

  const updateMutation = useMutation({
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere indstillinger. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleToggle = (key: keyof NotificationPreference, value: boolean) => {
    updateMutation.mutate({ [key]: value })
  }

  const handlePushToggle = async () => {
    setPushLoading(true)
    try {
      if (pushSubscribed) {
        const success = await unsubscribeFromPushNotifications()
        if (success) {
          setPushSubscribed(false)
          notifications.show({
            title: "Push-notifikationer deaktiveret",
            message: "Du modtager ikke længere push-notifikationer.",
            color: "blue",
          })
        }
      } else {
        const result = await subscribeToPushNotificationsWithReason()
        if (result.success) {
          setPushSubscribed(true)
          setPushPermission("granted")
          notifications.show({
            title: "Push-notifikationer aktiveret",
            message: "Du modtager nu push-notifikationer på denne enhed.",
            color: "green",
          })
        } else {
          setPushPermission(getNotificationPermission())
          if (result.reason === "permission_denied") {
            notifications.show({
              title: "Tilladelse nægtet",
              message:
                "Du har blokeret notifikationer. Tillad dem i browserindstillinger.",
              color: "red",
            })
          } else if (result.reason === "not_configured") {
            setPushConfigured(false)
            notifications.show({
              title: "Ikke konfigureret",
              message:
                "Push-notifikationer er ikke konfigureret på serveren endnu.",
              color: "yellow",
            })
          } else if (result.reason === "error") {
            notifications.show({
              title: "Fejl",
              message: "Der opstod en fejl. Prøv igen senere.",
              color: "red",
            })
          }
        }
      }
    } finally {
      setPushLoading(false)
    }
  }

  const handleTestPush = async () => {
    setTestPushLoading(true)
    setTestPushResult(null)
    setTestPushError(null)
    try {
      const result = await notificationsApi.testPush()
      setTestPushResult(result)
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } } }
      setTestPushError(
        error.response?.data?.error || "Failed to send test notification",
      )
    } finally {
      setTestPushLoading(false)
    }
  }

  const handleTestPushDelayed = async () => {
    setTestPushDelayedLoading(true)
    setTestPushResult(null)
    setTestPushError(null)
    try {
      const result = await notificationsApi.testPush(10)
      setTestPushResult(result)
      if (result.scheduled) {
        notifications.show({
          title: "Push notification scheduled",
          message: `Test push will be sent in ${result.delay} seconds. You can close the app now.`,
          color: "blue",
        })
      }
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } } }
      setTestPushError(
        error.response?.data?.error || "Failed to schedule test notification",
      )
    } finally {
      setTestPushDelayedLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/notifikationer")}
        mb="md"
      >
        Tilbage til notifikationer
      </Button>

      <Title order={1} mb="xl">
        Notifikationsindstillinger
      </Title>

      {isLoading ? (
        <Center h={200}>
          <Loader />
        </Center>
      ) : preferences ? (
        <Tabs defaultValue={searchParams.get("tab") ?? "in-app"}>
          <Tabs.List mb="md">
            <Tabs.Tab value="in-app" leftSection={<IconBell size={16} />}>
              I appen
            </Tabs.Tab>
            <Tabs.Tab value="email" leftSection={<IconMessage size={16} />}>
              E-mail
            </Tabs.Tab>
            <Tabs.Tab value="push" leftSection={<IconDeviceMobile size={16} />}>
              Push
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="in-app">
            <Stack gap="md">
              <Text size="sm" c="dimmed" mb="xs">
                Vælg hvilke notifikationer du vil modtage i appen.
              </Text>
              <Switch
                label="Vigtig post"
                description="Når ny vigtig post bliver oprettet"
                checked={preferences.notify_announcements}
                onChange={(e) =>
                  handleToggle("notify_announcements", e.currentTarget.checked)
                }
              />
              <Switch
                label="Forum-abonnementer"
                description="Nye tråde i grupper du abonnerer på"
                checked={preferences.notify_forum_subscriptions}
                onChange={(e) =>
                  handleToggle(
                    "notify_forum_subscriptions",
                    e.currentTarget.checked,
                  )
                }
              />
              <Switch
                label="Trådsvar"
                description="Når nogen svarer på din tråd"
                checked={preferences.notify_thread_replies}
                onChange={(e) =>
                  handleToggle("notify_thread_replies", e.currentTarget.checked)
                }
              />
              <Switch
                label="Begivenhedspåmindelser"
                description="Påmindelser om kommende kalenderbegivenheder"
                checked={preferences.notify_event_reminders}
                onChange={(e) =>
                  handleToggle(
                    "notify_event_reminders",
                    e.currentTarget.checked,
                  )
                }
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="email">
            <Stack gap="md">
              <Text size="sm" c="dimmed" mb="xs">
                Få en e-mail når du modtager en notifikation. Aktivér e-mail for
                de notifikationstyper du ønsker.
              </Text>
              <Switch
                label="Nye beskeder"
                description="E-mail når nogen sender dig en direkte besked"
                checked={preferences.email_messages}
                onChange={(e) =>
                  handleToggle("email_messages", e.currentTarget.checked)
                }
              />
              <Switch
                label="Opslag"
                description="E-mail når nye fællesskabsopslag bliver oprettet"
                checked={preferences.email_announcements}
                onChange={(e) =>
                  handleToggle("email_announcements", e.currentTarget.checked)
                }
              />
              <Switch
                label="Forum-abonnementer"
                description="E-mail for nye tråde i grupper du abonnerer på"
                checked={preferences.email_forum_subscriptions}
                onChange={(e) =>
                  handleToggle(
                    "email_forum_subscriptions",
                    e.currentTarget.checked,
                  )
                }
              />
              <Switch
                label="Trådsvar"
                description="E-mail når nogen svarer på din tråd"
                checked={preferences.email_thread_replies}
                onChange={(e) =>
                  handleToggle("email_thread_replies", e.currentTarget.checked)
                }
              />
              <Switch
                label="Begivenhedspåmindelser"
                description="E-mail-påmindelser om kommende kalenderbegivenheder"
                checked={preferences.email_event_reminders}
                onChange={(e) =>
                  handleToggle("email_event_reminders", e.currentTarget.checked)
                }
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="push">
            <Stack gap="md">
              {!pushSupported ? (
                <Alert icon={<IconInfoCircle size={16} />} color="yellow">
                  Push-notifikationer understøttes ikke i denne browser.
                </Alert>
              ) : pushConfigured === false ? (
                <Alert icon={<IconInfoCircle size={16} />} color="yellow">
                  Push-notifikationer er ikke konfigureret på serveren endnu.
                  Kontakt administrator for at aktivere denne funktion.
                </Alert>
              ) : pushPermission === "denied" ? (
                <Alert icon={<IconInfoCircle size={16} />} color="red">
                  Du har blokeret notifikationer. Aktivér dem i
                  browserindstillinger for at modtage push-notifikationer.
                </Alert>
              ) : (
                <>
                  <Text size="sm" c="dimmed" mb="xs">
                    Modtag push-notifikationer direkte på denne enhed, selv når
                    browseren er lukket.
                  </Text>
                  <Button
                    onClick={handlePushToggle}
                    loading={pushLoading}
                    color={pushSubscribed ? "red" : "blue"}
                    variant={pushSubscribed ? "light" : "filled"}
                  >
                    {pushSubscribed
                      ? "Deaktivér push-notifikationer"
                      : "Aktivér push-notifikationer"}
                  </Button>
                  {pushSubscribed && (
                    <>
                      <Text size="sm" c="dimmed" mt="md" mb="xs">
                        Vælg hvilke push-notifikationer du vil modtage.
                      </Text>
                      <Switch
                        label="Nye beskeder"
                        description="Push-notifikation når nogen sender dig en direkte besked"
                        checked={preferences.push_messages}
                        onChange={(e) =>
                          handleToggle("push_messages", e.currentTarget.checked)
                        }
                      />
                      <Switch
                        label="Opslag"
                        description="Push-notifikation når nye fællesskabsopslag bliver oprettet"
                        checked={preferences.push_announcements}
                        onChange={(e) =>
                          handleToggle(
                            "push_announcements",
                            e.currentTarget.checked,
                          )
                        }
                      />
                      <Switch
                        label="Forum-abonnementer"
                        description="Push-notifikation for nye tråde i grupper du abonnerer på"
                        checked={preferences.push_forum_subscriptions}
                        onChange={(e) =>
                          handleToggle(
                            "push_forum_subscriptions",
                            e.currentTarget.checked,
                          )
                        }
                      />
                      <Switch
                        label="Trådsvar"
                        description="Push-notifikation når nogen svarer på din tråd"
                        checked={preferences.push_thread_replies}
                        onChange={(e) =>
                          handleToggle(
                            "push_thread_replies",
                            e.currentTarget.checked,
                          )
                        }
                      />
                      <Switch
                        label="Begivenhedspåmindelser"
                        description="Push-påmindelser om kommende kalenderbegivenheder"
                        checked={preferences.push_event_reminders}
                        onChange={(e) =>
                          handleToggle(
                            "push_event_reminders",
                            e.currentTarget.checked,
                          )
                        }
                      />

                      <Divider my="md" label="Debug" labelPosition="center" />

                      <Button
                        variant="light"
                        leftSection={<IconTestPipe size={16} />}
                        onClick={handleTestPush}
                        loading={testPushLoading}
                      >
                        Send Test Push Notification
                      </Button>

                      <Button
                        variant="light"
                        leftSection={<IconTestPipe size={16} />}
                        onClick={handleTestPushDelayed}
                        loading={testPushDelayedLoading}
                      >
                        Send Test Push (10s delay)
                      </Button>

                      {testPushError && (
                        <Alert color="red" title="Error">
                          {testPushError}
                        </Alert>
                      )}

                      {testPushResult && (
                        <Box>
                          <Text size="sm" fw={500} mb="xs">
                            Web Push API Response:
                          </Text>
                          <Code block style={{ whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(testPushResult, null, 2)}
                          </Code>
                        </Box>
                      )}
                    </>
                  )}
                </>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </>
  )
}
