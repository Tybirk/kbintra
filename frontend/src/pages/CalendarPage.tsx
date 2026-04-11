import { useState, useMemo, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import {
  Title,
  Text,
  Group,
  Button,
  Loader,
  Center,
  Select,
  ActionIcon,
  SegmentedControl,
  Stack,
  Paper,
  Badge,
  Divider,
} from "@mantine/core"
import { Schedule } from "@mantine/schedule"
import type { ScheduleEventData, ScheduleViewLevel } from "@mantine/schedule"
import {
  IconPlus,
  IconMapPin,
  IconChevronLeft,
  IconChevronRight,
  IconCalendar,
  IconList,
  IconClock,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { eventsApi } from "../api/events"
import { forumApi } from "../api/forum"
import { LocationText } from "../components/LocationText"
import {
  eventToScheduleData,
  DA_SCHEDULE_LABELS,
} from "../utils/scheduleHelpers"
import type { Event } from "../types"

type DisplayMode = "calendar" | "list"

interface GroupedDay {
  date: string
  events: Event[]
}

function groupEventsByDay(
  events: Event[],
  monthStart: dayjs.Dayjs,
): GroupedDay[] {
  const monthEnd = monthStart.endOf("month")
  const filtered = events.filter((e) => {
    const start = dayjs(e.start_datetime)
    return (
      start.isBefore(monthEnd.add(1, "day").startOf("day")) &&
      dayjs(e.end_datetime).isAfter(monthStart.startOf("day"))
    )
  })

  const byDay: Record<string, Event[]> = {}
  for (const ev of filtered) {
    const day = dayjs(ev.start_datetime).format("YYYY-MM-DD")
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(ev)
  }

  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, evs]) => ({ date, events: evs }))
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const [subgroupFilter, setSubgroupFilter] = useState<string | null>(null)
  const [currentDate, setCurrentDate] = useState(dayjs().format("YYYY-MM-DD"))
  const [currentView, setCurrentView] = useState<ScheduleViewLevel>("month")
  const [displayMode, setDisplayMode] = useState<DisplayMode>("calendar")

  const listMonthStart = dayjs(currentDate).startOf("month")

  // Calendar mode: wide date range for smooth navigation
  const calendarStartDate = dayjs(currentDate)
    .subtract(2, "month")
    .startOf("month")
    .toISOString()
  const calendarEndDate = dayjs(currentDate)
    .add(2, "month")
    .endOf("month")
    .toISOString()

  // List mode: only current month
  const listStartDate = listMonthStart.toISOString()
  const listEndDate = listMonthStart.endOf("month").toISOString()

  const startDate = displayMode === "list" ? listStartDate : calendarStartDate
  const endDate = displayMode === "list" ? listEndDate : calendarEndDate

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
    placeholderData: keepPreviousData,
  })

  const { data: subgroups } = useQuery({
    queryKey: ["subgroups"],
    queryFn: () => forumApi.getSubgroups(),
  })

  const scheduleEvents = useMemo(
    () => (events || []).map(eventToScheduleData),
    [events],
  )

  const groupedDays = useMemo(
    () => groupEventsByDay(events || [], listMonthStart),
    [events, listMonthStart],
  )

  const handleEventClick = useCallback(
    (event: ScheduleEventData) => {
      const payload = event.payload as { event: Event } | undefined
      if (payload?.event) {
        navigate(`/kalender/${payload.event.slug}`)
      }
    },
    [navigate],
  )

  const handleTimeSlotClick = useCallback(
    (slotStart: string) => {
      const date = dayjs(slotStart).format("YYYY-MM-DD")
      const time = dayjs(slotStart).format("HH:mm")
      navigate(`/kalender/opret?date=${date}&time=${time}`)
    },
    [navigate],
  )

  const handleDayClick = useCallback((date: string) => {
    setCurrentDate(date)
    setCurrentView("day")
  }, [])

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return
      const deltaX = e.changedTouches[0].clientX - touchStartX.current
      const deltaY = e.changedTouches[0].clientY - touchStartY.current
      touchStartX.current = null
      touchStartY.current = null
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        setCurrentDate(
          dayjs(currentDate)
            .add(deltaX < 0 ? 1 : -1, "month")
            .format("YYYY-MM-DD"),
        )
      }
    },
    [currentDate],
  )

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

      <Group gap="sm" mb="md" justify="space-between">
        <Select
          placeholder="Filtrer efter gruppe"
          data={subgroupOptions}
          value={subgroupFilter}
          onChange={setSubgroupFilter}
          clearable
          size="xs"
          w={200}
        />
        <SegmentedControl
          size="xs"
          value={displayMode}
          onChange={(v) => setDisplayMode(v as DisplayMode)}
          data={[
            {
              value: "calendar",
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconCalendar size={14} />
                  <span>Kalender</span>
                </Group>
              ),
            },
            {
              value: "list",
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconList size={14} />
                  <span>Liste</span>
                </Group>
              ),
            },
          ]}
        />
      </Group>

      {displayMode === "list" ? (
        <Stack
          gap="md"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <Group justify="space-between" align="center">
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label="Forrige måned"
              onClick={() =>
                setCurrentDate(
                  dayjs(currentDate).subtract(1, "month").format("YYYY-MM-DD"),
                )
              }
            >
              <IconChevronLeft size={20} />
            </ActionIcon>
            <Text
              fw={600}
              size="lg"
              tt="capitalize"
              style={{ userSelect: "none" }}
            >
              {listMonthStart.format("MMMM YYYY")}
            </Text>
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label="Næste måned"
              onClick={() =>
                setCurrentDate(
                  dayjs(currentDate).add(1, "month").format("YYYY-MM-DD"),
                )
              }
            >
              <IconChevronRight size={20} />
            </ActionIcon>
          </Group>

          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : groupedDays.length === 0 ? (
            <Center h={200}>
              <Text c="dimmed">Ingen begivenheder denne måned</Text>
            </Center>
          ) : (
            <Stack gap="xs">
              {groupedDays.map(({ date, events: dayEvents }, idx) => (
                <div key={date}>
                  <Text size="sm" fw={600} c="dimmed" tt="capitalize" mb="xs">
                    {dayjs(date).format("dddd D. MMMM")}
                  </Text>
                  <Stack gap="xs">
                    {dayEvents.map((ev) => (
                      <Paper
                        key={ev.id}
                        withBorder
                        p="sm"
                        radius="md"
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/kalender/${ev.slug}`)}
                      >
                        <Stack gap={6}>
                          <Group
                            justify="space-between"
                            wrap="nowrap"
                            align="flex-start"
                          >
                            <Text
                              fw={600}
                              size="md"
                              lineClamp={2}
                              td={ev.is_cancelled ? "line-through" : undefined}
                              c={ev.is_cancelled ? "dimmed" : undefined}
                              style={{ minWidth: 0, flex: 1 }}
                            >
                              {ev.title}
                            </Text>
                            {ev.is_cancelled && (
                              <Badge
                                color="red"
                                size="xs"
                                variant="light"
                                style={{ flexShrink: 0 }}
                              >
                                Aflyst
                              </Badge>
                            )}
                          </Group>
                          <Group gap={4} wrap="nowrap">
                            <IconClock
                              size={14}
                              color="var(--mantine-color-dimmed)"
                              style={{ flexShrink: 0 }}
                            />
                            <Text size="sm" c="dimmed">
                              {dayjs(ev.start_datetime).format("HH:mm")}
                              {" – "}
                              {dayjs(ev.end_datetime).isSame(
                                dayjs(ev.start_datetime),
                                "day",
                              )
                                ? dayjs(ev.end_datetime).format("HH:mm")
                                : dayjs(ev.end_datetime).format("D. MMM HH:mm")}
                            </Text>
                          </Group>
                          {ev.resolved_location && (
                            <Group gap={4} wrap="nowrap">
                              <IconMapPin
                                size={14}
                                color="var(--mantine-color-dimmed)"
                                style={{ flexShrink: 0 }}
                              />
                              <LocationText
                                location={ev.resolved_location}
                                size="sm"
                                c="dimmed"
                                lineClamp={1}
                              />
                            </Group>
                          )}
                          {(ev.subgroup ||
                            (ev.rsvp_enabled && ev.rsvp_summary)) && (
                            <Group gap="xs">
                              {ev.subgroup && (
                                <Badge color="blue" size="xs" variant="light">
                                  {ev.subgroup.name}
                                </Badge>
                              )}
                              {ev.rsvp_enabled && ev.rsvp_summary && (
                                <Badge color="green" size="xs" variant="light">
                                  {ev.rsvp_summary.attending} deltager
                                </Badge>
                              )}
                            </Group>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                  {idx < groupedDays.length - 1 && <Divider mt="sm" />}
                </div>
              ))}
            </Stack>
          )}
        </Stack>
      ) : (
        <>
          {isLoading && (
            <Center h={400}>
              <Loader size="lg" />
            </Center>
          )}
          {!isLoading && (
            <div className="schedule-wrapper">
              <Schedule
                events={scheduleEvents}
                view={currentView}
                onViewChange={setCurrentView}
                date={currentDate}
                onDateChange={setCurrentDate}
                locale="da"
                labels={DA_SCHEDULE_LABELS}
                layout="responsive"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onEventClick={handleEventClick}
                // Workaround: @mantine/schedule alpha doesn't destructure onTimeSlotClick
                // in MonthView/YearView, leaking it to the DOM. Remove conditional when stable.
                onTimeSlotClick={
                  currentView === "day" || currentView === "week"
                    ? handleTimeSlotClick
                    : undefined
                }
                onDayClick={handleDayClick}
                renderEventBody={(event) => {
                  const payload = event.payload as { event: Event } | undefined
                  const ev = payload?.event
                  return (
                    <div>
                      <Text size="xs" fw={500} lineClamp={1}>
                        {event.title}
                      </Text>
                      {ev?.resolved_location && (
                        <Group gap={2} wrap="nowrap">
                          <IconMapPin size={10} />
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {ev.resolved_location}
                          </Text>
                        </Group>
                      )}
                      {ev?.rsvp_enabled && ev.rsvp_summary && (
                        <Text size="xs" c="dimmed">
                          {ev.rsvp_summary.attending} deltager
                        </Text>
                      )}
                    </div>
                  )
                }}
                weekViewProps={{
                  firstDayOfWeek: 1,
                  withWeekNumber: true,
                  withCurrentTimeIndicator: true,
                  highlightToday: true,
                  intervalMinutes: 60,
                  weekLabelFormat: "D. MMM",
                }}
                monthViewProps={{
                  firstDayOfWeek: 1,
                  withWeekNumbers: true,
                  monthYearSelectProps: { labels: DA_SCHEDULE_LABELS },
                }}
                yearViewProps={{
                  monthYearSelectProps: { labels: DA_SCHEDULE_LABELS },
                }}
                mobileMonthViewProps={{
                  firstDayOfWeek: 1,
                  noEventsText: "Ingen begivenheder",
                  renderHeader: () => (
                    <Group justify="space-between" align="center" w="100%">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Forrige måned"
                        onClick={() =>
                          setCurrentDate(
                            dayjs(currentDate)
                              .subtract(1, "month")
                              .format("YYYY-MM-DD"),
                          )
                        }
                      >
                        <IconChevronLeft
                          size={18}
                          style={{ display: "block" }}
                        />
                      </ActionIcon>
                      <Text
                        fw={600}
                        tt="capitalize"
                        style={{ userSelect: "none" }}
                      >
                        {dayjs(currentDate).format("MMMM YYYY")}
                      </Text>
                      <ActionIcon
                        variant="subtle"
                        aria-label="Næste måned"
                        onClick={() =>
                          setCurrentDate(
                            dayjs(currentDate)
                              .add(1, "month")
                              .format("YYYY-MM-DD"),
                          )
                        }
                      >
                        <IconChevronRight
                          size={18}
                          style={{ display: "block" }}
                        />
                      </ActionIcon>
                    </Group>
                  ),
                }}
                dayViewProps={{
                  withCurrentTimeIndicator: true,
                  intervalMinutes: 30,
                  headerFormat: "ddd D. MMM YYYY",
                }}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
