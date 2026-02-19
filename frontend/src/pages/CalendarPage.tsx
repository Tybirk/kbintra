import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Title,
  Text,
  Group,
  Button,
  Loader,
  Center,
  Select,
} from "@mantine/core"
import { Schedule } from "@mantine/schedule"
import type { ScheduleEventData, ScheduleViewLevel } from "@mantine/schedule"
import { IconPlus, IconMapPin } from "@tabler/icons-react"
import dayjs from "dayjs"
import "dayjs/locale/da"

dayjs.locale("da")

import { eventsApi } from "../api/events"
import { forumApi } from "../api/forum"
import {
  eventToScheduleData,
  DA_SCHEDULE_LABELS,
} from "../utils/scheduleHelpers"
import type { Event } from "../types"

export default function CalendarPage() {
  const navigate = useNavigate()
  const [subgroupFilter, setSubgroupFilter] = useState<string | null>(null)
  const [currentDate, setCurrentDate] = useState(dayjs().format("YYYY-MM-DD"))
  const [currentView, setCurrentView] = useState<ScheduleViewLevel>("month")

  // Wide date range for schedule views
  const startDate = dayjs(currentDate)
    .subtract(2, "month")
    .startOf("month")
    .toISOString()
  const endDate = dayjs(currentDate)
    .add(2, "month")
    .endOf("month")
    .toISOString()

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

  const { data: subgroups } = useQuery({
    queryKey: ["subgroups"],
    queryFn: () => forumApi.getSubgroups(),
  })

  const scheduleEvents = useMemo(
    () => (events || []).map(eventToScheduleData),
    [events],
  )

  const handleEventClick = useCallback(
    (event: ScheduleEventData) => {
      const payload = event.payload as { event: Event } | undefined
      if (payload?.event) {
        navigate(`/kalender/${payload.event.id}`)
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

  if (isLoading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
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

      <Schedule
        events={scheduleEvents}
        view={currentView}
        onViewChange={setCurrentView}
        date={currentDate}
        onDateChange={setCurrentDate}
        locale="da"
        labels={DA_SCHEDULE_LABELS}
        layout="responsive"
        onEventClick={handleEventClick}
        onTimeSlotClick={handleTimeSlotClick}
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
          intervalMinutes: 60,
        }}
        monthViewProps={{
          firstDayOfWeek: 1,
          withWeekNumbers: true,
        }}
        dayViewProps={{
          withCurrentTimeIndicator: true,
          intervalMinutes: 30,
        }}
      />
    </>
  )
}
