import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
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
  Badge,
  SimpleGrid,
  Box,
  Indicator,
  Select,
} from "@mantine/core"
import { Calendar } from "@mantine/dates"
import {
  IconPlus,
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconMapPin,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import "dayjs/locale/da"

dayjs.locale("da")

import { eventsApi } from "../api/events"
import { forumApi } from "../api/forum"
import type { Event } from "../types"

export default function CalendarPage() {
  const navigate = useNavigate()
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  // Filter
  const [subgroupFilter, setSubgroupFilter] = useState<string | null>(null)

  // Date range for queries
  const startDate = dayjs(selectedMonth)
    .startOf("month")
    .subtract(7, "day")
    .toISOString()
  const endDate = dayjs(selectedMonth)
    .endOf("month")
    .add(7, "day")
    .toISOString()

  // Fetch community events only — private bookings are managed in the bookings page
  const {
    data: events,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["events", startDate, endDate, subgroupFilter],
    queryFn: () =>
      eventsApi.getEvents({
        start: startDate,
        end: endDate,
        visibility: "community",
        subgroup: subgroupFilter ? Number(subgroupFilter) : undefined,
      }),
  })

  // Fetch subgroups for filter dropdown
  const { data: subgroups } = useQuery({
    queryKey: ["subgroups"],
    queryFn: () => forumApi.getSubgroups(),
  })

  // Group events by date for calendar indicators (includes all days of multi-day events)
  const eventsByDate = useMemo(() => {
    const map: Record<string, Event[]> = {}
    events?.forEach((event) => {
      let current = dayjs(event.start_datetime).startOf("day")
      const end = dayjs(event.end_datetime).startOf("day")
      while (!current.isAfter(end)) {
        const dateKey = current.format("YYYY-MM-DD")
        if (!map[dateKey]) map[dateKey] = []
        map[dateKey].push(event)
        current = current.add(1, "day")
      }
    })
    return map
  }, [events])

  // Events for the selected date or current month
  const displayEvents = useMemo(() => {
    if (selectedDate) {
      return events?.filter((event) =>
        dayjs(event.start_datetime).isSame(dayjs(selectedDate), "day"),
      )
    }
    return events
      ?.filter((event) => {
        const eventDate = dayjs(event.start_datetime)
        return (
          eventDate.month() === dayjs(selectedMonth).month() &&
          eventDate.year() === dayjs(selectedMonth).year()
        )
      })
      .sort(
        (a, b) =>
          new Date(a.start_datetime).getTime() -
          new Date(b.start_datetime).getTime(),
      )
  }, [events, selectedDate, selectedMonth])

  const goToPrevMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).subtract(1, "month").toDate())
  }

  const goToNextMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).add(1, "month").toDate())
  }

  const goToToday = () => {
    setSelectedMonth(new Date())
  }

  const subgroupOptions = (subgroups || []).map((s) => ({
    value: String(s.id),
    label: s.name,
  }))

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse begivenheder. Prøv igen.</Text>
      </Center>
    )
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Kalender</Title>
          <Text c="dimmed">Fællesskabsbegivenheder og aktiviteter</Text>
        </div>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => navigate("/kalender/opret")}
        >
          Ny begivenhed
        </Button>
      </Group>

      {/* Subgroup filter */}
      <Group gap="sm" mb="md">
        <Select
          placeholder="Filtrer efter gruppe"
          data={subgroupOptions}
          value={subgroupFilter}
          onChange={setSubgroupFilter}
          clearable
          size="xs"
          w={200}
        />
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Calendar */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ActionIcon variant="subtle" onClick={goToPrevMonth}>
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text fw={500}>{dayjs(selectedMonth).format("MMMM YYYY")}</Text>
              <ActionIcon variant="subtle" onClick={goToNextMonth}>
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
            <Button variant="subtle" size="xs" onClick={goToToday}>
              I dag
            </Button>
          </Group>

          {isLoading ? (
            <Center h={300}>
              <Loader size="lg" />
            </Center>
          ) : (
            <Calendar
              date={selectedMonth}
              onDateChange={(date) => setSelectedMonth(new Date(date))}
              size="md"
              getDayProps={(date) => ({
                onClick: () => setSelectedDate(new Date(date)),
                style:
                  selectedDate && dayjs(date).isSame(dayjs(selectedDate), "day")
                    ? {
                        backgroundColor: "var(--mantine-color-blue-filled)",
                        color: "white",
                        borderRadius: "var(--mantine-radius-default)",
                      }
                    : undefined,
              })}
              renderDay={(date) => {
                const dateValue = new Date(date)
                const dateKey = dayjs(dateValue).format("YYYY-MM-DD")
                const dayEvents = eventsByDate[dateKey]
                const day = dateValue.getDate()
                return (
                  <Indicator
                    size={6}
                    color="blue"
                    offset={-2}
                    disabled={!dayEvents?.length}
                    zIndex={1}
                  >
                    <div>{day}</div>
                  </Indicator>
                )
              }}
            />
          )}
        </Paper>

        {/* Events List */}
        <Paper withBorder p="md" radius="md">
          {selectedDate ? (
            <>
              <Group justify="space-between" mb="md">
                <Text fw={500}>
                  {dayjs(selectedDate).format("ddd D. MMMM YYYY")}
                </Text>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setSelectedDate(null)}
                >
                  Vis hele måneden
                </Button>
              </Group>

              {isLoading ? (
                <Center h={200}>
                  <Loader size="md" />
                </Center>
              ) : displayEvents?.length ? (
                <Stack gap="sm">
                  {displayEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </Stack>
              ) : (
                <Center h={100}>
                  <Text c="dimmed">Ingen begivenheder på denne dato.</Text>
                </Center>
              )}

              <Button
                leftSection={<IconPlus size={16} />}
                variant="light"
                fullWidth
                mt="md"
                onClick={() =>
                  navigate(
                    `/kalender/opret?date=${dayjs(selectedDate).format("YYYY-MM-DD")}`,
                  )
                }
              >
                Opret begivenhed d. {dayjs(selectedDate).format("D. MMMM")}
              </Button>
            </>
          ) : (
            <>
              <Text fw={500} mb="md">
                Begivenheder i {dayjs(selectedMonth).format("MMMM YYYY")}
              </Text>

              {isLoading ? (
                <Center h={200}>
                  <Loader size="md" />
                </Center>
              ) : displayEvents?.length === 0 ? (
                <Center h={200}>
                  <Stack align="center" gap="xs">
                    <IconCalendarEvent size={48} color="gray" />
                    <Text c="dimmed">Ingen begivenheder denne måned.</Text>
                    <Button onClick={() => navigate("/kalender/opret")} mt="sm">
                      Opret begivenhed
                    </Button>
                  </Stack>
                </Center>
              ) : (
                <Stack gap="sm">
                  {displayEvents?.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </Stack>
              )}
            </>
          )}
        </Paper>
      </SimpleGrid>
    </>
  )
}

