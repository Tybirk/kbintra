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
  DailyMenu,
  MealRegistration,
  DiningOption,
  SeatingTime,
  CreateMealRegistrationData,
} from "../types"

dayjs.extend(relativeTime)
dayjs.extend(isoWeek)

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

  const { data: allMenus } = useQuery({
    queryKey: ["food", "menus"],
    queryFn: foodApi.getWeeklyMenus,
  })

  // Get registrations for current and next week
  const { data: currentWeekRegistrations } = useQuery({
    queryKey: ["food", "registrations", currentWeekStart.format("YYYY-MM-DD")],
    queryFn: () =>
      foodApi.getRegistrations(currentWeekStart.format("YYYY-MM-DD")),
  })

  const nextWeekStart = currentWeekStart.add(1, "week")
  const { data: nextWeekRegistrations } = useQuery({
    queryKey: ["food", "registrations", nextWeekStart.format("YYYY-MM-DD")],
    queryFn: () => foodApi.getRegistrations(nextWeekStart.format("YYYY-MM-DD")),
  })

  // Find today's menu and next food day's menu
  const todayStr = today.format("YYYY-MM-DD")
  const currentWeekMenu = allMenus?.find(
    (m) => m.week_start_date === currentWeekStart.format("YYYY-MM-DD"),
  )
  const nextWeekMenu = allMenus?.find(
    (m) => m.week_start_date === nextWeekStart.format("YYYY-MM-DD"),
  )

  // Combine all daily menus and find today and next food day
  const allDailyMenus = [
    ...(currentWeekMenu?.daily_menus || []),
    ...(nextWeekMenu?.daily_menus || []),
  ]
  const todayMenu = allDailyMenus.find((m) => m.date === todayStr)
  const nextFoodDayMenu = allDailyMenus.find((m) =>
    dayjs(m.date).isAfter(today, "day"),
  )

  // Find registrations for today and next food day
  const allRegistrations = [
    ...(currentWeekRegistrations || []),
    ...(nextWeekRegistrations || []),
  ]
  const todayRegistration = allRegistrations.find((r) => r.date === todayStr)
  const nextFoodDayRegistration = nextFoodDayMenu
    ? allRegistrations.find((r) => r.date === nextFoodDayMenu.date)
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
          {todayMenu || nextFoodDayMenu ? (
            <Stack gap="md">
              {todayMenu && (
                <FoodDayWidget
                  menu={todayMenu}
                  registration={todayRegistration}
                  label="I dag"
                  isToday
                />
              )}
              {nextFoodDayMenu && (
                <FoodDayWidget
                  menu={nextFoodDayMenu}
                  registration={nextFoodDayRegistration}
                  label={
                    dayjs(nextFoodDayMenu.date).isSame(
                      dayjs().add(1, "day"),
                      "day",
                    )
                      ? "I morgen"
                      : dayjs(nextFoodDayMenu.date).format("dddd")
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
  menu: DailyMenu
  registration?: MealRegistration
  label: string
  isToday: boolean
}

function FoodDayWidget({
  menu,
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
      date: menu.date,
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
            {menu.day_name}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          {dayjs(menu.date).format("D. MMM")}
        </Text>
      </Group>

      {/* Menu description */}
      {menu.has_meat_option ? (
        <Stack gap={2} mb="sm">
          <Text size="xs">
            <Text span fw={500} c="red.6">
              Kød:
            </Text>{" "}
            {menu.effective_meat_description || "Kommer snart"}
          </Text>
          <Text size="xs">
            <Text span fw={500} c="green.6">
              Veg:
            </Text>{" "}
            {menu.effective_vegetarian_description || "Kommer snart"}
          </Text>
        </Stack>
      ) : (
        <Text size="xs" mb="sm" lineClamp={2}>
          {menu.effective_description || "Menu kommer snart"}
        </Text>
      )}

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
