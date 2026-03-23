import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
  SegmentedControl,
  Divider,
  Alert,
  Modal,
  NumberInput,
  Textarea,
  Collapse,
  UnstyledButton,
  Anchor,
} from "@mantine/core"
import { useDebouncedCallback, useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconMessageCircle,
  IconCalendar,
  IconSoup,
  IconArrowRight,
  IconBell,
  IconCake,
  IconTicket,
  IconChevronDown,
  IconChevronUp,
  IconUsers,
  IconExternalLink,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"

import { useAuthStore } from "../store/authStore"
import { announcementsApi } from "../api/announcements"
import { eventsApi } from "../api/events"
import { foodApi } from "../api/food"
import { forumApi } from "../api/forum"
import { notificationsApi } from "../api/notifications"
import { usersApi } from "../api/users"
import UserLink from "../components/UserLink"
import { calculateDefaultTicketPrice } from "../utils/priceCalculation"
import { isDateLocked } from "../utils/foodDeadline"
import type {
  Announcement,
  Event,
  Notification,
  RecentActivity,
  User,
  DriveMenu,
  MealRegistration,
  DiningOption,
  SeatingTime,
  CreateMealRegistrationData,
  CreateFoodTicketData,
  FoodTicket,
  DailyRegistrationStats,
} from "../types"

dayjs.extend(isoWeek)

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const {
    data: announcements,
    isLoading: announcementsLoading,
    isError: announcementsError,
  } = useQuery({
    queryKey: ["announcements", "recent"],
    queryFn: () => announcementsApi.getAnnouncements(),
  })

  const {
    data: upcomingEvents,
    isLoading: eventsLoading,
    isError: eventsError,
  } = useQuery({
    queryKey: ["calendar", "upcoming"],
    queryFn: () => eventsApi.getUpcomingEvents(),
  })

  const { data: notifications } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => notificationsApi.getNotifications(),
  })

  const {
    data: birthdayUsers,
    isLoading: birthdaysLoading,
    isError: birthdaysError,
  } = useQuery({
    queryKey: ["users", "birthdays"],
    queryFn: () => usersApi.getUpcomingBirthdays(7),
  })

  const {
    data: recentActivity,
    isLoading: activityLoading,
    isError: activityError,
  } = useQuery({
    queryKey: ["forum", "recent"],
    queryFn: () => forumApi.getRecentActivity(5),
  })

  const hasError =
    announcementsError || eventsError || birthdaysError || activityError

  // Food queries
  const today = dayjs()
  const currentWeekStart = today.startOf("isoWeek") // Monday
  const currentWeekNumber = today.isoWeek()
  const currentYear = today.isoWeekYear()

  // Fetch current week's drive menu
  const { data: currentDriveMenu } = useQuery({
    queryKey: ["food", "drive-menu", currentWeekNumber, currentYear],
    queryFn: () => foodApi.getDriveMenu(currentWeekNumber, currentYear),
  })

  // Fetch next week's drive menu
  const nextWeekStart = currentWeekStart.add(1, "week")
  const nextWeekNumber = nextWeekStart.isoWeek()
  const nextWeekYear = nextWeekStart.isoWeekYear()
  const { data: nextDriveMenu } = useQuery({
    queryKey: ["food", "drive-menu", nextWeekNumber, nextWeekYear],
    queryFn: () => foodApi.getDriveMenu(nextWeekNumber, nextWeekYear),
  })

  // Get registrations for current and next week
  const { data: currentWeekRegistrations } = useQuery({
    queryKey: ["food", "registrations", currentWeekStart.format("YYYY-MM-DD")],
    queryFn: () =>
      foodApi.getRegistrations(currentWeekStart.format("YYYY-MM-DD")),
  })

  const { data: nextWeekRegistrations } = useQuery({
    queryKey: ["food", "registrations", nextWeekStart.format("YYYY-MM-DD")],
    queryFn: () => foodApi.getRegistrations(nextWeekStart.format("YYYY-MM-DD")),
  })

  const { data: myTickets } = useQuery({
    queryKey: ["food", "tickets", "my"],
    queryFn: foodApi.getMyTickets,
  })

  // Fetch community stats for current and next week
  const { data: currentWeekStats } = useQuery({
    queryKey: ["food", "stats", currentWeekStart.format("YYYY-MM-DD")],
    queryFn: () =>
      foodApi.getRegistrationStats(currentWeekStart.format("YYYY-MM-DD")),
  })
  const { data: nextWeekStats } = useQuery({
    queryKey: ["food", "stats", nextWeekStart.format("YYYY-MM-DD")],
    queryFn: () =>
      foodApi.getRegistrationStats(nextWeekStart.format("YYYY-MM-DD")),
  })

  // Build map of own available-for-sale tickets by date
  const ticketsForSaleByDate = new Map<string, FoodTicket[]>()
  myTickets?.forEach((t) => {
    if (t.is_own && t.is_available) {
      const existing = ticketsForSaleByDate.get(t.date) ?? []
      ticketsForSaleByDate.set(t.date, [...existing, t])
    }
  })

  // Build map of purchased (claimed by me) tickets by date
  const purchasedTicketsByDate = new Map<string, FoodTicket[]>()
  myTickets?.forEach((t) => {
    if (!t.is_own && !t.is_available) {
      const existing = purchasedTicketsByDate.get(t.date) ?? []
      purchasedTicketsByDate.set(t.date, [...existing, t])
    }
  })

  // Helper to get menu text for a specific day from drive menu
  const getDayMenu = (
    driveMenu: DriveMenu | undefined,
    dayOfWeek: number,
  ): string => {
    if (!driveMenu) return ""
    switch (dayOfWeek) {
      case 1:
        return driveMenu.monday_menu
      case 2:
        return driveMenu.tuesday_menu
      case 3:
        return driveMenu.wednesday_menu
      case 4:
        return driveMenu.thursday_menu
      default:
        return ""
    }
  }

  // Today's day of week (1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun)
  const todayDayOfWeek = today.isoWeekday()
  const todayStr = today.format("YYYY-MM-DD")

  // Check if today is a food day (Mon-Thu)
  const isTodayFoodDay = todayDayOfWeek >= 1 && todayDayOfWeek <= 4
  const todayMenuText = isTodayFoodDay
    ? getDayMenu(currentDriveMenu, todayDayOfWeek)
    : ""

  // Find next food day
  const getNextFoodDay = (): {
    date: dayjs.Dayjs
    menuText: string
    dayOfWeek: number
  } | null => {
    // Check remaining days this week (Mon-Thu only)
    for (let d = todayDayOfWeek + 1; d <= 4; d++) {
      const menuText = getDayMenu(currentDriveMenu, d)
      if (menuText || currentDriveMenu) {
        return {
          date: currentWeekStart.add(d - 1, "day"),
          menuText,
          dayOfWeek: d,
        }
      }
    }
    // Check next week (Mon-Thu)
    for (let d = 1; d <= 4; d++) {
      const menuText = getDayMenu(nextDriveMenu, d)
      if (menuText || nextDriveMenu) {
        return {
          date: nextWeekStart.add(d - 1, "day"),
          menuText,
          dayOfWeek: d,
        }
      }
    }
    return null
  }

  const nextFoodDay = getNextFoodDay()

  // Find registrations
  const allRegistrations = [
    ...(currentWeekRegistrations || []),
    ...(nextWeekRegistrations || []),
  ]
  const todayRegistration = allRegistrations.find((r) => r.date === todayStr)
  const nextFoodDayRegistration = nextFoodDay
    ? allRegistrations.find(
        (r) => r.date === nextFoodDay.date.format("YYYY-MM-DD"),
      )
    : undefined

  // Calculate birthday info for each user
  const upcomingBirthdays = birthdayUsers?.map((u) => {
    const birthdate = dayjs(u.birthdate)
    const today = dayjs().startOf("day")
    // Create date for this year's birthday
    let nextBirthday = birthdate.year(today.year()).startOf("day")
    // If birthday has passed this year, use next year
    if (nextBirthday.isBefore(today, "day")) {
      nextBirthday = nextBirthday.add(1, "year")
    }
    const daysUntil = nextBirthday.diff(today, "day")
    const age = nextBirthday.year() - birthdate.year()
    return { user: u, nextBirthday, daysUntil, age }
  })

  // Get the 3 most recent announcements
  const recentAnnouncements = announcements?.slice(0, 3)

  // Get the 5 most recent unread notifications
  const recentNotifications = notifications?.results
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

      {hasError && (
        <Alert color="red" title="Fejl" mb="xl">
          Kunne ikke hente data. Prøv at genindlæse siden.
        </Alert>
      )}

      {/* Notifications Widget */}
      {recentNotifications && recentNotifications.length > 0 && (
        <Paper
          withBorder
          p="lg"
          radius="md"
          mt="xl"
          bg="var(--mantine-color-blue-light)"
        >
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

      {/* Birthdays and Food Widgets - Side by Side */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="xl">
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={3}>Seneste vigtig post</Title>
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

        {/* Food Widget */}
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size="sm" color="green" radius="xl">
                <IconSoup size={14} />
              </ThemeIcon>
              <Title order={3}>Mad</Title>
              {currentDriveMenu?.drive_folder_url && (
                <Anchor
                  href={currentDriveMenu.drive_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="xs"
                  c="dimmed"
                >
                  <Group gap={4}>
                    <IconExternalLink size={12} />
                    Drive
                  </Group>
                </Anchor>
              )}
            </Group>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
              onClick={() => navigate("/mad")}
            >
              Se mere
            </Button>
          </Group>
          {(isTodayFoodDay && currentDriveMenu) || nextFoodDay ? (
            <Stack gap="md">
              {isTodayFoodDay && currentDriveMenu && (
                <FoodDayWidget
                  date={todayStr}
                  dayName={today.format("dddd")}
                  menuText={todayMenuText}
                  registration={todayRegistration}
                  label="I dag"
                  isToday
                  ticketsForSale={ticketsForSaleByDate.get(todayStr) ?? []}
                  purchasedTickets={purchasedTicketsByDate.get(todayStr) ?? []}
                  communityStats={currentWeekStats?.[todayStr]}
                />
              )}
              {nextFoodDay && (
                <FoodDayWidget
                  date={nextFoodDay.date.format("YYYY-MM-DD")}
                  dayName={nextFoodDay.date.format("dddd")}
                  menuText={nextFoodDay.menuText}
                  registration={nextFoodDayRegistration}
                  label={
                    nextFoodDay.date.isSame(dayjs().add(1, "day"), "day")
                      ? "I morgen"
                      : nextFoodDay.date.format("dddd")
                  }
                  isToday={false}
                  ticketsForSale={
                    ticketsForSaleByDate.get(
                      nextFoodDay.date.format("YYYY-MM-DD"),
                    ) ?? []
                  }
                  purchasedTickets={
                    purchasedTicketsByDate.get(
                      nextFoodDay.date.format("YYYY-MM-DD"),
                    ) ?? []
                  }
                  communityStats={
                    nextFoodDay.date.isoWeek() === currentWeekNumber
                      ? currentWeekStats?.[
                          nextFoodDay.date.format("YYYY-MM-DD")
                        ]
                      : nextWeekStats?.[nextFoodDay.date.format("YYYY-MM-DD")]
                  }
                />
              )}
            </Stack>
          ) : (
            <Stack align="center" py="md" gap="xs">
              <ThemeIcon size="xl" color="gray" variant="light" radius="xl">
                <IconSoup size={24} />
              </ThemeIcon>
              <Text c="dimmed" size="sm" ta="center">
                Ingen menu tilgængelig
              </Text>
              <Button
                variant="light"
                size="xs"
                onClick={() => navigate("/mad")}
              >
                Se madplan
              </Button>
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      {/* Recent Forum Activity Widget */}
      <Paper withBorder p="lg" radius="md" mt="xl">
        <Group justify="space-between" mb="md">
          <Group gap="xs">
            <ThemeIcon size="sm" color="blue" radius="xl">
              <IconMessageCircle size={14} />
            </ThemeIcon>
            <Title order={3}>Seneste forumaktivitet</Title>
          </Group>
          <Button
            variant="subtle"
            size="xs"
            rightSection={<IconArrowRight size={14} />}
            onClick={() => navigate("/forum")}
          >
            Se forum
          </Button>
        </Group>
        {activityLoading ? (
          <Loader size="sm" />
        ) : recentActivity && recentActivity.length > 0 ? (
          <Stack gap="sm">
            {recentActivity.map((activity) => (
              <ActivityPreview key={activity.id} activity={activity} />
            ))}
          </Stack>
        ) : (
          <Text c="dimmed">Ingen forumaktivitet endnu.</Text>
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="xl">
        {/* Birthdays Widget */}
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size="sm" color="pink" radius="xl">
                <IconCake size={14} />
              </ThemeIcon>
              <Title order={3}>Fødselsdage</Title>
              {upcomingBirthdays && upcomingBirthdays.length > 0 && (
                <Badge color="pink" size="sm">
                  {upcomingBirthdays.length}
                </Badge>
              )}
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
          {birthdaysLoading ? (
            <Loader size="sm" />
          ) : upcomingBirthdays && upcomingBirthdays.length > 0 ? (
            <Stack gap="sm">
              {upcomingBirthdays.map((birthday) => (
                <BirthdayPreview key={birthday.user.id} birthday={birthday} />
              ))}
            </Stack>
          ) : (
            <Stack align="center" py="md" gap="xs">
              <ThemeIcon size="xl" color="gray" variant="light" radius="xl">
                <IconCake size={24} />
              </ThemeIcon>
              <Text c="dimmed" size="sm" ta="center">
                Ingen fødselsdage de næste 7 dage
              </Text>
            </Stack>
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
  const plainText = announcement.content
    .replace(/<\/[^>]+>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const preview =
    plainText.length > 150 ? `${plainText.slice(0, 150)}...` : plainText

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="var(--mantine-color-default-hover)"
      style={{ cursor: "pointer" }}
      onClick={() => navigate(`/opslag#announcement-${announcement.id}`)}
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
  event: Event
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
      bg="var(--mantine-color-default-hover)"
      style={{
        cursor: "pointer",
        opacity: event.is_cancelled ? 0.5 : 1,
      }}
      onClick={() => navigate(`/kalender/${event.slug}`)}
    >
      <Group gap="sm" mb={4}>
        <ThemeIcon
          size="sm"
          radius="xl"
          color={event.is_cancelled ? "red" : isToday ? "blue" : "gray"}
        >
          <IconCalendar size={12} />
        </ThemeIcon>
        <Text
          size="sm"
          fw={500}
          lineClamp={2}
          td={event.is_cancelled ? "line-through" : undefined}
        >
          {event.title}
        </Text>
        {event.is_cancelled && (
          <Badge size="xs" color="red">
            Aflyst
          </Badge>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        {dateLabel}
        {` kl. ${dayjs(event.start_datetime).format("HH:mm")}`}
      </Text>
      {event.resolved_location && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {event.resolved_location}
        </Text>
      )}
      {event.rsvp_enabled && event.rsvp_summary && !event.is_cancelled && (
        <Group gap="xs" mt={4}>
          <Badge size="xs" variant="light" color="gray">
            {event.rsvp_summary.attending} deltager
          </Badge>
          {event.my_rsvp && (
            <Badge
              size="xs"
              color={
                event.my_rsvp === "attending"
                  ? "green"
                  : event.my_rsvp === "not_attending"
                    ? "red"
                    : "yellow"
              }
            >
              {event.my_rsvp === "attending"
                ? "Deltager"
                : event.my_rsvp === "not_attending"
                  ? "Afmeldt"
                  : "Ikke svaret"}
            </Badge>
          )}
        </Group>
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

interface ActivityPreviewProps {
  activity: RecentActivity
}

function ActivityPreview({ activity }: ActivityPreviewProps) {
  const navigate = useNavigate()

  // Strip HTML tags for preview
  const plainText = activity.content
    .replace(/<\/[^>]+>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const preview =
    plainText.length > 100 ? `${plainText.slice(0, 100)}...` : plainText

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="var(--mantine-color-default-hover)"
      style={{
        cursor: "pointer",
        transition: "background-color 150ms ease",
      }}
      onClick={() =>
        navigate(
          `/forum/${activity.subgroup_slug}/traad/${activity.thread_slug}#post-${activity.id}`,
        )
      }
    >
      <Group justify="space-between" wrap="nowrap" mb={4} gap="xs">
        <Badge variant="outline" color="blue">
          {activity.subgroup_name}
        </Badge>
        <Text
          size="xs"
          c="dimmed"
          style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {dayjs(activity.created_at).fromNow()}
        </Text>
      </Group>
      <Text size="sm" fw={600} mb={4}>
        {activity.thread_title}
      </Text>
      <Group gap="sm" wrap="nowrap" mb={4}>
        <Avatar src={activity.author?.profile_picture} radius="xl" size="sm">
          {activity.author?.first_name?.[0]}
          {activity.author?.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          {activity.author ? (
            <UserLink
              id={activity.author.id}
              firstName={activity.author.first_name}
              lastName={activity.author.last_name}
              size="sm"
              fw={500}
            />
          ) : (
            <Text size="sm" c="dimmed" fw={500}>
              Slettet bruger
            </Text>
          )}
        </div>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2} ml={40}>
        {preview}
      </Text>
    </Paper>
  )
}

interface FoodDayWidgetProps {
  date: string
  dayName: string
  menuText: string
  registration?: MealRegistration
  label: string
  isToday: boolean
  ticketsForSale?: FoodTicket[]
  purchasedTickets?: FoodTicket[]
  communityStats?: DailyRegistrationStats
}

function FoodDayWidget({
  date,
  dayName,
  menuText,
  registration,
  label,
  isToday,
  ticketsForSale,
  purchasedTickets,
  communityStats,
}: FoodDayWidgetProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [isSaving, setIsSaving] = useState(false)
  const [statsOpen, setStatsOpen] = useState(true)

  // Local state for registration controls
  const [isActive, setIsActive] = useState(registration?.is_active ?? true)
  const [diningOption, setDiningOption] = useState<DiningOption>(
    registration?.dining_option ?? "eat_in",
  )
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    registration?.seating_time ?? "17:30",
  )

  // Sell ticket modal state
  const [
    ticketModalOpened,
    { open: openTicketModal, close: closeTicketModal },
  ] = useDisclosure(false)
  const isWednesday = dayjs(date).day() === 3
  const availablePortions = registration?.available_portions ?? {
    adults_meat: 0,
    adults_veg: 0,
    children_count: 0,
  }
  const [sellMeat, setSellMeat] = useState(0)
  const [sellVeg, setSellVeg] = useState(0)
  const [sellChildren, setSellChildren] = useState(0)
  const [sellDescription, setSellDescription] = useState("")
  const hasSomethingToSell =
    availablePortions.adults_meat > 0 ||
    availablePortions.adults_veg > 0 ||
    availablePortions.children_count > 0
  const sellPrice = calculateDefaultTicketPrice(sellMeat, sellVeg, sellChildren)

  // Track if initial mount to prevent auto-save on mount
  const [hasInitialized, setHasInitialized] = useState(false)

  // Sync state when registration changes
  useEffect(() => {
    if (registration) {
      setIsActive(registration.is_active)
      setDiningOption(registration.dining_option)
      setSeatingTime(registration.seating_time)
    }
  }, [registration])

  const createMutation = useMutation({
    mutationFn: (data: CreateMealRegistrationData) =>
      foodApi.createRegistration(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "registrations"],
      })
      setIsSaving(false)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme tilmelding.",
        color: "red",
      })
      setIsSaving(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateMealRegistrationData>) =>
      foodApi.updateRegistration(registration!.id as number, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "registrations"],
      })
      setIsSaving(false)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme tilmelding.",
        color: "red",
      })
      setIsSaving(false)
    },
  })

  const createTicketMutation = useMutation({
    mutationFn: (data: CreateFoodTicketData) => foodApi.createTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "registrations"] })
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })
      closeTicketModal()
      setSellDescription("")
      notifications.show({
        title: "Billet oprettet",
        message: "Din madbillet er nu tilgængelig for andre.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette billet. Prøv venligst igen.",
        color: "red",
      })
    },
  })

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (data: CreateMealRegistrationData, regId: number | null | undefined) => {
      setIsSaving(true)
      if (regId) {
        updateMutation.mutate(data)
      } else {
        createMutation.mutate(data)
      }
    },
    500,
  )

  // Auto-save when values change
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true)
      return
    }

    const defaultAdults = user?.house_inhabitant_count || 1
    const data: CreateMealRegistrationData = {
      date,
      adults_meat: registration?.adults_meat ?? 0,
      adults_veg: registration?.adults_veg ?? defaultAdults,
      children_count: registration?.children_count ?? 0,
      dining_option: diningOption,
      seating_time: seatingTime,
      house_id: user?.house ?? null,
      is_active: isActive,
    }

    debouncedSave(data, registration?.id)
  }, [isActive, diningOption, seatingTime])

  const isLocked = isDateLocked(date)
  const isPast = dayjs(date).isBefore(dayjs(), "day")

  const handleOpenSellModal = () => {
    setSellMeat(availablePortions.adults_meat)
    setSellVeg(availablePortions.adults_veg)
    setSellChildren(availablePortions.children_count)
    setSellDescription("")
    openTicketModal()
  }

  const handleSellTicket = () => {
    const ticketData: CreateFoodTicketData = {
      date,
      adults_meat: sellMeat,
      adults_veg: sellVeg,
      children_count: sellChildren,
      price: sellPrice,
      description: sellDescription,
    }
    createTicketMutation.mutate(ticketData)
  }

  return (
    <>
      <Paper p="sm" radius="sm">
        <Group justify="space-between" mb="xs">
          <div>
            <Group gap="xs">
              <Badge
                color={isToday ? "green" : "blue"}
                variant="light"
                size="sm"
              >
                {label}
              </Badge>
              {isLocked && (
                <Badge color="orange" variant="light" size="sm">
                  Låst
                </Badge>
              )}
            </Group>
            <Text fw={500} size="sm" mt={4}>
              {dayName}
            </Text>
          </div>
          <Text size="xs" c="dimmed">
            {dayjs(date).format("D. MMM")}
          </Text>
        </Group>

        {/* Menu description */}
        <Text size="xs" mb="sm">
          {menuText || "Menu kommer snart"}
        </Text>

        <Divider mb="sm" />

        {/* Registration controls */}
        <Stack gap="xs">
          {isLocked && !registration?.is_active ? (
            <Text size="xs" c="dimmed" ta="center">
              Ikke tilmeldt
            </Text>
          ) : (
            <>
              <SegmentedControl
                value={isActive ? "yes" : "no"}
                onChange={(val) => setIsActive(val === "yes")}
                data={[
                  { label: "Spiser", value: "yes" },
                  { label: "Spiser ikke", value: "no" },
                ]}
                fullWidth
                size="xs"
                disabled={isLocked}
              />

              {isActive && (
                <>
                  <SegmentedControl
                    value={diningOption}
                    onChange={(val) => setDiningOption(val as DiningOption)}
                    data={[
                      { label: "Fælleshus", value: "eat_in" },
                      { label: "Take Away", value: "take_away" },
                    ]}
                    fullWidth
                    size="xs"
                  />

                  {diningOption === "eat_in" && (
                    <SegmentedControl
                      value={seatingTime}
                      onChange={(val) => setSeatingTime(val as SeatingTime)}
                      data={[
                        { label: "17:30", value: "17:30" },
                        { label: "18:30", value: "18:30" },
                      ]}
                      fullWidth
                      size="xs"
                    />
                  )}

                  {isLocked && hasSomethingToSell && !isPast && (
                    <Button
                      variant="light"
                      color="orange"
                      size="xs"
                      leftSection={<IconTicket size={14} />}
                      onClick={handleOpenSellModal}
                    >
                      Sælg billet
                    </Button>
                  )}

                  {ticketsForSale && ticketsForSale.length > 0 && (
                    <Stack gap={2} mt="xs">
                      {ticketsForSale.map((t) => (
                        <Text key={t.id} size="xs" c="orange">
                          Billet til salg: {t.total_portions} port.{" "}
                          {t.price ? `• ${t.price} kr` : "• Gratis"}
                        </Text>
                      ))}
                    </Stack>
                  )}

                  {purchasedTickets && purchasedTickets.length > 0 && (
                    <Stack gap={2} mt="xs">
                      {purchasedTickets.map((t) => (
                        <Group key={t.id} gap="xs" wrap="nowrap">
                          <Avatar
                            src={t.owner.profile_picture}
                            size={18}
                            radius="xl"
                          >
                            {t.owner.first_name?.[0]}
                          </Avatar>
                          <Text size="xs" c="green">
                            Købt billet: {t.total_portions} port.{" "}
                            {t.price ? `• ${t.price} kr` : "• Gratis"} fra{" "}
                            {t.owner.first_name}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </>
          )}

          {/* Status indicator */}
          {isSaving ? (
            <Text size="xs" c="blue" ta="center">
              <Group gap={4} justify="center">
                <Loader size={10} />
                Gemmer...
              </Group>
            </Text>
          ) : registration?.is_active ? (
            <Group justify="center" gap="xs">
              {isWednesday && registration.adults_meat > 0 && (
                <Text size="sm" fw={600}>
                  {registration.adults_meat} kød
                </Text>
              )}
              {registration.adults_veg > 0 && (
                <Text size="sm" fw={600}>
                  {isWednesday
                    ? `${registration.adults_veg} vegetar`
                    : `${registration.adults_veg} voksne`}
                </Text>
              )}
              {registration.children_count > 0 && (
                <Text size="sm" fw={600}>
                  {registration.children_count} børn
                </Text>
              )}
              {registration.total_portions === 0 && (
                <Text size="sm" fw={600} c="dimmed">
                  0 portioner
                </Text>
              )}
            </Group>
          ) : registration ? (
            <Text size="xs" c="dimmed" ta="center">
              Spiser ikke
            </Text>
          ) : (
            <Text size="xs" c="dimmed" ta="center">
              Ikke tilmeldt endnu
            </Text>
          )}
        </Stack>

        {communityStats && (
          <>
            <Divider mt="sm" />
            <UnstyledButton
              onClick={() => setStatsOpen((o) => !o)}
              w="100%"
              mt="xs"
            >
              <Group gap="xs" justify="space-between">
                <Group gap={4}>
                  <IconUsers size={12} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    Fællesskabets tilmeldinger
                  </Text>
                </Group>
                {statsOpen ? (
                  <IconChevronUp
                    size={12}
                    color="var(--mantine-color-dimmed)"
                  />
                ) : (
                  <IconChevronDown
                    size={12}
                    color="var(--mantine-color-dimmed)"
                  />
                )}
              </Group>
            </UnstyledButton>
            <Collapse expanded={statsOpen}>
              <CommunityRegistrationStats stats={communityStats} />
            </Collapse>
          </>
        )}
      </Paper>

      <Modal
        opened={ticketModalOpened}
        onClose={closeTicketModal}
        title="Sælg billet"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Vælg hvor mange portioner du vil sælge. Køber betaler dig direkte
            via MobilePay.
          </Text>

          {isWednesday ? (
            <>
              <NumberInput
                label="Kød-portioner"
                value={sellMeat}
                onChange={(v) => setSellMeat(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_meat}
                disabled={availablePortions.adults_meat === 0}
              />
              <NumberInput
                label="Vegetar-portioner"
                value={sellVeg}
                onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_veg}
                disabled={availablePortions.adults_veg === 0}
              />
            </>
          ) : (
            <NumberInput
              label="Voksne"
              value={sellVeg}
              onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
              min={0}
              max={availablePortions.adults_veg}
              disabled={availablePortions.adults_veg === 0}
            />
          )}

          <NumberInput
            label="Børneportioner"
            value={sellChildren}
            onChange={(v) => setSellChildren(typeof v === "number" ? v : 0)}
            min={0}
            max={availablePortions.children_count}
            disabled={availablePortions.children_count === 0}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Pris
            </Text>
            <Text size="xl" fw={700}>
              {sellPrice} kr
            </Text>
            <Text size="xs" c="dimmed">
              37/voksen (kød) · 26/voksen (vegetar) · 18/barn
            </Text>
          </Stack>

          <Textarea
            label="Note (valgfrit)"
            placeholder="Yderligere information..."
            value={sellDescription}
            onChange={(e) => setSellDescription(e.target.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={closeTicketModal}>
              Annuller
            </Button>
            <Button
              onClick={handleSellTicket}
              loading={createTicketMutation.isPending}
              disabled={sellMeat + sellVeg + sellChildren === 0}
            >
              Opret billet
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

interface CommunityRegistrationStatsProps {
  stats: DailyRegistrationStats
}

function CommunityRegistrationStats({
  stats,
}: CommunityRegistrationStatsProps) {
  const hasWednesdayData =
    stats.eat_in_1730.adults_meat > 0 ||
    stats.eat_in_1830.adults_meat > 0 ||
    stats.takeaway.adults_meat > 0

  const formatSlot = (slot: DailyRegistrationStats["eat_in_1730"]) => {
    if (slot.adults === 0 && slot.children === 0) return null
    const parts: string[] = []
    if (hasWednesdayData) {
      if (slot.adults_veg > 0) parts.push(`${slot.adults_veg} veg`)
      if (slot.adults_meat > 0) parts.push(`${slot.adults_meat} kød`)
    } else {
      if (slot.adults > 0) parts.push(`${slot.adults} voksne`)
    }
    if (slot.children > 0) parts.push(`${slot.children} børn`)
    return parts.join(" · ")
  }

  const slot1730 = formatSlot(stats.eat_in_1730)
  const slot1830 = formatSlot(stats.eat_in_1830)
  const slotTakeaway = formatSlot(stats.takeaway)

  if (!slot1730 && !slot1830 && !slotTakeaway) {
    return (
      <Text size="xs" c="dimmed" mt="xs">
        Ingen tilmeldte endnu
      </Text>
    )
  }

  return (
    <Stack gap={4} mt="xs">
      {slot1730 && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            17:30
          </Text>
          <Text size="xs" c="dimmed">
            {slot1730}
          </Text>
        </Group>
      )}
      {slot1830 && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            18:30
          </Text>
          <Text size="xs" c="dimmed">
            {slot1830}
          </Text>
        </Group>
      )}
      {slotTakeaway && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            Take away
          </Text>
          <Text size="xs" c="dimmed">
            {slotTakeaway}
          </Text>
        </Group>
      )}
    </Stack>
  )
}