function EventCard({ event }: { event: Event }) {
  const navigate = useNavigate()
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), "day")
  const isPast = dayjs(event.end_datetime).isBefore(dayjs())

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      style={{ opacity: isPast ? 0.6 : 1, cursor: "pointer" }}
      onClick={() => navigate(`/kalender/${event.id}`)}
    >
      <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
        <Box
          style={{
            width: 4,
            alignSelf: "stretch",
            borderRadius: 2,
            backgroundColor: event.room?.color
              ? event.room.color
              : isToday
                ? "var(--mantine-color-blue-6)"
                : event.visibility === "private"
                  ? "var(--mantine-color-gray-4)"
                  : "var(--mantine-color-blue-4)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text fw={500} truncate>
              {event.title}
            </Text>
            {isToday && (
              <Badge size="xs" color="blue">
                I dag
              </Badge>
            )}
            {event.visibility === "private" && (
              <Badge size="xs" variant="light" color="gray">
                Privat
              </Badge>
            )}
            {event.rsvp_enabled && event.rsvp_summary && (
              <Badge size="xs" variant="light" color="grape">
                {event.rsvp_summary.attending} deltager
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {`${dayjs(event.start_datetime).format("ddd, MMM D")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("HH:mm")}`}
          </Text>
          {(event.room || event.location) && (
            <Group gap={4} mt={4}>
              <IconMapPin size={14} color="gray" />
              <Text size="sm" c="dimmed" truncate>
                {[event.room?.name, event.location].filter(Boolean).join(", ")}
              </Text>
            </Group>
          )}
          <Group gap="xs" mt={4}>
            <Avatar
              src={event.created_by.profile_picture}
              size="xs"
              radius="xl"
            >
              {event.created_by.first_name?.[0]}
            </Avatar>
            <Text size="xs" c="dimmed">
              {event.created_by.first_name} {event.created_by.last_name}
            </Text>
          </Group>
        </div>
      </Group>
    </Paper>
  )
}
