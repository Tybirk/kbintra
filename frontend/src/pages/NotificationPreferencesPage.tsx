import { useState, useEffect } from "react"

import { useSearchParams } from "react-router-dom"

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

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconBell,
  IconMessage,
  IconDeviceMobile,
  IconInfoCircle,
  IconTestPipe,
} from "@tabler/icons-react"

import { notificationsApi, type TestPushResult } from "../api/notifications"

import { BackButton } from "../components/BackButton"

import {
  isPushSupported,
  getNotificationPermission,
  isPushSubscribed,
  isPushConfigured,
  subscribeToPushNotificationsWithReason,
  unsubscribeFromPushNotifications,
} from "../utils/pushNotifications"

import type { NotificationPreference, NotificationGroup } from "../types"

type ChannelPrefix = "notify" | "email" | "push"

const prefBool = (p: NotificationPreference, k: string): boolean =>
  Boolean((p as unknown as Record<string, unknown>)[k])

export default function NotificationPreferencesPage() {
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

  const {
    data: schema,
    isLoading: isSchemaLoading,
    isError: isSchemaError,
  } = useQuery({
    queryKey: ["notification-preference-schema"],

    queryFn: notificationsApi.getPreferenceSchema,
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

    onError: (error: unknown, _newData, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["notification-preferences"], context.previous)
      }

      showErrorNotification(
        error,

        "Kunne ikke opdatere indstillinger. Prøv igen.",
      )
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] })
    },
  })

  const handleSchemaToggle = (
    channel: ChannelPrefix,
    fieldKey: string,
    value: boolean,
  ) => {
    updateMutation.mutate({ [`${channel}_${fieldKey}`]: value })
  }

  const handlePushToggle = async () => {
    setPushLoading(true)

    try {
      if (pushSubscribed) {
        const success = await unsubscribeFromPushNotifications()

        if (success) {
          setPushSubscribed(false)

          // Also disable all server-side push preferences so that even if

          // the browser re-subscribes (e.g. after localStorage is cleared),

          // no push notifications will be sent.

          updateMutation.mutate({
            push_messages: false,

            push_announcements: false,

            push_announcement_updates: false,

            push_forum_subscriptions: false,

            push_thread_replies: false,

            push_subgroup_activity: false,

            push_post_reactions: false,

            push_events: false,

            push_event_reminders: false,

            push_food_tickets: false,

            push_food_team_reminder: false,

            push_food_takeaway_ready: false,

            push_food_leftovers_ready: false,

            push_food_swap_request: false,

            push_mentions: false,
          })

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

          // Re-enable default push preferences on the server so the user

          // actually receives push notifications after activating.

          updateMutation.mutate({
            push_messages: true,

            push_announcements: true,

            push_announcement_updates: false,

            push_forum_subscriptions: true,

            push_thread_replies: true,

            push_subgroup_activity: false,

            push_post_reactions: true,

            push_events: true,

            push_event_reminders: true,

            push_food_tickets: true,

            push_food_team_reminder: true,

            push_food_takeaway_ready: true,

            push_food_leftovers_ready: true,

            push_food_swap_request: true,

            push_mentions: true,
          })

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

  const renderGroups = (
    prefs: NotificationPreference,
    groups: NotificationGroup[],
    channel: ChannelPrefix,
  ) =>
    groups.map((group) => (
      <Box key={group.key}>
        <Divider my="sm" label={group.label} labelPosition="left" />
        <Stack gap="md">
          {group.fields.map((field) => {
            const backendKey = field.channel_keys?.[channel] ?? field.key
            return (
              <Switch
                key={field.key}
                label={field.label}
                description={field.description}
                checked={prefBool(prefs, `${channel}_${backendKey}`)}
                onChange={(e) =>
                  handleSchemaToggle(
                    channel,
                    backendKey,
                    e.currentTarget.checked,
                  )
                }
              />
            )
          })}
        </Stack>
      </Box>
    ))

  return (
    <>
      <BackButton to="/notifikationer" label="Tilbage til notifikationer" />

      <Title order={1} mb="xl">
        Notifikationsindstillinger
      </Title>

      {isLoading || isSchemaLoading ? (
        <Center h={200}>
          <Loader />
        </Center>
      ) : preferences && schema && !isSchemaError ? (
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
              {renderGroups(preferences, schema.groups, "notify")}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="email">
            <Stack gap="md">
              <Text size="sm" c="dimmed" mb="xs">
                Få en e-mail når du modtager en notifikation. Aktivér e-mail for
                de notifikationstyper du ønsker.
              </Text>
              {renderGroups(preferences, schema.groups, "email")}
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
                      {renderGroups(preferences, schema.groups, "push")}

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
                        <Alert color="red" title="Fejl">
                          {testPushError}
                        </Alert>
                      )}

                      {testPushResult && (
                        <Box>
                          <Text size="sm" fw={500} mb="xs">
                            Web Push API-svar:
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
      ) : (
        <Alert icon={<IconInfoCircle size={16} />} color="red">
          Kunne ikke indlæse notifikationsindstillinger. Prøv at genindlæse
          siden.
        </Alert>
      )}
    </>
  )
}
