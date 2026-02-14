import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Stack,
  Avatar,
  ActionIcon,
  Menu,
  Badge,
  Modal,
  Switch,
  Tabs,
  Box,
  Alert,
  Code,
  Divider,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconBell,
  IconCheck,
  IconChecks,
  IconTrash,
  IconSettings,
  IconDotsVertical,
  IconMessage,
  IconSpeakerphone,
  IconMessageCircle,
  IconCalendar,
  IconToolsKitchen2,
  IconBellOff,
  IconDeviceMobile,
  IconInfoCircle,
  IconHeart,
  IconTestPipe,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { notificationsApi, type TestPushResult } from "../api/notifications"
import {
  isPushSupported,
  getNotificationPermission,
  isPushSubscribed,
  isPushConfigured,
  subscribeToPushNotificationsWithReason,
  unsubscribeFromPushNotifications,
} from "../utils/pushNotifications"
import { invalidateCacheForLink } from "../utils/cacheInvalidation"
import type {
  Notification,
  NotificationPreference,
  NotificationType,
} from "../types"

dayjs.extend(relativeTime)

const notificationIcons: Record<NotificationType, React.ReactNode> = {
  new_message: <IconMessage size={20} />,
  new_announcement: <IconSpeakerphone size={20} />,
  new_thread: <IconMessageCircle size={20} />,
  thread_reply: <IconMessageCircle size={20} />,
  post_reply: <IconMessageCircle size={20} />,
  post_reaction: <IconHeart size={20} />,
  event_reminder: <IconCalendar size={20} />,
  food_ticket: <IconToolsKitchen2 size={20} />,
}

const notificationColors: Record<NotificationType, string> = {
  new_message: "blue",
  new_announcement: "orange",
  new_thread: "green",
  thread_reply: "green",
  post_reply: "green",
  post_reaction: "pink",
  event_reminder: "violet",
  food_ticket: "teal",
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [
    preferencesOpened,
    { open: openPreferences, close: closePreferences },
  ] = useDisclosure(false)
  const [clearAllOpened, { open: openClearAll, close: closeClearAll }] =
    useDisclosure(false)

  const {
    data: notificationsList,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationsApi.getNotifications,
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
      notifications.show({
        title: "Alle markeret som læst",
        message: "Alle notifikationer er nu markeret som læst.",
        color: "blue",
      })
    },
  })

  const markOneReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markAsRead([id]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
    },
  })

  const deleteOneMutation = useMutation({
    mutationFn: notificationsApi.deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
      notifications.show({
        title: "Notifikation slettet",
        message: "Notifikationen er blevet slettet.",
        color: "blue",
      })
    },
  })

  const clearAllMutation = useMutation({
    mutationFn: notificationsApi.clearAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
      closeClearAll()
      notifications.show({
        title: "Alle notifikationer ryddet",
        message: "Alle notifikationer er blevet slettet.",
        color: "blue",
      })
    },
  })

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markOneReadMutation.mutate(notification.id)
    }
    if (notification.link) {
      invalidateCacheForLink(queryClient, notification.link)
      navigate(notification.link)
    }
  }

  const unreadCount = notificationsList?.filter((n) => !n.is_read).length ?? 0

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse notifikationer. Prøv igen.</Text>
      </Center>
    )
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Notifikationer</Title>
          <Text c="dimmed">
            {unreadCount > 0
              ? `${unreadCount} ulæste notifikationer`
              : "Ingen ulæste notifikationer"}
          </Text>
        </div>
        <Group>
          <Button
            variant="light"
            leftSection={<IconSettings size={16} />}
            onClick={openPreferences}
          >
            Indstillinger
          </Button>
          {notificationsList && notificationsList.length > 0 && (
            <>
              <Button
                variant="light"
                leftSection={<IconChecks size={16} />}
                onClick={() => markAllReadMutation.mutate()}
                loading={markAllReadMutation.isPending}
                disabled={unreadCount === 0}
              >
                Markér alle som læst
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={openClearAll}
              >
                Ryd alle
              </Button>
            </>
          )}
        </Group>
      </Group>

      <Stack gap="sm">
        {notificationsList?.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Center>
              <Stack align="center" gap="xs">
                <IconBellOff size={48} color="gray" />
                <Text c="dimmed">Ingen notifikationer endnu.</Text>
                <Text size="sm" c="dimmed">
                  Du bliver notificeret om nye beskeder, opslag og mere.
                </Text>
              </Stack>
            </Center>
          </Paper>
        ) : (
          notificationsList?.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onClick={() => handleNotificationClick(notification)}
              onMarkRead={() => markOneReadMutation.mutate(notification.id)}
              onDelete={() => deleteOneMutation.mutate(notification.id)}
            />
          ))
        )}
      </Stack>

      <NotificationPreferencesModal
        opened={preferencesOpened}
        onClose={closePreferences}
      />

      <Modal
        opened={clearAllOpened}
        onClose={closeClearAll}
        title="Ryd alle notifikationer"
        centered
      >
        <Text mb="lg">
          Er du sikker på, at du vil slette alle notifikationer? Denne handling
          kan ikke fortrydes.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeClearAll}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={() => clearAllMutation.mutate()}
            loading={clearAllMutation.isPending}
          >
            Ryd alle
          </Button>
        </Group>
      </Modal>
    </>
  )
}

