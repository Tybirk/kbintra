import { useState, useMemo } from "react"
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
  TextInput,
  Textarea,
  Modal,
  ActionIcon,
  Menu,
  Badge,
  Box,
  Select,
  Alert,
  Tabs,
  NumberInput,
  ColorInput,
  MultiSelect,
  Tooltip,
  ScrollArea,
} from "@mantine/core"
import { Calendar, DateInput, TimePicker } from "@mantine/dates"
import { useDisclosure, useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconPlus,
  IconCalendarEvent,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
  IconAlertCircle,
  IconRepeat,
  IconSettings,
  IconClick,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { bookingsApi } from "../api/bookings"
import { useAuthStore } from "../store/authStore"
import type {
  Room,
  CalendarBooking,
  CreateBookingData,
  CreateRecurringBookingData,
} from "../types"

const DAYS_OF_WEEK = [
  { value: "0", label: "Mandag" },
  { value: "1", label: "Tirsdag" },
  { value: "2", label: "Onsdag" },
  { value: "3", label: "Torsdag" },
  { value: "4", label: "Fredag" },
  { value: "5", label: "Lørdag" },
  { value: "6", label: "Søndag" },
]

// Helper to extract error messages from Django REST Framework responses
function extractErrorMessage(error: any, fallback: string): string {
  const data = error?.response?.data
  if (!data) return fallback

  // Check for detail (common for permission/auth errors)
  if (typeof data.detail === "string") return data.detail

  // Check for non_field_errors
  if (
    Array.isArray(data.non_field_errors) &&
    data.non_field_errors.length > 0
  ) {
    return data.non_field_errors.join(" ")
  }

  // Check for field-specific errors (e.g., start_datetime, end_datetime, title)
  const fieldErrors: string[] = []
  for (const key of Object.keys(data)) {
    if (key === "non_field_errors" || key === "detail") continue
    const value = data[key]
    if (Array.isArray(value)) {
      fieldErrors.push(...value)
    } else if (typeof value === "string") {
      fieldErrors.push(value)
    }
  }
  if (fieldErrors.length > 0) {
    return fieldErrors.join(" ")
  }

  return fallback
}

const HOURS = Array.from({ length: 25 }, (_, i) => i)

export default function BookingsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isMobile = useMediaQuery("(max-width: 768px)")
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)
  const [editingBooking, setEditingBooking] = useState<CalendarBooking | null>(
    null,
  )
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)
  const [bookingToDelete, setBookingToDelete] = useState<{
    id: string
    isRecurring: boolean
  } | null>(null)
  const [adminModalOpened, { open: openAdminModal, close: closeAdminModal }] =
    useDisclosure(false)
  const [
    detailsModalOpened,
    { open: openDetailsModal, close: closeDetailsModal },
  ] = useDisclosure(false)
  const [selectedBooking, setSelectedBooking] =
    useState<CalendarBooking | null>(null)
  const [initialCreateTime, setInitialCreateTime] = useState<number | null>(
    null,
  )

  // Fetch rooms
  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["bookings", "rooms"],
    queryFn: () => bookingsApi.getRooms(true),
  })

  // Fetch bookings for current month (with buffer)
  const startDate = dayjs(selectedMonth)
    .startOf("month")
    .subtract(7, "day")
    .toISOString()
  const endDate = dayjs(selectedMonth)
    .endOf("month")
    .add(7, "day")
    .toISOString()

  const {
    data: bookings,
    isLoading: bookingsLoading,
    error,
  } = useQuery({
    queryKey: ["bookings", "calendar", startDate, endDate, selectedRoomId],
    queryFn: () =>
      bookingsApi.getCalendarBookings(
        startDate,
        endDate,
        selectedRoomId ? parseInt(selectedRoomId) : undefined,
      ),
    enabled: !roomsLoading,
  })

  const deleteMutation = useMutation({
    mutationFn: async ({
      id,
      isRecurring,
    }: {
      id: string
      isRecurring: boolean
    }) => {
      if (isRecurring) {
        const recurringId = parseInt(id.split("_")[1])
        return bookingsApi.deleteRecurringBooking(recurringId)
      }
      return bookingsApi.deleteBooking(parseInt(id))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] })
      closeDeleteModal()
      setBookingToDelete(null)
      notifications.show({
        title: "Booking slettet",
        message: "Bookingen er blevet slettet.",
        color: "blue",
      })
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke slette booking. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  // Group bookings by date for the calendar indicator
  const bookingsByDate = useMemo(() => {
    const map: Record<string, CalendarBooking[]> = {}
    bookings?.forEach((booking) => {
      const dateKey = dayjs(booking.start_datetime).format("YYYY-MM-DD")
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(booking)
    })
    return map
  }, [bookings])

  // Room color map
  const roomColorMap = useMemo(() => {
    const map: Record<number, string> = {}
    rooms?.forEach((room) => {
      map[room.id] = room.color
    })
    return map
  }, [rooms])

  // Bookings for the selected day (including multi-day bookings that overlap)
  const dayBookings = useMemo(() => {
    if (!selectedDate || !bookings) return []
    const dayStart = dayjs(selectedDate).startOf("day")
    const dayEnd = dayjs(selectedDate).endOf("day")

    // Filter bookings that overlap with the selected day
    return bookings
      .filter((booking) => {
        const bookingStart = dayjs(booking.start_datetime)
        const bookingEnd = dayjs(booking.end_datetime)
        // Booking overlaps if it starts before day ends AND ends after day starts
        return bookingStart.isBefore(dayEnd) && bookingEnd.isAfter(dayStart)
      })
      .sort(
        (a, b) =>
          new Date(a.start_datetime).getTime() -
          new Date(b.start_datetime).getTime(),
      )
  }, [bookings, selectedDate])

  const handleDeleteClick = (id: string, isRecurring: boolean) => {
    setBookingToDelete({ id, isRecurring })
    openDeleteModal()
  }

  const handleConfirmDelete = () => {
    if (bookingToDelete) {
      deleteMutation.mutate(bookingToDelete)
    }
  }

  const handleViewDetails = (booking: CalendarBooking) => {
    setSelectedBooking(booking)
    openDetailsModal()
  }

  const handleCreateAtTime = (hour: number) => {
    setInitialCreateTime(hour)
    openCreateModal()
  }

  const goToPrevMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).subtract(1, "month").toDate())
  }

  const goToNextMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).add(1, "month").toDate())
  }

  const goToToday = () => {
    const today = new Date()
    setSelectedMonth(today)
    setSelectedDate(today)
  }

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
  }

  const isLoading = roomsLoading || bookingsLoading

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse bookinger. Prøv igen.</Text>
      </Center>
    )
  }

  const roomOptions = [
    { value: "", label: "Alle lokaler" },
    ...(rooms?.map((room) => ({ value: String(room.id), label: room.name })) ||
      []),
  ]

  return (
    <>
      <Group justify="space-between" mb="md" wrap="wrap">
        <div>
          <Title order={1}>Booking</Title>
          <Text c="dimmed" size="sm">
            Book lokaler og fællesrum
          </Text>
        </div>
        <Group gap="xs">
          {user?.is_staff && (
            <Button
              variant="light"
              leftSection={<IconSettings size={16} />}
              onClick={openAdminModal}
              size={isMobile ? "xs" : "sm"}
            >
              {isMobile ? "" : "Administrer"}
            </Button>
          )}
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={openCreateModal}
            size={isMobile ? "xs" : "sm"}
          >
            {isMobile ? "Ny" : "Ny booking"}
          </Button>
        </Group>
      </Group>

      <Select
        placeholder="Filtrer efter lokale"
        data={roomOptions}
        value={selectedRoomId || ""}
        onChange={(value) => setSelectedRoomId(value || null)}
        clearable
        mb="md"
        w={isMobile ? "100%" : 250}
      />

      <Box
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: "var(--mantine-spacing-lg)",
        }}
      >
        {/* Calendar */}
        <Paper
          withBorder
          p="md"
          radius="md"
          style={{ flex: isMobile ? "none" : "0 0 auto" }}
        >
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ActionIcon variant="subtle" onClick={goToPrevMonth} size="sm">
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text fw={500} size="sm">
                {dayjs(selectedMonth).format("MMMM YYYY")}
              </Text>
              <ActionIcon variant="subtle" onClick={goToNextMonth} size="sm">
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
              onDateChange={(date) => {
                setSelectedMonth(new Date(date))
              }}
              getDayProps={(date) => ({
                selected: selectedDate
                  ? dayjs(date).isSame(selectedDate, "day")
                  : false,
                onClick: () => handleDateSelect(new Date(date)),
              })}
              size={isMobile ? "sm" : "md"}
              renderDay={(date) => {
                const dateValue = new Date(date)
                const dateKey = dayjs(dateValue).format("YYYY-MM-DD")
                const dayBookingsForDate = bookingsByDate[dateKey]
                const day = dateValue.getDate()

                // Get unique room colors for this day
                const roomColors = [
                  ...new Set(
                    dayBookingsForDate?.map((b) => roomColorMap[b.room.id]) ||
                      [],
                  ),
                ].slice(0, 3)

                return (
                  <Box pos="relative">
                    <div>{day}</div>
                    {roomColors.length > 0 && (
                      <Group gap={2} justify="center" mt={2}>
                        {roomColors.map((color, i) => (
                          <Box
                            key={i}
                            w={5}
                            h={5}
                            style={{
                              borderRadius: "50%",
                              backgroundColor: color,
                            }}
                          />
                        ))}
                      </Group>
                    )}
                  </Box>
                )
              }}
            />
          )}

          {/* Room color legend */}
          {rooms && rooms.length > 0 && (
            <Stack gap="xs" mt="md">
              <Text size="xs" fw={500} c="dimmed">
                Lokaler
              </Text>
              <Group gap="xs">
                {rooms.map((room) => (
                  <Tooltip key={room.id} label={room.name} withArrow>
                    <Box
                      w={16}
                      h={16}
                      style={{
                        borderRadius: 4,
                        backgroundColor: room.color,
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        setSelectedRoomId(
                          selectedRoomId === String(room.id)
                            ? null
                            : String(room.id),
                        )
                      }
                    />
                  </Tooltip>
                ))}
              </Group>
            </Stack>
          )}
        </Paper>

        {/* Day View */}
        <Paper withBorder p="md" radius="md" style={{ flex: 1, minWidth: 0 }}>
          {selectedDate ? (
            <>
              <Group justify="space-between" mb="md">
                <Text fw={500}>
                  {dayjs(selectedDate).format("dddd, D. MMMM YYYY")}
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={openCreateModal}
                >
                  Tilføj
                </Button>
              </Group>

              {isLoading ? (
                <Center h={200}>
                  <Loader size="md" />
                </Center>
              ) : (
                <DayTimeline
                  bookings={dayBookings}
                  rooms={rooms || []}
                  selectedDate={selectedDate}
                  onEdit={setEditingBooking}
                  onDelete={handleDeleteClick}
                  onViewDetails={handleViewDetails}
                  onCreateAtTime={handleCreateAtTime}
                  isAdmin={user?.is_staff || false}
                />
              )}
            </>
          ) : (
            <Center h={isMobile ? 150 : 400}>
              <Stack align="center" gap="xs">
                <IconClick size={48} color="gray" stroke={1.5} />
                <Text c="dimmed" ta="center">
                  Vælg en dato i kalenderen
                  <br />
                  for at se bookinger
                </Text>
              </Stack>
            </Center>
          )}
        </Paper>
      </Box>

      <CreateBookingModal
        opened={createModalOpened}
        onClose={() => {
          closeCreateModal()
          setInitialCreateTime(null)
        }}
        rooms={rooms || []}
        initialDate={selectedDate}
        initialHour={initialCreateTime}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["bookings"] })
          closeCreateModal()
          setInitialCreateTime(null)
        }}
      />

      {editingBooking && !editingBooking.is_recurring && (
        <EditBookingModal
          opened={!!editingBooking}
          onClose={() => setEditingBooking(null)}
          booking={editingBooking}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["bookings"] })
            setEditingBooking(null)
          }}
        />
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Slet booking"
        centered
      >
        <Text mb="lg">
          Er du sikker på, at du vil slette denne booking?
          {bookingToDelete?.isRecurring && (
            <Text c="red" size="sm" mt="xs">
              Dette er en tilbagevendende booking. Sletning vil fjerne alle
              fremtidige forekomster.
            </Text>
          )}
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

      {user?.is_staff && (
        <AdminModal
          opened={adminModalOpened}
          onClose={closeAdminModal}
          rooms={rooms || []}
        />
      )}

      {/* Booking Details Modal */}
      <Modal
        opened={detailsModalOpened}
        onClose={closeDetailsModal}
        title="Booking detaljer"
        centered
      >
        {selectedBooking && (
          <Stack gap="md">
            <Group gap="sm">
              <Box
                w={16}
                h={16}
                style={{
                  borderRadius: 4,
                  backgroundColor: selectedBooking.room.color,
                }}
              />
              <Text fw={500}>{selectedBooking.room.name}</Text>
            </Group>

            <div>
              <Text size="sm" c="dimmed">
                Titel
              </Text>
              <Text fw={500}>{selectedBooking.title}</Text>
            </div>

            {selectedBooking.description && (
              <div>
                <Text size="sm" c="dimmed">
                  Beskrivelse
                </Text>
                <Text>{selectedBooking.description}</Text>
              </div>
            )}

            <div>
              <Text size="sm" c="dimmed">
                Tidspunkt
              </Text>
              <Text>
                {dayjs(selectedBooking.start_datetime).format(
                  "dddd D. MMMM YYYY",
                )}
              </Text>
              <Text fw={500}>
                {dayjs(selectedBooking.start_datetime).format("HH:mm")} -{" "}
                {dayjs(selectedBooking.end_datetime).format("HH:mm")}
              </Text>
            </div>

            <div>
              <Text size="sm" c="dimmed">
                Booket af
              </Text>
              <Text>
                {selectedBooking.user.first_name}{" "}
                {selectedBooking.user.last_name}
              </Text>
            </div>

            {selectedBooking.is_recurring && (
              <Badge leftSection={<IconRepeat size={12} />} variant="light">
                Tilbagevendende booking
              </Badge>
            )}

            <Group justify="flex-end" mt="md">
              {(selectedBooking.is_own ||
                (user?.is_staff && selectedBooking.is_recurring)) && (
                <>
                  {!selectedBooking.is_recurring && (
                    <Button
                      variant="light"
                      leftSection={<IconEdit size={16} />}
                      onClick={() => {
                        closeDetailsModal()
                        setEditingBooking(selectedBooking)
                      }}
                    >
                      Rediger
                    </Button>
                  )}
                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => {
                      closeDetailsModal()
                      handleDeleteClick(
                        selectedBooking.id,
                        selectedBooking.is_recurring,
                      )
                    }}
                  >
                    Slet
                  </Button>
                </>
              )}
              <Button onClick={closeDetailsModal}>Luk</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  )
}

