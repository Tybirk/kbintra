import { Text, Group, Button, Stack, Modal, Badge, Box } from "@mantine/core"
import { IconEdit, IconTrash, IconRepeat } from "@tabler/icons-react"
import dayjs from "dayjs"

import type { CalendarBooking, User } from "../../types"

interface BookingDetailsModalProps {
  opened: boolean
  onClose: () => void
  booking: CalendarBooking | null
  user: User | null
  onEdit: (booking: CalendarBooking) => void
  onDelete: (
    id: string,
    event_slug: string | null,
    isRecurring: boolean,
    recurringBookingId?: number,
    occurrenceDate?: string,
  ) => void
}

export function BookingDetailsModal({
  opened,
  onClose,
  booking,
  user,
  onEdit,
  onDelete,
}: BookingDetailsModalProps) {
  if (!booking) return null

  return (
    <Modal opened={opened} onClose={onClose} title="Booking detaljer" centered>
      <Stack gap="md">
        <Group gap="sm">
          <Box
            w={16}
            h={16}
            style={{ borderRadius: 4, backgroundColor: booking.room.color }}
          />
          <Text fw={500}>{booking.room.name}</Text>
        </Group>

        <div>
          <Text size="sm" c="dimmed">
            Titel
          </Text>
          <Text fw={500}>{booking.title}</Text>
        </div>

        {booking.description && (
          <div>
            <Text size="sm" c="dimmed">
              Beskrivelse
            </Text>
            <Text>{booking.description}</Text>
          </div>
        )}

        <div>
          <Text size="sm" c="dimmed">
            Tidspunkt
          </Text>
          <Text>
            {dayjs(booking.start_datetime).format("dddd D. MMMM YYYY")}
          </Text>
          <Text fw={500}>
            {dayjs(booking.start_datetime).format("HH:mm")} -{" "}
            {dayjs(booking.end_datetime).format("HH:mm")}
          </Text>
        </div>

        <div>
          <Text size="sm" c="dimmed">
            Booket af
          </Text>
          <Text>
            {booking.user.first_name} {booking.user.last_name}
          </Text>
        </div>

        {booking.is_recurring && (
          <Badge leftSection={<IconRepeat size={12} />} variant="light">
            Tilbagevendende booking
          </Badge>
        )}

        <Group justify="flex-end" mt="md">
          {(booking.is_own || (user?.is_staff && booking.is_recurring)) && (
            <>
              {!booking.is_recurring && (
                <Button
                  variant="light"
                  leftSection={<IconEdit size={16} />}
                  onClick={() => {
                    onClose()
                    onEdit(booking)
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
                  onClose()
                  onDelete(
                    booking.id,
                    booking.event_slug,
                    booking.is_recurring,
                    booking.recurring_booking_id || undefined,
                    dayjs(booking.start_datetime).format("YYYY-MM-DD"),
                  )
                }}
              >
                Slet
              </Button>
            </>
          )}
          <Button onClick={onClose}>Luk</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
