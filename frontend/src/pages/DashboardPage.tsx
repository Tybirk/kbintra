import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
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
} from "@mantine/core"
import {
  IconMessageCircle,
  IconCalendar,
  IconHome,
  IconSoup,
  IconSpeakerphone,
  IconUsers,
  IconArrowRight,
  IconBell,
  IconCake,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { useAuthStore } from "../store/authStore"
import { announcementsApi } from "../api/announcements"
import { calendarApi } from "../api/calendar"
import { notificationsApi } from "../api/notifications"
import { usersApi } from "../api/users"
import type { Announcement, CalendarEvent, Notification, User } from "../types"

dayjs.extend(relativeTime)

const features = [
  {
    icon: IconSpeakerphone,
    title: "Vigtige opslag",
    description: "Vigtige fællesskabsopdateringer",
    path: "/opslag",
  },
  {
    icon: IconMessageCircle,
    title: "Forum",
    description: "Fællesskabsdiskussioner",
    color: "blue",
    path: "/forum",
  },
  {
    icon: IconSoup,
    title: "Mad",
    description: "Ugemenu & måltidstilmelding",
    color: "green",
    path: "/mad",
  },
  {
    icon: IconCalendar,
    title: "Kalender",
    description: "Fællesskabsarrangementer",
    color: "violet",
    path: "/kalender",
  },
  {
    icon: IconHome,
    title: "Beboeroversigt",
    description: "Huse & beboere",
    color: "orange",
    path: "/beboere",
  },
  {
    icon: IconUsers,
    title: "Beskeder",
    description: "Direkte beskeder",
    color: "cyan",
    path: "/beskeder",
  },
]

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ["announcements", "recent"],
    queryFn: () => announcementsApi.getAnnouncements(),
  })

  const { data: upcomingEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["calendar", "upcoming"],
    queryFn: () => calendarApi.getUpcomingEvents(),
  })

  const { data: notifications } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => notificationsApi.getNotifications(),
  })

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.getUsers(),
  })

  // Get upcoming birthdays (next 7 days)
  const upcomingBirthdays = usersData?.results
    ?.filter((u) => u.birthdate)
    .map((u) => {
      const birthdate = dayjs(u.birthdate)
      const today = dayjs()
      // Create date for this year's birthday
      let nextBirthday = birthdate.year(today.year())
      // If birthday has passed this year, use next year
      if (nextBirthday.isBefore(today, "day")) {
        nextBirthday = nextBirthday.add(1, "year")
      }
      const daysUntil = nextBirthday.diff(today, "day")
      const age = nextBirthday.year() - birthdate.year()
      return { user: u, nextBirthday, daysUntil, age }
    })
    .filter((b) => b.daysUntil >= 0 && b.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil)

  // Get the 3 most recent announcements
  const recentAnnouncements = announcements?.slice(0, 3)

  // Get the 5 most recent unread notifications
  const recentNotifications = notifications
    ?.filter((n) => !n.is_read)
    .slice(0, 5)

  return (
    <>
      <Title order={1} mb="xs">
        Velkommen, {user?.first_name || "bruger"}!
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
            style={{ textDecoration: "none", color: "inherit" }}
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
              onClick={() => navigate("/notifikationer")}
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

      {/* Birthdays Widget */}
      {!usersLoading && upcomingBirthdays && upcomingBirthdays.length > 0 && (
        <Paper withBorder p="lg" radius="md" mt="xl" bg="pink.0">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size="sm" color="pink" radius="xl">
                <IconCake size={14} />
              </ThemeIcon>
              <Title order={3}>Fødselsdage</Title>
              <Badge color="pink" size="sm">
                {upcomingBirthdays.length}
              </Badge>
            </Group>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
              onClick={() => navigate("/beboere")}
            >
              Se beboere
            </Button>
          </Group>
          <Stack gap="sm">
            {upcomingBirthdays.map((birthday) => (
              <BirthdayPreview key={birthday.user.id} birthday={birthday} />
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
              onClick={() => navigate("/opslag")}
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
              onClick={() => navigate("/kalender")}
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
  )
}

interface AnnouncementPreviewProps {
  announcement: Announcement
}

function AnnouncementPreview({ announcement }: AnnouncementPreviewProps) {
  const navigate = useNavigate()

  // Strip HTML tags for preview
  const plainText = announcement.content.replace(/<[^>]*>/g, "")
  const preview =
    plainText.length > 150 ? `${plainText.slice(0, 150)}...` : plainText

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="gray.0"
      style={{ cursor: "pointer" }}
      onClick={() => navigate("/opslag")}
    >
      <Group gap="sm" mb={4}>
        <Avatar src={announcement.author.profile_picture} radius="xl" size="sm">
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
  )
}

interface EventPreviewProps {
  event: CalendarEvent
}

function EventPreview({ event }: EventPreviewProps) {
  const navigate = useNavigate()
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), "day")
  const isTomorrow = dayjs(event.start_datetime).isSame(
    dayjs().add(1, "day"),
    "day",
  )

  let dateLabel = dayjs(event.start_datetime).format("ddd, D. MMM")
  if (isToday) dateLabel = "I dag"
  if (isTomorrow) dateLabel = "I morgen"

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="gray.0"
      style={{ cursor: "pointer" }}
      onClick={() => navigate("/kalender")}
    >
      <Group gap="sm" mb={4}>
        <ThemeIcon size="sm" radius="xl" color={isToday ? "blue" : "gray"}>
          <IconCalendar size={12} />
        </ThemeIcon>
        <Text size="sm" fw={500} lineClamp={1}>
          {event.title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {dateLabel}
        {!event.is_all_day &&
          ` at ${dayjs(event.start_datetime).format("HH:mm")}`}
      </Text>
      {event.location && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {event.location}
        </Text>
      )}
    </Paper>
  )
}

interface NotificationPreviewProps {
  notification: Notification
}

function NotificationPreview({ notification }: NotificationPreviewProps) {
  const navigate = useNavigate()

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="white"
      style={{ cursor: "pointer" }}
      onClick={() => {
        if (notification.link) {
          navigate(notification.link)
        } else {
          navigate("/notifikationer")
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
  )
}

interface BirthdayInfo {
  user: User
  nextBirthday: dayjs.Dayjs
  daysUntil: number
  age: number
}

interface BirthdayPreviewProps {
  birthday: BirthdayInfo
}

function BirthdayPreview({ birthday }: BirthdayPreviewProps) {
  const navigate = useNavigate()
  const { user, daysUntil, age } = birthday

  let dateLabel: string
  if (daysUntil === 0) {
    dateLabel = "I dag!"
  } else if (daysUntil === 1) {
    dateLabel = "I morgen"
  } else {
    dateLabel = `Om ${daysUntil} dage`
  }

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="white"
      style={{ cursor: "pointer" }}
      onClick={() => navigate(`/beboere/${user.house}`)}
    >
      <Group gap="sm" wrap="nowrap">
        <Avatar src={user.profile_picture} radius="xl" size="sm">
          {user.first_name?.[0]}
          {user.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={1}>
            {user.first_name} {user.last_name}
          </Text>
          <Text size="xs" c="dimmed">
            Fylder {age} år
          </Text>
        </div>
        <Badge color={daysUntil === 0 ? "pink" : "gray"} size="sm">
          {dateLabel}
        </Badge>
      </Group>
    </Paper>
  )
}
