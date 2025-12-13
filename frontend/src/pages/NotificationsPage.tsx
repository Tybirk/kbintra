import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
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
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { notificationsApi } from '../api/notifications';
import type { Notification, NotificationPreference, NotificationType } from '../types';

dayjs.extend(relativeTime);

const notificationIcons: Record<NotificationType, React.ReactNode> = {
  new_message: <IconMessage size={20} />,
  new_announcement: <IconSpeakerphone size={20} />,
  new_thread: <IconMessageCircle size={20} />,
  thread_reply: <IconMessageCircle size={20} />,
  post_reply: <IconMessageCircle size={20} />,
  event_reminder: <IconCalendar size={20} />,
  food_ticket: <IconToolsKitchen2 size={20} />,
};

const notificationColors: Record<NotificationType, string> = {
  new_message: 'blue',
  new_announcement: 'orange',
  new_thread: 'green',
  thread_reply: 'green',
  post_reply: 'green',
  event_reminder: 'violet',
  food_ticket: 'teal',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [preferencesOpened, { open: openPreferences, close: closePreferences }] =
    useDisclosure(false);
  const [clearAllOpened, { open: openClearAll, close: closeClearAll }] =
    useDisclosure(false);

  const { data: notificationsList, isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.getNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      notifications.show({
        title: 'All marked as read',
        message: 'All notifications have been marked as read.',
        color: 'blue',
      });
    },
  });

  const markOneReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markAsRead([id]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    },
  });

  const deleteOneMutation = useMutation({
    mutationFn: notificationsApi.deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      notifications.show({
        title: 'Notification deleted',
        message: 'The notification has been deleted.',
        color: 'blue',
      });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: notificationsApi.clearAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      closeClearAll();
      notifications.show({
        title: 'All notifications cleared',
        message: 'All notifications have been deleted.',
        color: 'blue',
      });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markOneReadMutation.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const unreadCount = notificationsList?.filter((n) => !n.is_read).length ?? 0;

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Failed to load notifications. Please try again.</Text>
      </Center>
    );
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Notifications</Title>
          <Text c="dimmed">
            {unreadCount > 0 ? `${unreadCount} unread notifications` : 'No unread notifications'}
          </Text>
        </div>
        <Group>
          <Button
            variant="light"
            leftSection={<IconSettings size={16} />}
            onClick={openPreferences}
          >
            Preferences
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
                Mark All Read
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={openClearAll}
              >
                Clear All
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
                <Text c="dimmed">No notifications yet.</Text>
                <Text size="sm" c="dimmed">
                  You'll be notified about new messages, announcements, and more.
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
        title="Clear All Notifications"
        centered
      >
        <Text mb="lg">
          Are you sure you want to delete all notifications? This action cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeClearAll}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => clearAllMutation.mutate()}
            loading={clearAllMutation.isPending}
          >
            Clear All
          </Button>
        </Group>
      </Modal>
    </>
  );
}

interface NotificationCardProps {
  notification: Notification;
  onClick: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
}

function NotificationCard({ notification, onClick, onMarkRead, onDelete }: NotificationCardProps) {
  const icon = notificationIcons[notification.notification_type];
  const color = notificationColors[notification.notification_type];

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{
        cursor: notification.link ? 'pointer' : 'default',
        opacity: notification.is_read ? 0.7 : 1,
        backgroundColor: notification.is_read ? undefined : 'var(--mantine-color-blue-light)',
      }}
      onClick={(e) => {
        // Don't trigger click if menu is clicked
        if ((e.target as HTMLElement).closest('[data-menu-trigger]')) return;
        onClick();
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
                  New
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
                  e.stopPropagation();
                  onMarkRead();
                }}
              >
                Mark as read
              </Menu.Item>
            )}
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  );
}

interface NotificationPreferencesModalProps {
  opened: boolean;
  onClose: () => void;
}

function NotificationPreferencesModal({ opened, onClose }: NotificationPreferencesModalProps) {
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsApi.getPreferences,
    enabled: opened,
  });

  const updateMutation = useMutation({
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      notifications.show({
        title: 'Preferences updated',
        message: 'Your notification preferences have been saved.',
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to update preferences. Please try again.',
        color: 'red',
      });
    },
  });

  const handleToggle = (key: keyof NotificationPreference, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Notification Preferences"
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
              In-App
            </Tabs.Tab>
            <Tabs.Tab value="email" leftSection={<IconMessage size={16} />}>
              Email
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="in-app">
            <Stack gap="md">
              <Text size="sm" c="dimmed" mb="xs">
                Choose which notifications you want to receive in the app.
              </Text>
              <Switch
                label="New messages"
                description="When someone sends you a direct message"
                checked={preferences.notify_messages}
                onChange={(e) => handleToggle('notify_messages', e.currentTarget.checked)}
              />
              <Switch
                label="Announcements"
                description="When new community announcements are posted"
                checked={preferences.notify_announcements}
                onChange={(e) => handleToggle('notify_announcements', e.currentTarget.checked)}
              />
              <Switch
                label="Forum subscriptions"
                description="New threads in subgroups you're subscribed to"
                checked={preferences.notify_forum_subscriptions}
                onChange={(e) => handleToggle('notify_forum_subscriptions', e.currentTarget.checked)}
              />
              <Switch
                label="Thread replies"
                description="When someone replies to your thread"
                checked={preferences.notify_thread_replies}
                onChange={(e) => handleToggle('notify_thread_replies', e.currentTarget.checked)}
              />
              <Switch
                label="Event reminders"
                description="Reminders for upcoming calendar events"
                checked={preferences.notify_event_reminders}
                onChange={(e) => handleToggle('notify_event_reminders', e.currentTarget.checked)}
              />
              <Switch
                label="Food tickets"
                description="When new food tickets become available"
                checked={preferences.notify_food_tickets}
                onChange={(e) => handleToggle('notify_food_tickets', e.currentTarget.checked)}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="email">
            <Stack gap="md">
              <Text size="sm" c="dimmed" mb="xs">
                Get an email whenever you receive a notification. Enable email for the notification types you want.
              </Text>
              <Switch
                label="New messages"
                description="Email when someone sends you a direct message"
                checked={preferences.email_messages}
                onChange={(e) => handleToggle('email_messages', e.currentTarget.checked)}
              />
              <Switch
                label="Announcements"
                description="Email when new community announcements are posted"
                checked={preferences.email_announcements}
                onChange={(e) => handleToggle('email_announcements', e.currentTarget.checked)}
              />
              <Switch
                label="Forum subscriptions"
                description="Email for new threads in subgroups you're subscribed to"
                checked={preferences.email_forum_subscriptions}
                onChange={(e) => handleToggle('email_forum_subscriptions', e.currentTarget.checked)}
              />
              <Switch
                label="Thread replies"
                description="Email when someone replies to your thread"
                checked={preferences.email_thread_replies}
                onChange={(e) => handleToggle('email_thread_replies', e.currentTarget.checked)}
              />
              <Switch
                label="Event reminders"
                description="Email reminders for upcoming calendar events"
                checked={preferences.email_event_reminders}
                onChange={(e) => handleToggle('email_event_reminders', e.currentTarget.checked)}
              />
              <Switch
                label="Food tickets"
                description="Email when new food tickets become available"
                checked={preferences.email_food_tickets}
                onChange={(e) => handleToggle('email_food_tickets', e.currentTarget.checked)}
              />
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Modal>
  );
}