interface DayTimelineProps {
  bookings: CalendarBooking[]
  rooms: Room[]
  selectedDate: Date
  onEdit: (booking: CalendarBooking) => void
  onDelete: (id: string, isRecurring: boolean) => void
  onViewDetails: (booking: CalendarBooking) => void
  onCreateAtTime: (hour: number) => void
  isAdmin: boolean
}

function DayTimeline({
  bookings,
  rooms,
  selectedDate,
  onEdit,
  onDelete,
  onViewDetails,
  onCreateAtTime,
  isAdmin,
}: DayTimelineProps) {
  const isMobile = useMediaQuery("(max-width: 768px)")

  // Group bookings by room for column display - must be before any early returns
  const bookingsByRoom = useMemo(() => {
    const map: Record<number, CalendarBooking[]> = {}
    bookings.forEach((b) => {
      if (!map[b.room.id]) map[b.room.id] = []
      map[b.room.id].push(b)
    })
    return map
  }, [bookings])

  // Calculate positions for bookings on timeline, handling multi-day bookings
  const getBookingPosition = (booking: CalendarBooking) => {
    const bookingStart = dayjs(booking.start_datetime)
    const bookingEnd = dayjs(booking.end_datetime)
    const dayStart = dayjs(selectedDate).startOf("day")
    const dayEnd = dayjs(selectedDate).endOf("day")

    // Determine the visible start/end for this day
    const visibleStart = bookingStart.isBefore(dayStart)
      ? dayStart
      : bookingStart
    const visibleEnd = bookingEnd.isAfter(dayEnd) ? dayEnd : bookingEnd

    const startHour = visibleStart.hour() + visibleStart.minute() / 60
    // If booking extends past midnight, show until 24:00
    const endHour = bookingEnd.isAfter(dayEnd)
      ? 24
      : visibleEnd.hour() + visibleEnd.minute() / 60

    // Flags for visual indicators
    const continuesFromPrevDay = bookingStart.isBefore(dayStart)
    const continuesToNextDay = bookingEnd.isAfter(dayEnd)

    return {
      top: startHour * 40,
      height: Math.max((endHour - startHour) * 40, 20),
      continuesFromPrevDay,
      continuesToNextDay,
    }
  }

  // Handle click on empty slot
  const handleSlotClick = (hour: number, e: React.MouseEvent) => {
    // Only trigger if clicking on empty space, not on a booking
    if ((e.target as HTMLElement).closest("[data-booking]")) return
    onCreateAtTime(hour)
  }

  if (bookings.length === 0) {
    return (
      <ScrollArea h={isMobile ? 400 : 500} offsetScrollbars>
        <Box
          style={{
            position: "relative",
            minHeight: 24 * 40 + 20,
          }}
        >
          {/* Hour labels */}
          <Box style={{ position: "absolute", left: 0, top: 0, width: 40 }}>
            {HOURS.map((hour) => (
              <Text
                key={hour}
                size="xs"
                c="dimmed"
                style={{
                  position: "absolute",
                  top: hour * 40 - 8,
                  left: 0,
                  width: 35,
                  textAlign: "right",
                }}
              >
                {hour.toString().padStart(2, "0")}:00
              </Text>
            ))}
          </Box>

          {/* Empty timeline - click anywhere to create */}
          <Box style={{ marginLeft: 45, position: "relative" }}>
            {HOURS.map((hour) => (
              <Box
                key={hour}
                style={{
                  position: "absolute",
                  top: hour * 40,
                  left: 0,
                  right: 0,
                  height: 40,
                  borderTop: "1px solid var(--mantine-color-gray-2)",
                  cursor: "pointer",
                }}
                onClick={() => onCreateAtTime(hour)}
              />
            ))}
            <Center
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
            >
              <Stack align="center" gap="xs">
                <IconCalendarEvent size={48} color="gray" stroke={1.5} />
                <Text c="dimmed">
                  Ingen bookinger denne dag - klik for at oprette
                </Text>
              </Stack>
            </Center>
          </Box>
        </Box>
      </ScrollArea>
    )
  }

  const activeRoomIds = Object.keys(bookingsByRoom).map(Number)
  const activeRooms = rooms.filter((r) => activeRoomIds.includes(r.id))

  return (
    <ScrollArea h={isMobile ? 400 : 500} offsetScrollbars >
      <Box style={{ position: "relative", minHeight: 24 * 40 + 20 }} mt={8}>
        {/* Hour labels */}
        <Box style={{ position: "absolute", left: 0, top: 0, width: 40 }}>
          {HOURS.map((hour) => (
            <Text
              key={hour}
              size="xs"
              c="dimmed"
              style={{
                position: "absolute",
                top: hour * 40 - 8,
                left: 0,
                width: 35,
                textAlign: "right",
              }}
            >
              {hour.toString().padStart(2, "0")}:00
            </Text>
          ))}
        </Box>

        {/* Timeline grid */}
        <Box style={{ marginLeft: 45, position: "relative" }}>
          {/* Hour lines - clickable for creating bookings */}
          {HOURS.map((hour) => (
            <Box
              key={hour}
              style={{
                position: "absolute",
                top: hour * 40,
                left: 0,
                right: 0,
                height: 40,
                borderTop: "1px solid var(--mantine-color-gray-2)",
                cursor: "pointer",
              }}
              onClick={(e) => handleSlotClick(hour, e)}
            />
          ))}

          {/* Room columns */}
          <Group
            gap="xs"
            align="flex-start"
            style={{
              position: "relative",
              minHeight: 24 * 40,
              zIndex: 1,
            }}
            wrap="nowrap"
          >
            {activeRooms.map((room) => (
              <Box
                key={room.id}
                style={{
                  position: "relative",
                  flex: 1,
                  minWidth: isMobile ? 100 : 120,
                  height: 24 * 40,
                }}
              >
                {/* Room header */}
                <Badge
                  size="xs"
                  style={{
                    backgroundColor: room.color,
                    color: "white",
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                  }}
                  fullWidth
                >
                  {room.name}
                </Badge>

                {/* Bookings */}
                {bookingsByRoom[room.id]?.map((booking) => {
                  const pos = getBookingPosition(booking)
                  const isPast = dayjs(booking.end_datetime).isBefore(dayjs())
                  const canEdit =
                    booking.is_own || (isAdmin && booking.is_recurring)

                  // Format time display based on whether booking spans days
                  const timeDisplay = pos.continuesFromPrevDay
                    ? `← ${dayjs(booking.end_datetime).format("HH:mm")}`
                    : pos.continuesToNextDay
                      ? `${dayjs(booking.start_datetime).format("HH:mm")} →`
                      : `${dayjs(booking.start_datetime).format("HH:mm")} - ${dayjs(booking.end_datetime).format("HH:mm")}`

                  return (
                    <Paper
                      key={booking.id}
                      data-booking
                      withBorder
                      p={4}
                      radius="sm"
                      style={{
                        position: "absolute",
                        top: pos.top + 20,
                        left: 2,
                        right: 2,
                        height: pos.height - 2,
                        backgroundColor: `${room.color}15`,
                        borderColor: room.color,
                        borderLeftWidth: 3,
                        overflow: "hidden",
                        opacity: isPast ? 0.5 : 1,
                        cursor: "pointer",
                        // Visual indicator for multi-day bookings
                        borderTopStyle: pos.continuesFromPrevDay
                          ? "dashed"
                          : "solid",
                        borderBottomStyle: pos.continuesToNextDay
                          ? "dashed"
                          : "solid",
                      }}
                      onClick={() => onViewDetails(booking)}
                    >
                      <Group
                        justify="space-between"
                        wrap="nowrap"
                        gap={2}
                        align="flex-start"
                      >
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            size="xs"
                            fw={500}
                            lineClamp={1}
                            style={{ lineHeight: 1.2 }}
                          >
                            {booking.title}
                          </Text>
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ lineHeight: 1.2 }}
                          >
                            {timeDisplay}
                          </Text>
                          {booking.is_recurring && (
                            <IconRepeat size={10} style={{ marginTop: 2 }} />
                          )}
                        </Box>
                        {canEdit && !isPast && (
                          <Menu shadow="md" width={150}>
                            <Menu.Target>
                              <ActionIcon
                                variant="subtle"
                                size="xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <IconDotsVertical size={12} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              {!booking.is_recurring && (
                                <Menu.Item
                                  leftSection={<IconEdit size={12} />}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onEdit(booking)
                                  }}
                                >
                                  Rediger
                                </Menu.Item>
                              )}
                              <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={12} />}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDelete(booking.id, booking.is_recurring)
                                }}
                              >
                                Slet
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        )}
                      </Group>
                    </Paper>
                  )
                })}
              </Box>
            ))}
          </Group>
        </Box>
      </Box>
    </ScrollArea>
  )
}

