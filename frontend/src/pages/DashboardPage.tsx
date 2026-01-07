import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Title,
  Text,
  SimpleGrid,
  Paper,
  Group,
  ThemeIcon,
  Stack,
  Avatar,
  Button,
  Loader,
  Badge,
} from '@mantine/core';
import {
  IconMessageCircle,
  IconCalendar,
  IconHome,
  IconSoup,
  IconSpeakerphone,
  IconUsers,
  IconArrowRight,
  IconBell,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { useAuthStore } from '../store/authStore';
import { announcementsApi } from '../api/announcements';
import { calendarApi } from '../api/calendar';
import { notificationsApi } from '../api/notifications';
import type { Announcement, CalendarEvent, Notification } from '../types';

dayjs.extend(relativeTime);

const features = [
  {
    icon: IconSpeakerphone,
    title: 'Vigtige opslag',
    description: 'Vigtige fællesskabsopdateringer',
    color: 'red',
    path: '/announcements',
  },
  {
    icon: IconMessageCircle,
    title: 'Forum',
    description: 'Fællesskabsdiskussioner',
    color: 'blue',
    path: '/forum',
  },
  {
    icon: IconSoup,
    title: 'Mad',
    description: 'Ugemenu & måltidstilmelding',
    color: 'green',
    path: '/food',
  },
  {
    icon: IconCalendar,
    title: 'Kalender',
    description: 'Fællesskabsarrangementer',
    color: 'violet',
    path: '/calendar',
  },
  {
    icon: IconHome,
    title: 'Beboeroversigt',
    description: 'Huse & beboere',
    color: 'orange',
    path: '/directory',
  },
  {
    icon: IconUsers,
    title: 'Beskeder',
    description: 'Direkte beskeder',
    color: 'cyan',
    path: '/messages',
  },
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ['announcements', 'recent'],
    queryFn: () => announcementsApi.getAnnouncements(),
  });

  const { data: upcomingEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['calendar', 'upcoming'],
    queryFn: () => calendarApi.getUpcomingEvents(),
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationsApi.getNotifications(),
  });

  // Get the 3 most recent announcements
  const recentAnnouncements = announcements?.slice(0, 3);

  // Get the 5 most recent unread notifications
  const recentNotifications = notifications?.filter((n) => !n.is_read).slice(0, 5);

  return (
    <>
      <Title order={1} mb="xs">
        Velkommen, {user?.first_name || 'bruger'}!
      </Title>
      <Text c="dimmed" mb="xl">
        Hvad vil du lave i dag?
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {features.map((feature) => (
          <Paper
            key={feature.title}
            withBorder
            p="lg"
            radius="md"
            component="a"
            href={feature.path}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Group>
              <ThemeIcon size="xl" radius="md" color={feature.color}>
                <feature.icon size={24} />
              </ThemeIcon>
              <div>
                <Text fw={500}>{feature.title}</Text>
                <Text size="sm" c="dimmed">
                  {feature.description}
                </Text>
              </div>
            </Group>
          </Paper>
        ))}
      </SimpleGrid>

      {/* Notifications Widget */}
      {recentNotifications && recentNotifications.length > 0 && (
        <Paper withBorder p="lg" radius="md" mt="xl" bg="blue.0">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size="sm" color="red" radius="xl">
                <IconBell size={14} />
              </ThemeIcon>
              <Title order={3}>Ulæste notifikationer</Title>
              <Badge color="red" size="sm">
                {recentNotifications.length}
              </Badge>
            </Group>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
              onClick={() => navigate('/notifikationer')}
            >
              Se alle
            </Button>
          </Group>
          <Stack gap="sm">
            {recentNotifications.map((notification) => (
              <NotificationPreview
                key={notification.id}
                notification={notification}
              />
            ))}
          </Stack>
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="xl">
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={3}>Seneste opslag</Title>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
              onClick={() => navigate('/opslag')}
            >
              Se alle
            </Button>
          </Group>

          {announcementsLoading ? (
            <Loader size="sm" />
          ) : recentAnnouncements && recentAnnouncements.length > 0 ? (
            <Stack gap="md">
              {recentAnnouncements.map((announcement) => (
                <AnnouncementPreview
                  key={announcement.id}
                  announcement={announcement}
                />
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">Ingen opslag endnu.</Text>
          )}
        </Paper>

        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={3}>Kommende arrangementer</Title>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
              onClick={() => navigate('/kalender')}
            >
              Se alle
            </Button>
          </Group>

          {eventsLoading ? (
            <Loader size="sm" />
          ) : upcomingEvents && upcomingEvents.length > 0 ? (
            <Stack gap="md">
              {upcomingEvents.map((event) => (
                <EventPreview key={event.id} event={event} />
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">Ingen kommende arrangementer.</Text>
          )}
        </Paper>
      </SimpleGrid>
    </>
  );
}

interface AnnouncementPreviewProps {
  announcement: Announcement;
}

function AnnouncementPreview({ announcement }: AnnouncementPreviewProps) {
  const navigate = useNavigate();

  // Strip HTML tags for preview
  const plainText = announcement.content.replace(/<[^>]*>/g, '');
  const preview = plainText.length > 150 ? `${plainText.slice(0, 150)}...` : plainText;

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="gray.0"
      style={{ cursor: 'pointer' }}
      onClick={() => navigate('/opslag')}
    >
      <Group gap="sm" mb={4}>
        <Avatar
          src={announcement.author.profile_picture}
          radius="xl"
          size="sm"
        >
          {announcement.author.first_name?.[0]}
          {announcement.author.last_name?.[0]}
        </Avatar>
        <Text size="sm" fw={500} lineClamp={1}>
          {announcement.title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2}>
        {preview}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {dayjs(announcement.created_at).fromNow()}
      </Text>
    </Paper>
  );
}

interface EventPreviewProps {
  event: CalendarEvent;
}

function EventPreview({ event }: EventPreviewProps) {
  const navigate = useNavigate();
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), 'day');
  const isTomorrow = dayjs(event.start_datetime).isSame(dayjs().add(1, 'day'), 'day');

  let dateLabel = dayjs(event.start_datetime).format('ddd, D. MMM');
  if (isToday) dateLabel = 'I dag';
  if (isTomorrow) dateLabel = 'I morgen';

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="gray.0"
      style={{ cursor: 'pointer' }}
      onClick={() => navigate('/kalender')}
    >
      <Group gap="sm" mb={4}>
        <ThemeIcon size="sm" radius="xl" color={isToday ? 'blue' : 'gray'}>
          <IconCalendar size={12} />
        </ThemeIcon>
        <Text size="sm" fw={500} lineClamp={1}>
          {event.title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {dateLabel}
        {!event.is_all_day && ` at ${dayjs(event.start_datetime).format('HH:mm')}`}
      </Text>
      {event.location && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {event.location}
        </Text>
      )}
    </Paper>
  );
}

interface NotificationPreviewProps {
  notification: Notification;
}

function NotificationPreview({ notification }: NotificationPreviewProps) {
  const navigate = useNavigate();

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="white"
      style={{ cursor: 'pointer' }}
      onClick={() => {
        if (notification.link) {
          navigate(notification.link);
        } else {
          navigate('/notifikationer');
        }
      }}
    >
      <Group gap="sm" wrap="nowrap">
        {notification.related_user ? (
          <Avatar
            src={notification.related_user.profile_picture}
            radius="xl"
            size="sm"
          >
            {notification.related_user.first_name?.[0]}
            {notification.related_user.last_name?.[0]}
          </Avatar>
        ) : (
          <ThemeIcon size="sm" radius="xl" color="blue">
            <IconBell size={12} />
          </ThemeIcon>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={1}>
            {notification.title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {notification.message}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          {dayjs(notification.created_at).fromNow()}
        </Text>
      </Group>
    </Paper>
  );
}
