import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
  TextInput,
  Textarea,
  Modal,
  ActionIcon,
  Menu,
  Badge,
  Switch,
  SimpleGrid,
  Box,
  Indicator,
} from "@mantine/core"
import { Calendar, DateInput, TimePicker } from "@mantine/dates"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconPlus,
  IconCalendarEvent,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconMapPin,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { calendarApi } from "../api/calendar"
import type { CalendarEvent, CreateEventData } from "../types"

const TIME_PRESETS = [
  {
    label: "Morgen",
    values: [
      "06:00",
      "06:30",
      "07:00",
      "07:30",
      "08:00",
      "08:30",
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ],
  },
  {
    label: "Eftermiddag",
    values: [
      "12:00",
      "12:30",
      "13:00",
      "13:30",
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
    ],
  },
  {
    label: "Aften",
    values: [
      "18:00",
      "18:30",
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
      "22:00",
      "22:30",
      "23:00",
      "23:30",
    ],
  },
]

function addOneHour(time: string): string {
  const [hours, minutes] = time.split(":").map(Number)
  const newHours = Math.min(hours + 1, 23)
  return `${newHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}

export default function CalendarPage() {
  const queryClient = useQueryClient()
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [createInitialDate, setCreateInitialDate] = useState<Date | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)
  const [eventToDelete, setEventToDelete] = useState<number | null>(null)

  // Fetch events for current month (with buffer)
  const startDate = dayjs(selectedMonth)
    .startOf("month")
    .subtract(7, "day")
    .toISOString()
  const endDate = dayjs(selectedMonth)
    .endOf("month")
    .add(7, "day")
    .toISOString()

  const {
    data: events,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["calendar", "events", startDate, endDate],
    queryFn: () => calendarApi.getEvents(startDate, endDate),
  })

  const deleteMutation = useMutation({
    mutationFn: calendarApi.deleteEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] })
      closeDeleteModal()
      setEventToDelete(null)
      notifications.show({
        title: "Begivenhed slettet",
        message: "Begivenheden er blevet slettet.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette begivenhed. Prøv igen.",
        color: "red",
      })
    },
  })

  // Group events by date for the calendar indicator
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    events?.forEach((event) => {
      const dateKey = dayjs(event.start_datetime).format("YYYY-MM-DD")
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(event)
    })
    return map
  }, [events])

  // Events for the current month (displayed in list)
  const monthEvents = useMemo(() => {
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
  }, [events, selectedMonth])

  const handleDeleteClick = (id: number) => {
    setEventToDelete(id)
    openDeleteModal()
  }

  const handleConfirmDelete = () => {
    if (eventToDelete) {
      deleteMutation.mutate(eventToDelete)
    }
  }

  const goToPrevMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).subtract(1, "month").toDate())
  }

  const goToNextMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).add(1, "month").toDate())
  }

  const goToToday = () => {
    setSelectedMonth(new Date())
  }

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
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Ny begivenhed
        </Button>
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
              ) : (
                <>
                  {(() => {
                    const dateEvents = events?.filter((event) =>
                      dayjs(event.start_datetime).isSame(
                        dayjs(selectedDate),
                        "day",
                      ),
                    )
                    return dateEvents?.length ? (
                      <Stack gap="sm">
                        {dateEvents.map((event) => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onEdit={() => setEditingEvent(event)}
                            onDelete={() => handleDeleteClick(event.id)}
                          />
                        ))}
                      </Stack>
                    ) : (
                      <Center h={100}>
                        <Text c="dimmed">
                          Ingen begivenheder på denne dato.
                        </Text>
                      </Center>
                    )
                  })()}
                  <Button
                    leftSection={<IconPlus size={16} />}
                    variant="light"
                    fullWidth
                    mt="md"
                    onClick={() => {
                      setCreateInitialDate(selectedDate)
                      openCreateModal()
                    }}
                  >
                    Opret begivenhed d. {dayjs(selectedDate).format("D. MMMM")}
                  </Button>
                </>
              )}
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
              ) : monthEvents?.length === 0 ? (
                <Center h={200}>
                  <Stack align="center" gap="xs">
                    <IconCalendarEvent size={48} color="gray" />
                    <Text c="dimmed">Ingen begivenheder denne måned.</Text>
                    <Button onClick={openCreateModal} mt="sm">
                      Opret begivenhed
                    </Button>
                  </Stack>
                </Center>
              ) : (
                <Stack gap="sm">
                  {monthEvents?.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onEdit={() => setEditingEvent(event)}
                      onDelete={() => handleDeleteClick(event.id)}
                    />
                  ))}
                </Stack>
              )}
            </>
          )}
        </Paper>
      </SimpleGrid>

      <CreateEventModal
        opened={createModalOpened}
        onClose={() => {
          setCreateInitialDate(null)
          closeCreateModal()
        }}
        initialDate={createInitialDate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar"] })
          setCreateInitialDate(null)
          closeCreateModal()
        }}
      />

      {editingEvent && (
        <EditEventModal
          opened={!!editingEvent}
          onClose={() => setEditingEvent(null)}
          event={editingEvent}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["calendar"] })
            setEditingEvent(null)
          }}
        />
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Slet begivenhed"
        centered
      >
        <Text mb="lg">
          Er du sikker på, at du vil slette denne begivenhed? Denne handling kan
          ikke fortrydes.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deleteMutation.isPending}
          >
            Slet
          </Button>
        </Group>
      </Modal>
    </>
  )
}

interface EventCardProps {
  event: CalendarEvent
  onEdit: () => void
  onDelete: () => void
}

function EventCard({ event, onEdit, onDelete }: EventCardProps) {
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), "day")
  const isPast = dayjs(event.end_datetime).isBefore(dayjs())

  return (
    <Paper withBorder p="sm" radius="md" style={{ opacity: isPast ? 0.6 : 1 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
          <Box
            style={{
              width: 4,
              alignSelf: "stretch",
              borderRadius: 2,
              backgroundColor: isToday
                ? "var(--mantine-color-blue-6)"
                : "var(--mantine-color-gray-4)",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={4}>
              <Text fw={500} truncate>
                {event.title}
              </Text>
              {event.is_all_day && (
                <Badge size="xs" variant="light">
                  Hele dagen
                </Badge>
              )}
              {isToday && (
                <Badge size="xs" color="blue">
                  I dag
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {event.is_all_day
                ? dayjs(event.start_datetime).format("ddd, MMM D")
                : `${dayjs(event.start_datetime).format("ddd, MMM D")} at ${dayjs(event.start_datetime).format("HH:mm")} - ${dayjs(event.end_datetime).format("HH:mm")}`}
            </Text>
            {event.location && (
              <Group gap={4} mt={4}>
                <IconMapPin size={14} color="gray" />
                <Text size="sm" c="dimmed" truncate>
                  {event.location}
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

        {event.is_own && (
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <ActionIcon variant="subtle">
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                Rediger
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={onDelete}
              >
                Slet
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Paper>
  )
}

interface CreateEventModalProps {
  opened: boolean
  onClose: () => void
  onSuccess: () => void
  initialDate?: Date | null
}

function CreateEventModal({
  opened,
  onClose,
  onSuccess,
  initialDate,
}: CreateEventModalProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [isAllDay, setIsAllDay] = useState(false)
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState("")
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [endTime, setEndTime] = useState("")

  // Pre-fill start/end from initialDate when modal opens
  useEffect(() => {
    if (opened && initialDate) {
      setStartDate(initialDate)
      setEndDate(initialDate)
      setStartTime("12:00")
      setEndTime("13:00")
    }
  }, [opened, initialDate])

  // Compute combined datetimes
  const startDatetime = useMemo(() => {
    if (!startDate || !startTime) return null
    const [hours, minutes] = startTime.split(":").map(Number)
    return dayjs(startDate).hour(hours).minute(minutes).second(0).toDate()
  }, [startDate, startTime])

  const endDatetime = useMemo(() => {
    if (!endDate || !endTime) return null
    const [hours, minutes] = endTime.split(":").map(Number)
    return dayjs(endDate).hour(hours).minute(minutes).second(0).toDate()
  }, [endDate, endTime])

  const handleStartDateChange = (value: string | null) => {
    const newDate = value ? new Date(value) : null
    setStartDate(newDate)
    if (newDate && !endDate) {
      setEndDate(newDate)
    }
  }

  const handleStartTimeChange = (value: string) => {
    setStartTime(value)
    if (value && (!endTime || endTime <= value)) {
      setEndTime(addOneHour(value))
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateEventData) => calendarApi.createEvent(data),
    onSuccess: () => {
      notifications.show({
        title: "Begivenhed oprettet",
        message: "Din begivenhed er blevet tilføjet til kalenderen.",
        color: "green",
      })
      resetForm()
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette begivenhed. Prøv igen.",
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setTitle("")
    setDescription("")
    setLocation("")
    setIsAllDay(false)
    setStartDate(null)
    setStartTime("")
    setEndDate(null)
    setEndTime("")
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDatetime || !endDatetime) return

    createMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      is_all_day: isAllDay,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    })
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Opret begivenhed"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Titel"
            placeholder="Begivenhedstitel"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Beskrivelse"
            placeholder="Beskrivelse (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <TextInput
            label="Sted"
            placeholder="Sted (valgfrit)"
            leftSection={<IconMapPin size={16} />}
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />

          <Switch
            label="Hele dagen"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.currentTarget.checked)}
          />

          <Group grow>
            <DateInput
              label="Startdato"
              placeholder="Vælg dato"
              value={startDate}
              onChange={handleStartDateChange}
              required
            />
            <TimePicker
              label="Starttid"
              description="Skriv eller vælg tid"
              value={startTime}
              onChange={handleStartTimeChange}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>

          <Group grow>
            <DateInput
              label="Slutdato"
              placeholder="Vælg dato"
              value={endDate}
              onChange={(value) => setEndDate(value ? new Date(value) : null)}
              minDate={startDate || undefined}
              required
            />
            <TimePicker
              label="Sluttid"
              description="Skriv eller vælg tid"
              value={endTime}
              onChange={(value) => setEndTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>

          <Group justify="flex-end">
            <Button variant="light" onClick={handleClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!title.trim() || !startDatetime || !endDatetime}
            >
              Opret begivenhed
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface EditEventModalProps {
  opened: boolean
  onClose: () => void
  event: CalendarEvent
  onSuccess: () => void
}

function EditEventModal({
  opened,
  onClose,
  event,
  onSuccess,
}: EditEventModalProps) {
  const [title, setTitle] = useState(event.title)
  const [description, setDescription] = useState(event.description)
  const [location, setLocation] = useState(event.location)
  const [isAllDay, setIsAllDay] = useState(event.is_all_day)
  const [startDate, setStartDate] = useState<Date | null>(
    new Date(event.start_datetime),
  )
  const [startTime, setStartTime] = useState(
    dayjs(event.start_datetime).format("HH:mm"),
  )
  const [endDate, setEndDate] = useState<Date | null>(
    new Date(event.end_datetime),
  )
  const [endTime, setEndTime] = useState(
    dayjs(event.end_datetime).format("HH:mm"),
  )

  const startDatetime = useMemo(() => {
    if (!startDate || !startTime) return null
    const [hours, minutes] = startTime.split(":").map(Number)
    return dayjs(startDate).hour(hours).minute(minutes).second(0).toDate()
  }, [startDate, startTime])

  const endDatetime = useMemo(() => {
    if (!endDate || !endTime) return null
    const [hours, minutes] = endTime.split(":").map(Number)
    return dayjs(endDate).hour(hours).minute(minutes).second(0).toDate()
  }, [endDate, endTime])

  const updateMutation = useMutation({
    mutationFn: (data: CreateEventData) =>
      calendarApi.updateEvent(event.id, data),
    onSuccess: () => {
      notifications.show({
        title: "Begivenhed opdateret",
        message: "Din begivenhed er blevet opdateret.",
        color: "green",
      })
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere begivenhed. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDatetime || !endDatetime) return

    updateMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      is_all_day: isAllDay,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    })
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Rediger begivenhed"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Titel"
            placeholder="Begivenhedstitel"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Beskrivelse"
            placeholder="Beskrivelse (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <TextInput
            label="Sted"
            placeholder="Sted (valgfrit)"
            leftSection={<IconMapPin size={16} />}
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />

          <Switch
            label="Hele dagen"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.currentTarget.checked)}
          />

          <Group grow>
            <DateInput
              label="Startdato"
              placeholder="Vælg dato"
              value={startDate}
              onChange={(value) => setStartDate(value ? new Date(value) : null)}
              required
            />
            <TimePicker
              label="Starttid"
              description="Skriv eller vælg tid"
              value={startTime}
              onChange={(value) => setStartTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>

          <Group grow>
            <DateInput
              label="Slutdato"
              placeholder="Vælg dato"
              value={endDate}
              onChange={(value) => setEndDate(value ? new Date(value) : null)}
              minDate={startDate || undefined}
              required
            />
            <TimePicker
              label="Sluttid"
              description="Skriv eller vælg tid"
              value={endTime}
              onChange={(value) => setEndTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>

          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={!title.trim() || !startDatetime || !endDatetime}
            >
              Gem ændringer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
