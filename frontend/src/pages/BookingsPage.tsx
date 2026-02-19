import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Group,
  Button,
  Loader,
  Center,
  Box,
  Select,
  UnstyledButton,
} from "@mantine/core"
import { Schedule } from "@mantine/schedule"
import type { ScheduleEventData, ScheduleViewLevel } from "@mantine/schedule"
import { useDisclosure, useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import { IconPlus, IconSettings } from "@tabler/icons-react"
import dayjs from "dayjs"

import { bookingsApi } from "../api/bookings"
import { eventsApi } from "../api/events"
import { useAuthStore } from "../store/authStore"
import {
  bookingToScheduleData,
  DA_SCHEDULE_LABELS,
} from "../utils/scheduleHelpers"
import {
  CreateBookingModal,
  EditBookingModal,
  extractErrorMessage,
} from "./bookings/BookingModals"
import { AdminModal } from "./bookings/AdminModals"
import { BookingDetailsModal } from "./bookings/BookingDetailsModal"
import { DeleteBookingModal } from "./bookings/DeleteBookingModal"
import type { CalendarBooking } from "../types"

export default function BookingsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isMobile = useMediaQuery("(max-width: 768px)")
  const [currentDate, setCurrentDate] = useState(dayjs().format("YYYY-MM-DD"))
  const [currentView, setCurrentView] = useState<ScheduleViewLevel>("week")
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)

  // Modal states
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
    recurringBookingId?: number
    occurrenceDate?: string
  } | null>(null)
  const [deleteMode, setDeleteMode] = useState<"all" | "single">("all")
  const [adminModalOpened, { open: openAdminModal, close: closeAdminModal }] =
    useDisclosure(false)
  const [
    detailsModalOpened,
    { open: openDetailsModal, close: closeDetailsModal },
  ] = useDisclosure(false)
  const [selectedBooking, setSelectedBooking] =
    useState<CalendarBooking | null>(null)
  const [initialCreateDate, setInitialCreateDate] = useState<Date | null>(null)
  const [initialCreateTime, setInitialCreateTime] = useState<number | null>(
    null,
  )

  // Fetch rooms
  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["bookings", "rooms"],
    queryFn: () => bookingsApi.getRooms(true),
  })

  // Fetch bookings with wider range for week/month views
  const startDate = dayjs(currentDate)
    .subtract(2, "month")
    .startOf("month")
    .toISOString()
  const endDate = dayjs(currentDate)
    .add(2, "month")
    .endOf("month")
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

  // Convert bookings → Schedule events
  const scheduleEvents = useMemo(
    () => (bookings || []).map(bookingToScheduleData),
    [bookings],
  )

  const deleteMutation = useMutation({
    mutationFn: async ({
      id,
      isRecurring,
      deleteAll,
      recurringBookingId,
      occurrenceDate,
    }: {
      id: string
      isRecurring: boolean
      deleteAll: boolean
      recurringBookingId?: number
      occurrenceDate?: string
    }) => {
      if (isRecurring) {
        if (deleteAll) {
          const recurringId = recurringBookingId || parseInt(id.split("_")[1])
          return bookingsApi.deleteRecurringBooking(recurringId)
        } else {
          const recurringId = recurringBookingId || parseInt(id.split("_")[1])
          if (!occurrenceDate)
            throw new Error("Occurrence date required for single deletion")
          return bookingsApi.createRecurringBookingException(
            recurringId,
            occurrenceDate,
          )
        }
      }
      return eventsApi.deleteEvent(parseInt(id))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      closeDeleteModal()
      setBookingToDelete(null)
      setDeleteMode("all")
      notifications.show({
        title: "Booking slettet",
        message:
          deleteMode === "single"
            ? "Denne forekomst er blevet fjernet."
            : "Bookingen er blevet slettet.",
        color: "blue",
      })
    },
    onError: (error: any) => {
      notifications.show({
        title: "Fejl",
        message: extractErrorMessage(
          error,
          "Kunne ikke slette booking. Prøv igen.",
        ),
        color: "red",
      })
    },
  })

  const handleDeleteClick = useCallback(
    (
      id: string,
      isRecurring: boolean,
      recurringBookingId?: number,
      occurrenceDate?: string,
    ) => {
      setBookingToDelete({
        id,
        isRecurring,
        recurringBookingId,
        occurrenceDate,
      })
      setDeleteMode(isRecurring ? "single" : "all")
      openDeleteModal()
    },
    [openDeleteModal],
  )

  const handleConfirmDelete = useCallback(() => {
    if (bookingToDelete) {
      deleteMutation.mutate({
        id: bookingToDelete.id,
        isRecurring: bookingToDelete.isRecurring,
        deleteAll: deleteMode === "all",
        recurringBookingId: bookingToDelete.recurringBookingId,
        occurrenceDate: bookingToDelete.occurrenceDate,
      })
    }
  }, [bookingToDelete, deleteMode, deleteMutation])

  const handleEventClick = useCallback(
    (event: ScheduleEventData) => {
      const payload = event.payload as { booking: CalendarBooking } | undefined
      if (payload?.booking) {
        setSelectedBooking(payload.booking)
        openDetailsModal()
      }
    },
    [openDetailsModal],
  )

  const handleTimeSlotClick = useCallback(
    (slotStart: string) => {
      const date = new Date(slotStart.replace(" ", "T"))
      setInitialCreateDate(date)
      setInitialCreateTime(date.getHours())
      openCreateModal()
    },
    [openCreateModal],
  )

  const handleDayClick = useCallback((date: string) => {
    setCurrentDate(date)
    setCurrentView("day")
  }, [])

  const isLoading = roomsLoading || bookingsLoading
  const roomOptions = [
    { value: "", label: "Alle lokaler" },
    ...(rooms?.map((room) => ({ value: String(room.id), label: room.name })) ||
      []),
  ]

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse bookinger. Prøv igen.</Text>
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
            onClick={() => {
              setInitialCreateDate(null)
              setInitialCreateTime(null)
              openCreateModal()
            }}
            size={isMobile ? "xs" : "sm"}
          >
            {isMobile ? "Ny" : "Ny booking"}
          </Button>
        </Group>
      </Group>

      <Group gap="md" mb="md" align="flex-end">
        <Select
          placeholder="Filtrer efter lokale"
          data={roomOptions}
          value={selectedRoomId || ""}
          onChange={(value) => setSelectedRoomId(value || null)}
          clearable
          w={isMobile ? "100%" : 250}
        />
        {/* Room color legend */}
        {rooms && rooms.length > 0 && (
          <Group gap="xs" wrap="wrap">
            {rooms.map((room) => {
              const isSelected = selectedRoomId === String(room.id)
              return (
                <Group
                  key={room.id}
                  gap={6}
                  align="center"
                  onClick={() =>
                    setSelectedRoomId(isSelected ? null : String(room.id))
                  }
                  style={{
                    cursor: "pointer",
                    padding: "3px 10px",
                    borderRadius: 20,
                    border: `1.5px solid ${
                      isSelected ? room.color : "var(--mantine-color-gray-3)"
                    }`,
                    backgroundColor: isSelected
                      ? `${room.color}22`
                      : "transparent",
                    userSelect: "none",
                  }}
                >
                  <Box
                    w={10}
                    h={10}
                    style={{
                      borderRadius: "50%",
                      backgroundColor: room.color,
                      flexShrink: 0,
                    }}
                  />
                  <Text size="xs" fw={isSelected ? 600 : 400}>
                    {room.name}
                  </Text>
                </Group>
              )
            })}
          </Group>
        )}
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
          const payload = event.payload as {
            booking: CalendarBooking
          } | undefined
          const booking = payload?.booking
          return (
            <div>
              <Text size="xs" fw={500} lineClamp={1}>
                {event.title}
              </Text>
              {booking && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {booking.room.name}
                </Text>
              )}
            </div>
          )
        }}
        weekViewProps={{
          firstDayOfWeek: 1,
          withWeekNumber: true,
          withCurrentTimeIndicator: true,
          startTime: "06:00:00",
          endTime: "23:59:59",
          intervalMinutes: 60,
        }}
        dayViewProps={{
          withCurrentTimeIndicator: true,
          startTime: "06:00:00",
          endTime: "23:59:59",
          intervalMinutes: 30,
        }}
        monthViewProps={{
          firstDayOfWeek: 1,
          withWeekNumbers: true,
        }}
        mobileMonthViewProps={{
          renderEvent: (
            event: ScheduleEventData,
            { children: _children, ...buttonProps },
          ) => {
            const payload = event.payload as {
              booking: CalendarBooking
            } | undefined
            const booking = payload?.booking
            const startTime = dayjs(event.start).format("HH:mm")
            const endTime = dayjs(event.end).format("HH:mm")
            const isAllDay = startTime === "00:00" && endTime === "00:00"
            return (
              <UnstyledButton {...buttonProps}>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--mantine-spacing-sm)",
                    padding: "var(--mantine-spacing-xs) 0",
                  }}
                >
                  <div
                    style={{
                      width: "calc(0.25rem * var(--mantine-scale))",
                      borderRadius: "calc(0.125rem * var(--mantine-scale))",
                      flexShrink: 0,
                      backgroundColor: String(event.color),
                    }}
                  />
                  <div>
                    <Text>{event.title}</Text>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{
                        marginTop: "calc(0.125rem * var(--mantine-scale))",
                      }}
                    >
                      {isAllDay ? "Hele dagen" : `${startTime} – ${endTime}`}
                    </Text>
                    {booking && (
                      <Text size="xs" c="dimmed">
                        {booking.room.name}
                      </Text>
                    )}
                  </div>
                </div>
              </UnstyledButton>
            )
          },
        }}
      />

      <CreateBookingModal
        opened={createModalOpened}
        onClose={() => {
          closeCreateModal()
          setInitialCreateDate(null)
          setInitialCreateTime(null)
        }}
        rooms={rooms || []}
        initialDate={initialCreateDate}
        initialHour={initialCreateTime}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["bookings"] })
          queryClient.invalidateQueries({ queryKey: ["events"] })
          closeCreateModal()
          setInitialCreateDate(null)
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
            queryClient.invalidateQueries({ queryKey: ["events"] })
            setEditingBooking(null)
          }}
        />
      )}

      <DeleteBookingModal
        opened={deleteModalOpened}
        onClose={() => {
          closeDeleteModal()
          setBookingToDelete(null)
        }}
        isRecurring={bookingToDelete?.isRecurring || false}
        deleteMode={deleteMode}
        onDeleteModeChange={setDeleteMode}
        onConfirm={handleConfirmDelete}
        isPending={deleteMutation.isPending}
      />

      {user?.is_staff && (
        <AdminModal
          opened={adminModalOpened}
          onClose={closeAdminModal}
          rooms={rooms || []}
        />
      )}

      <BookingDetailsModal
        opened={detailsModalOpened}
        onClose={closeDetailsModal}
        booking={selectedBooking}
        user={user}
        onEdit={setEditingBooking}
        onDelete={handleDeleteClick}
      />
    </>
  )
}
