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
  Box,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
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
  IconHeart,
  IconAt,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { notificationsApi } from "../api/notifications"
import { invalidateCacheForLink } from "../utils/cacheInvalidation"
import type { Notification, NotificationType } from "../types"

dayjs.extend(relativeTime)

const notificationIcons: Record<NotificationType, React.ReactNode> = {
  new_message: <IconMessage size={20} />,
  new_announcement: <IconSpeakerphone size={20} />,
  new_thread: <IconMessageCircle size={20} />,
  thread_reply: <IconMessageCircle size={20} />,
  post_reply: <IconMessageCircle size={20} />,
  post_reaction: <IconHeart size={20} />,
  event_reminder: <IconCalendar size={20} />,
  event_created: <IconCalendar size={20} />,
  event_updated: <IconCalendar size={20} />,
  event_cancelled: <IconCalendar size={20} />,
  food_ticket: <IconToolsKitchen2 size={20} />,
  mention: <IconAt size={20} />,
}

const notificationColors: Record<NotificationType, string> = {
  new_message: "blue",
  new_announcement: "orange",
  new_thread: "green",
  thread_reply: "green",
  post_reply: "green",
  post_reaction: "pink",
  event_reminder: "violet",
  event_created: "violet",
  event_updated: "violet",
  event_cancelled: "red",
  food_ticket: "teal",
  mention: "blue",
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
            onClick={() => navigate("/notifikationer/indstillinger")}
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