interface NotificationCardProps {
  notification: Notification
  onClick: () => void
  onMarkRead: () => void
  onDelete: () => void
}

function NotificationCard({
  notification,
  onClick,
  onMarkRead,
  onDelete,
}: NotificationCardProps) {
  const icon = notificationIcons[notification.notification_type]
  const color = notificationColors[notification.notification_type]

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{
        cursor: notification.link ? "pointer" : "default",
        opacity: notification.is_read ? 0.7 : 1,
        backgroundColor: notification.is_read
          ? undefined
          : "var(--mantine-color-blue-light)",
      }}
      onClick={(e) => {
        // Don't trigger click if menu is clicked
        if ((e.target as HTMLElement).closest("[data-menu-trigger]")) return
        onClick()
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {notification.related_user ? (
            <Avatar
              src={notification.related_user.profile_picture}
              radius="xl"
              size="md"
              color={color}
            >
              {notification.related_user.first_name?.[0]}
              {notification.related_user.last_name?.[0]}
            </Avatar>
          ) : (
            <Avatar radius="xl" size="md" color={color}>
              {icon}
            </Avatar>
          )}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Text fw={notification.is_read ? 400 : 600} truncate>
                {notification.title}
              </Text>
              {!notification.is_read && (
                <Badge size="xs" color="blue" variant="filled">
                  Ny
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed" lineClamp={2}>
              {notification.message}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {dayjs(notification.created_at).fromNow()}
            </Text>
          </Box>
        </Group>

        <Menu shadow="md" width={200}>
          <Menu.Target>
            <ActionIcon variant="subtle" data-menu-trigger>
              <IconDotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {!notification.is_read && (
              <Menu.Item
                leftSection={<IconCheck size={14} />}
                onClick={(e) => {
                  e.stopPropagation()
                  onMarkRead()
                }}
              >
                Markér som læst
              </Menu.Item>
            )}
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              Slet
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  )
}

interface NotificationPreferencesModalProps {
  opened: boolean
  onClose: () => void
}

function NotificationPreferencesModal({
  opened,
  onClose,
}: NotificationPreferencesModalProps) {
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

  // Check push subscription status and server configuration when modal opens
  useEffect(() => {
    if (opened && pushSupported) {
      isPushSubscribed().then(setPushSubscribed)
      isPushConfigured().then(setPushConfigured)
      setPushPermission(getNotificationPermission())
    }
  }, [opened, pushSupported])

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: notificationsApi.getPreferences,
    enabled: opened,
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
    <Modal
      opened={opened}
      onClose={onClose}
      title="Notifikationsindstillinger"
      size="lg"
    >
      {isLoading ? (
        <Center h={200}>
          <Loader />
        </Center>
      ) : preferences ? (
        <Tabs defaultValue="in-app">
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
                label="Opslag"
                description="Når nye fællesskabsopslag bliver oprettet"
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
              <Switch
                label="Madbilletter"
                description="Når nye madbilletter bliver tilgængelige"
                checked={preferences.notify_food_tickets}
                onChange={(e) =>
                  handleToggle("notify_food_tickets", e.currentTarget.checked)
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
              <Switch
                label="Madbilletter"
                description="E-mail når nye madbilletter bliver tilgængelige"
                checked={preferences.email_food_tickets}
                onChange={(e) =>
                  handleToggle("email_food_tickets", e.currentTarget.checked)
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
                      <Switch
                        label="Madbilletter"
                        description="Push-notifikation når nye madbilletter bliver tilgængelige"
                        checked={preferences.push_food_tickets}
                        onChange={(e) =>
                          handleToggle(
                            "push_food_tickets",
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
    </Modal>
  )
}
