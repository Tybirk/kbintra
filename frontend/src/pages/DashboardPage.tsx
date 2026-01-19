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
} from "@mantine/core"
import { useDebouncedCallback } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconMessageCircle,
  IconCalendar,
  IconSoup,
  IconArrowRight,
  IconBell,
  IconCake,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import isoWeek from "dayjs/plugin/isoWeek"

import { useAuthStore } from "../store/authStore"
import { announcementsApi } from "../api/announcements"
import { calendarApi } from "../api/calendar"
import { foodApi } from "../api/food"
import { forumApi } from "../api/forum"
import { notificationsApi } from "../api/notifications"
import { usersApi } from "../api/users"
import type {
  Announcement,
  CalendarEvent,
  Notification,
  RecentActivity,
  User,
  DriveMenu,
  MealRegistration,
  DiningOption,
  SeatingTime,
  CreateMealRegistrationData,
} from "../types"

dayjs.extend(relativeTime)
dayjs.extend(isoWeek)

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

  const { data: birthdayUsers, isLoading: birthdaysLoading } = useQuery({
    queryKey: ["users", "birthdays"],
    queryFn: () => usersApi.getUpcomingBirthdays(7),
  })

  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: ["forum", "recent"],
    queryFn: () => forumApi.getRecentActivity(5),
  })

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

  const nextFoodDay =
    !isTodayFoodDay || todayDayOfWeek === 4
      ? getNextFoodDay()
      : getNextFoodDay()

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

interface ActivityPreviewProps {
  activity: RecentActivity
}

function ActivityPreview({ activity }: ActivityPreviewProps) {
  const navigate = useNavigate()

  // Strip HTML tags for preview
  const plainText = activity.content.replace(/<[^>]*>/g, "")
  const preview =
    plainText.length > 100 ? `${plainText.slice(0, 100)}...` : plainText

  return (
    <Paper
      p="sm"
      radius="sm"
      bg="gray.0"
      style={{ cursor: "pointer" }}
      onClick={() =>
        navigate(`/forum/${activity.subgroup_slug}/${activity.thread_id}`)
      }
    >
      <Group gap="sm" wrap="nowrap" mb={4}>
        <Avatar src={activity.author.profile_picture} radius="xl" size="sm">
          {activity.author.first_name?.[0]}
          {activity.author.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={1}>
            {activity.author.first_name} {activity.author.last_name}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            i {activity.thread_title}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          {dayjs(activity.created_at).fromNow()}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2} ml={40}>
        {preview}
      </Text>
      <Badge size="xs" variant="light" color="blue" mt={4} ml={40}>
        {activity.subgroup_name}
      </Badge>
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
}

function FoodDayWidget({
  date,
  dayName,
  menuText,
  registration,
  label,
  isToday,
}: FoodDayWidgetProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [isSaving, setIsSaving] = useState(false)

  // Local state for registration controls
  const [isActive, setIsActive] = useState(registration?.is_active ?? true)
  const [diningOption, setDiningOption] = useState<DiningOption>(
    registration?.dining_option ?? "eat_in",
  )
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    registration?.seating_time ?? "17:30",
  )

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
      foodApi.updateRegistration(registration!.id, data),
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

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (data: CreateMealRegistrationData, regId: number | undefined) => {
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
      adults_count: registration?.adults_count ?? defaultAdults,
      children_count: registration?.children_count ?? 0,
      meal_type: registration?.meal_type ?? "meat",
      dining_option: diningOption,
      seating_time: seatingTime,
      house_id: user?.house ?? null,
      is_active: isActive,
    }

    debouncedSave(data, registration?.id)
  }, [isActive, diningOption, seatingTime])

  return (
    <Paper p="sm" radius="sm" bg="white">
      <Group justify="space-between" mb="xs">
        <div>
          <Badge color={isToday ? "green" : "blue"} variant="light" size="sm">
            {label}
          </Badge>
          <Text fw={500} size="sm" mt={4}>
            {dayName}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          {dayjs(date).format("D. MMM")}
        </Text>
      </Group>

      {/* Menu description */}
      <Text size="xs" mb="sm" lineClamp={2}>
        {menuText || "Menu kommer snart"}
      </Text>

      <Divider mb="sm" />

      {/* Registration controls */}
      <Stack gap="xs">
        <SegmentedControl
          value={isActive ? "yes" : "no"}
          onChange={(val) => setIsActive(val === "yes")}
          data={[
            { label: "Spiser", value: "yes" },
            { label: "Spiser ikke", value: "no" },
          ]}
          fullWidth
          size="xs"
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
          </>
        )}

        {/* Status indicator */}
        <Text size="xs" c={isSaving ? "blue" : "dimmed"} ta="center">
          {isSaving ? (
            <Group gap={4} justify="center">
              <Loader size={10} />
              Gemmer...
            </Group>
          ) : registration?.is_active ? (
            `${registration.total_portions} port. • ${
              registration.dining_option === "eat_in"
                ? `kl. ${registration.seating_time}`
                : "Take away"
            }`
          ) : registration ? (
            "Spiser ikke"
          ) : (
            "Ikke tilmeldt endnu"
          )}
        </Text>
      </Stack>
    </Paper>
  )
}