// Generate half-hour time presets
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

interface CreateBookingModalProps {
  opened: boolean
  onClose: () => void
  rooms: Room[]
  initialDate: Date | null
  initialHour: number | null
  onSuccess: () => void
}

function CreateBookingModal({
  opened,
  onClose,
  rooms,
  initialDate,
  initialHour,
  onSuccess,
}: CreateBookingModalProps) {
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState<string>("")
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [endTime, setEndTime] = useState<string>("")
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  )

  // Set initial date/time when opening modal
  useMemo(() => {
    if (opened && initialDate && !startDate) {
      setStartDate(initialDate)
      setEndDate(initialDate)
      if (initialHour !== null) {
        setStartTime(`${initialHour.toString().padStart(2, "0")}:00`)
        setEndTime(`${(initialHour + 1).toString().padStart(2, "0")}:00`)
      } else {
        setStartTime("09:00")
        setEndTime("10:00")
      }
    }
  }, [opened, initialDate, initialHour, startDate])

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

  const createMutation = useMutation({
    mutationFn: (data: CreateBookingData) => bookingsApi.createBooking(data),
    onSuccess: () => {
      notifications.show({
        title: "Booking oprettet",
        message: "Din booking er blevet tilføjet.",
        color: "green",
      })
      resetForm()
      onSuccess()
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke oprette booking. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setSelectedRoomIds([])
    setTitle("")
    setDescription("")
    setStartDate(null)
    setStartTime("")
    setEndDate(null)
    setEndTime("")
    setAvailabilityError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      selectedRoomIds.length === 0 ||
      !title.trim() ||
      !startDatetime ||
      !endDatetime
    )
      return

    createMutation.mutate({
      room_ids: selectedRoomIds.map((id) => parseInt(id)),
      title: title.trim(),
      description: description.trim(),
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    })
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  // Check duration
  const durationHours = useMemo(() => {
    if (!startDatetime || !endDatetime) return 0
    const diff = endDatetime.getTime() - startDatetime.getTime()
    return diff / (1000 * 60 * 60)
  }, [startDatetime, endDatetime])

  const isDurationValid = durationHours > 0 && durationHours <= 30

  const roomOptions = rooms.map((room) => ({
    value: String(room.id),
    label: room.name,
  }))

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Opret booking"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <MultiSelect
            label="Lokaler"
            placeholder="Vælg et eller flere lokaler"
            data={roomOptions}
            value={selectedRoomIds}
            onChange={setSelectedRoomIds}
            searchable
            required
          />

          <TextInput
            label="Titel"
            placeholder="Hvad skal lokalet bruges til?"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Beskrivelse"
            placeholder="Yderligere information (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <Group grow>
            <DateInput
              label="Startdato"
              placeholder="Vælg dato"
              value={startDate}
              onChange={(value) => setStartDate(value ? new Date(value) : null)}
              minDate={new Date()}
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
              minDate={startDate || new Date()}
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

          {durationHours > 30 && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="For lang varighed"
              color="red"
            >
              En booking må maksimalt vare 30 timer.
            </Alert>
          )}

          {availabilityError && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Konflikt"
              color="red"
            >
              {availabilityError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="light" onClick={handleClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={
                selectedRoomIds.length === 0 ||
                !title.trim() ||
                !startDatetime ||
                !endDatetime ||
                !isDurationValid
              }
            >
              Opret booking
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface EditBookingModalProps {
  opened: boolean
  onClose: () => void
  booking: CalendarBooking
  onSuccess: () => void
}

function EditBookingModal({
  opened,
  onClose,
  booking,
  onSuccess,
}: EditBookingModalProps) {
  const [title, setTitle] = useState(booking.title)
  const [description, setDescription] = useState(booking.description)
  const [startDate, setStartDate] = useState<Date | null>(
    new Date(booking.start_datetime),
  )
  const [startTime, setStartTime] = useState(
    dayjs(booking.start_datetime).format("HH:mm"),
  )
  const [endDate, setEndDate] = useState<Date | null>(
    new Date(booking.end_datetime),
  )
  const [endTime, setEndTime] = useState(
    dayjs(booking.end_datetime).format("HH:mm"),
  )

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

  const updateMutation = useMutation({
    mutationFn: (data: CreateBookingData) =>
      bookingsApi.updateBooking(parseInt(booking.id), data),
    onSuccess: () => {
      notifications.show({
        title: "Booking opdateret",
        message: "Din booking er blevet opdateret.",
        color: "green",
      })
      onSuccess()
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke opdatere booking. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDatetime || !endDatetime) return

    updateMutation.mutate({
      room_id: booking.room.id,
      title: title.trim(),
      description: description.trim(),
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    })
  }

  const durationHours = useMemo(() => {
    if (!startDatetime || !endDatetime) return 0
    const diff = endDatetime.getTime() - startDatetime.getTime()
    return diff / (1000 * 60 * 60)
  }, [startDatetime, endDatetime])

  const isDurationValid = durationHours > 0 && durationHours <= 30

  return (
    <Modal opened={opened} onClose={onClose} title="Rediger booking" size="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput label="Lokale" value={booking.room.name} disabled />

          <TextInput
            label="Titel"
            placeholder="Hvad skal lokalet bruges til?"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Beskrivelse"
            placeholder="Yderligere information (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <Group grow>
            <DateInput
              label="Startdato"
              placeholder="Vælg dato"
              value={startDate}
              onChange={(value) => setStartDate(value ? new Date(value) : null)}
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

          {durationHours > 30 && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="For lang varighed"
              color="red"
            >
              En booking må maksimalt vare 30 timer.
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={
                !title.trim() ||
                !startDatetime ||
                !endDatetime ||
                !isDurationValid
              }
            >
              Gem ændringer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface AdminModalProps {
  opened: boolean
  onClose: () => void
  rooms: Room[]
}

function AdminModal({ opened, onClose, rooms }: AdminModalProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<string | null>("rooms")

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Administrer booking"
      size="lg"
    >
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="rooms">Lokaler</Tabs.Tab>
          <Tabs.Tab value="recurring">Tilbagevendende</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="rooms" pt="md">
          <RoomsAdmin
            rooms={rooms}
            onUpdate={() =>
              queryClient.invalidateQueries({ queryKey: ["bookings", "rooms"] })
            }
          />
        </Tabs.Panel>

        <Tabs.Panel value="recurring" pt="md">
          <RecurringBookingsAdmin
            rooms={rooms}
            onUpdate={() =>
              queryClient.invalidateQueries({ queryKey: ["bookings"] })
            }
          />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}

interface RoomsAdminProps {
  rooms: Room[]
  onUpdate: () => void
}

function RoomsAdmin({ rooms, onUpdate }: RoomsAdminProps) {
  const [editingRoom, setEditingRoom] = useState<Room | null>(null)
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={500}>Lokaler</Text>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={openCreateModal}
        >
          Tilføj lokale
        </Button>
      </Group>

      <Stack gap="xs">
        {rooms.map((room) => (
          <Paper key={room.id} withBorder p="sm">
            <Group justify="space-between">
              <Group gap="sm">
                <Box
                  w={16}
                  h={16}
                  style={{ borderRadius: 4, backgroundColor: room.color }}
                />
                <div>
                  <Text fw={500}>{room.name}</Text>
                  {room.description && (
                    <Text size="sm" c="dimmed">
                      {room.description}
                    </Text>
                  )}
                </div>
              </Group>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setEditingRoom(room)}
              >
                Rediger
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>

      <CreateRoomModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onSuccess={() => {
          onUpdate()
          closeCreateModal()
        }}
      />

      {editingRoom && (
        <EditRoomModal
          opened={!!editingRoom}
          onClose={() => setEditingRoom(null)}
          room={editingRoom}
          onSuccess={() => {
            onUpdate()
            setEditingRoom(null)
          }}
        />
      )}
    </Stack>
  )
}

interface CreateRoomModalProps {
  opened: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateRoomModal({ opened, onClose, onSuccess }: CreateRoomModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState("#3B82F6")
  const [capacity, setCapacity] = useState<number | string>(0)
  const [sortOrder, setSortOrder] = useState<number | string>(0)

  const createMutation = useMutation({
    mutationFn: (data: Partial<Room>) => bookingsApi.createRoom(data),
    onSuccess: () => {
      notifications.show({
        title: "Lokale oprettet",
        message: "Lokalet er blevet tilføjet.",
        color: "green",
      })
      resetForm()
      onSuccess()
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke oprette lokale. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setName("")
    setDescription("")
    setColor("#3B82F6")
    setCapacity(0)
    setSortOrder(0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      color,
      capacity: typeof capacity === "string" ? parseInt(capacity) : capacity,
      sort_order:
        typeof sortOrder === "string" ? parseInt(sortOrder) : sortOrder,
      is_active: true,
    })
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Tilføj lokale" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Navn"
            placeholder="Lokalets navn"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <Textarea
            label="Beskrivelse"
            placeholder="Beskrivelse (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <ColorInput label="Farve" value={color} onChange={setColor} />
          <NumberInput
            label="Kapacitet"
            value={capacity}
            onChange={setCapacity}
            min={0}
          />
          <NumberInput
            label="Sorteringsrækkefølge"
            value={sortOrder}
            onChange={setSortOrder}
            min={0}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Opret
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface EditRoomModalProps {
  opened: boolean
  onClose: () => void
  room: Room
  onSuccess: () => void
}

function EditRoomModal({
  opened,
  onClose,
  room,
  onSuccess,
}: EditRoomModalProps) {
  const [name, setName] = useState(room.name)
  const [description, setDescription] = useState(room.description)
  const [color, setColor] = useState(room.color)
  const [capacity, setCapacity] = useState<number | string>(room.capacity)
  const [sortOrder, setSortOrder] = useState<number | string>(room.sort_order)
  const [isActive] = useState(room.is_active)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Room>) => bookingsApi.updateRoom(room.id, data),
    onSuccess: () => {
      notifications.show({
        title: "Lokale opdateret",
        message: "Lokalet er blevet opdateret.",
        color: "green",
      })
      onSuccess()
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke opdatere lokale. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    updateMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      color,
      capacity: typeof capacity === "string" ? parseInt(capacity) : capacity,
      sort_order:
        typeof sortOrder === "string" ? parseInt(sortOrder) : sortOrder,
      is_active: isActive,
    })
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Rediger lokale" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Navn"
            placeholder="Lokalets navn"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <Textarea
            label="Beskrivelse"
            placeholder="Beskrivelse (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <ColorInput label="Farve" value={color} onChange={setColor} />
          <NumberInput
            label="Kapacitet"
            value={capacity}
            onChange={setCapacity}
            min={0}
          />
          <NumberInput
            label="Sorteringsrækkefølge"
            value={sortOrder}
            onChange={setSortOrder}
            min={0}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              Gem
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface RecurringBookingsAdminProps {
  rooms: Room[]
  onUpdate: () => void
}

function RecurringBookingsAdmin({
  rooms,
  onUpdate,
}: RecurringBookingsAdminProps) {
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)

  const { data: recurringBookings, isLoading } = useQuery({
    queryKey: ["bookings", "recurring"],
    queryFn: () => bookingsApi.getRecurringBookings(),
  })

  const deleteMutation = useMutation({
    mutationFn: bookingsApi.deleteRecurringBooking,
    onSuccess: () => {
      onUpdate()
      notifications.show({
        title: "Tilbagevendende booking slettet",
        message: "Bookingen er blevet slettet.",
        color: "blue",
      })
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke slette booking. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={500}>Tilbagevendende bookinger</Text>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={openCreateModal}
        >
          Tilføj
        </Button>
      </Group>

      {isLoading ? (
        <Center h={100}>
          <Loader size="sm" />
        </Center>
      ) : recurringBookings?.length === 0 ? (
        <Text c="dimmed" size="sm">
          Ingen tilbagevendende bookinger.
        </Text>
      ) : (
        <Stack gap="xs">
          {recurringBookings?.map((booking) => (
            <Paper key={booking.id} withBorder p="sm">
              <Group justify="space-between">
                <Group gap="sm">
                  <Box
                    w={16}
                    h={16}
                    style={{
                      borderRadius: 4,
                      backgroundColor: booking.room.color,
                    }}
                  />
                  <div>
                    <Text fw={500}>{booking.title}</Text>
                    <Text size="sm" c="dimmed">
                      {booking.room.name} - {booking.day_of_week_display}{" "}
                      {booking.start_time.slice(0, 5)} -{" "}
                      {booking.end_time.slice(0, 5)}
                    </Text>
                  </div>
                </Group>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => deleteMutation.mutate(booking.id)}
                  loading={deleteMutation.isPending}
                >
                  Slet
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      <CreateRecurringBookingModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        rooms={rooms}
        onSuccess={() => {
          onUpdate()
          closeCreateModal()
        }}
      />
    </Stack>
  )
}

interface CreateRecurringBookingModalProps {
  opened: boolean
  onClose: () => void
  rooms: Room[]
  onSuccess: () => void
}

function CreateRecurringBookingModal({
  opened,
  onClose,
  rooms,
  onSuccess,
}: CreateRecurringBookingModalProps) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [dayOfWeek, setDayOfWeek] = useState<string | null>(null)
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")

  const createMutation = useMutation({
    mutationFn: (data: CreateRecurringBookingData) =>
      bookingsApi.createRecurringBooking(data),
    onSuccess: () => {
      notifications.show({
        title: "Tilbagevendende booking oprettet",
        message: "Bookingen er blevet tilføjet.",
        color: "green",
      })
      resetForm()
      onSuccess()
    },
    onError: (error: any) => {
      const errorMessage = extractErrorMessage(
        error,
        "Kunne ikke oprette booking. Prøv igen.",
      )
      notifications.show({
        title: "Fejl",
        message: errorMessage,
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setRoomId(null)
    setTitle("")
    setDescription("")
    setDayOfWeek(null)
    setStartTime("")
    setEndTime("")
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      !roomId ||
      !title.trim() ||
      dayOfWeek === null ||
      !startTime ||
      !endTime
    )
      return

    createMutation.mutate({
      room_id: parseInt(roomId),
      title: title.trim(),
      description: description.trim(),
      day_of_week: parseInt(dayOfWeek),
      start_time: startTime,
      end_time: endTime,
      is_active: true,
    })
  }

  const roomOptions = rooms.map((room) => ({
    value: String(room.id),
    label: room.name,
  }))

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Tilføj tilbagevendende booking"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Select
            label="Lokale"
            placeholder="Vælg lokale"
            data={roomOptions}
            value={roomId}
            onChange={setRoomId}
            required
          />

          <TextInput
            label="Titel"
            placeholder="Beskrivelse af booking"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Beskrivelse"
            placeholder="Yderligere information (valgfrit)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />

          <Select
            label="Ugedag"
            placeholder="Vælg ugedag"
            data={DAYS_OF_WEEK}
            value={dayOfWeek}
            onChange={setDayOfWeek}
            required
          />

          <Group grow>
            <TimePicker
              label="Start"
              description="Skriv eller vælg tid"
              value={startTime}
              onChange={(value) => setStartTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
            <TimePicker
              label="Slut"
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
              loading={createMutation.isPending}
              disabled={
                !roomId ||
                !title.trim() ||
                dayOfWeek === null ||
                !startTime ||
                !endTime
              }
            >
              Opret
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
