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
    onMutate: async (newData) => {
      await queryClient.cancelQueries({
        queryKey: ["notification-preferences"],
      })
      const previous = queryClient.getQueryData<NotificationPreference>([
        "notification-preferences",
      ])
      queryClient.setQueryData<NotificationPreference>(
        ["notification-preferences"],
        (old) => (old ? { ...old, ...newData } : old),
      )
      return { previous }
    },
    onError: (_err, _newData, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["notification-preferences"], context.previous)
      }
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere indstillinger. Prøv igen.",
        color: "red",
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] })
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
          title: "Push-notifikation planlagt",
          message: `Test push sendes om ${result.delay} sekunder. Du kan lukke appen nu.`,
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
                label="Vigtig post redigeret"
                description="Når en vigtig post bliver redigeret"
                checked={preferences.notify_announcement_updates}
                onChange={(e) =>
                  handleToggle(
                    "notify_announcement_updates",
                    e.currentTarget.checked,
                  )
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
                label="Al aktivitet i grupper"
                description="Nye svar i alle tråde i grupper du abonnerer på (ikke kun tråde du deltager i)"
                checked={preferences.notify_subgroup_activity}
                onChange={(e) =>
                  handleToggle(
                    "notify_subgroup_activity",
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
                label="Reaktioner"
                description="Når nogen reagerer på dit indlæg"
                checked={preferences.notify_post_reactions}
                onChange={(e) =>
                  handleToggle("notify_post_reactions", e.currentTarget.checked)
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
              <Switch
                label="Arrangementer"
                description="Når nye arrangementer oprettes eller opdateres"
                checked={preferences.notify_events}
                onChange={(e) =>
                  handleToggle("notify_events", e.currentTarget.checked)
                }
              />
              <Switch
                label="Omtaler"
                description="Når nogen nævner dig med @"
                checked={preferences.notify_mentions}
                onChange={(e) =>
                  handleToggle("notify_mentions", e.currentTarget.checked)
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
                label="Vigtig post redigeret"
                description="E-mail når en vigtig post bliver redigeret"
                checked={preferences.email_announcement_updates}
                onChange={(e) =>
                  handleToggle(
                    "email_announcement_updates",
                    e.currentTarget.checked,
                  )
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
                label="Al aktivitet i grupper"
                description="E-mail for nye svar i alle tråde i grupper du abonnerer på"
                checked={preferences.email_subgroup_activity}
                onChange={(e) =>
                  handleToggle(
                    "email_subgroup_activity",
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
                label="Reaktioner"
                description="E-mail når nogen reagerer på dit indlæg"
                checked={preferences.email_post_reactions}
                onChange={(e) =>
                  handleToggle("email_post_reactions", e.currentTarget.checked)
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
              <Switch
                label="Arrangementer"
                description="E-mail når nye arrangementer oprettes eller opdateres"
                checked={preferences.email_events}
                onChange={(e) =>
                  handleToggle("email_events", e.currentTarget.checked)
                }
              />
              <Switch
                label="Omtaler"
                description="E-mail når nogen nævner dig med @"
                checked={preferences.email_mentions}
                onChange={(e) =>
                  handleToggle("email_mentions", e.currentTarget.checked)
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
                        label="Vigtig post redigeret"
                        description="Push-notifikation når en vigtig post bliver redigeret"
                        checked={preferences.push_announcement_updates}
                        onChange={(e) =>
                          handleToggle(
                            "push_announcement_updates",
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
                        label="Al aktivitet i grupper"
                        description="Push-notifikation for nye svar i alle tråde i grupper du abonnerer på"
                        checked={preferences.push_subgroup_activity}
                        onChange={(e) =>
                          handleToggle(
                            "push_subgroup_activity",
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
                        label="Reaktioner"
                        description="Push-notifikation når nogen reagerer på dit indlæg"
                        checked={preferences.push_post_reactions}
                        onChange={(e) =>
                          handleToggle(
                            "push_post_reactions",
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
                      <Switch
                        label="Arrangementer"
                        description="Push-notifikation når nye arrangementer oprettes eller opdateres"
                        checked={preferences.push_events}
                        onChange={(e) =>
                          handleToggle("push_events", e.currentTarget.checked)
                        }
                      />
                      <Switch
                        label="Omtaler"
                        description="Push-notifikation når nogen nævner dig med @"
                        checked={preferences.push_mentions}
                        onChange={(e) =>
                          handleToggle("push_mentions", e.currentTarget.checked)
                        }
                      />

                      <Divider my="md" label="Debug" labelPosition="center" />

                      <Button
                        variant="light"
                        leftSection={<IconTestPipe size={16} />}
                        onClick={handleTestPush}
                        loading={testPushLoading}
                      >
                        Send test push-notifikation
                      </Button>

                      <Button
                        variant="light"
                        leftSection={<IconTestPipe size={16} />}
                        onClick={handleTestPushDelayed}
                        loading={testPushDelayedLoading}
                      >
                        Send test push (10s forsinkelse)
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
