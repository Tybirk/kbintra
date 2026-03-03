import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
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
  Box,
  Select,
  Tabs,
  NumberInput,
  ColorInput,
  MultiSelect,
} from "@mantine/core"
import { DateInput, TimePicker } from "@mantine/dates"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import { IconPlus } from "@tabler/icons-react"
import dayjs from "dayjs"

import { bookingsApi } from "../../api/bookings"
import { extractErrorMessage, TIME_PRESETS } from "./BookingModals"
import type {
  Room,
  RecurringBooking,
  CreateRecurringBookingData,
} from "../../types"

const DAYS_OF_WEEK = [
  { value: "0", label: "Mandag" },
  { value: "1", label: "Tirsdag" },
  { value: "2", label: "Onsdag" },
  { value: "3", label: "Torsdag" },
  { value: "4", label: "Fredag" },
  { value: "5", label: "Lørdag" },
  { value: "6", label: "Søndag" },
]

interface AdminModalProps {
  opened: boolean
  onClose: () => void
  rooms: Room[]
}

export function AdminModal({ opened, onClose, rooms }: AdminModalProps) {
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

function RoomsAdmin({
  rooms,
  onUpdate,
}: {
  rooms: Room[]
  onUpdate: () => void
}) {
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

function CreateRoomModal({
  opened,
  onClose,
  onSuccess,
}: {
  opened: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState("#3B82F6")
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
      notifications.show({
        title: "Fejl",
        message: extractErrorMessage(
          error,
          "Kunne ikke oprette lokale. Prøv igen.",
        ),
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setName("")
    setDescription("")
    setColor("#3B82F6")
    setSortOrder(0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      color,
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

function EditRoomModal({
  opened,
  onClose,
  room,
  onSuccess,
}: {
  opened: boolean
  onClose: () => void
  room: Room
  onSuccess: () => void
}) {
  const [name, setName] = useState(room.name)
  const [description, setDescription] = useState(room.description)
  const [color, setColor] = useState(room.color)
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
      notifications.show({
        title: "Fejl",
        message: extractErrorMessage(
          error,
          "Kunne ikke opdatere lokale. Prøv igen.",
        ),
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

function RecurringBookingsAdmin({
  rooms,
  onUpdate,
}: {
  rooms: Room[]
  onUpdate: () => void
}) {
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)
  const [editingBooking, setEditingBooking] = useState<RecurringBooking | null>(
    null,
  )

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
                      {booking.room.name} - {booking.days_of_week_display}{" "}
                      {booking.start_time.slice(0, 5)} -{" "}
                      {booking.end_time.slice(0, 5)}
                    </Text>
                    {(booking.effective_from || booking.effective_until) && (
                      <Text size="xs" c="dimmed">
                        {booking.effective_from &&
                          `Fra ${dayjs(booking.effective_from).format("D. MMM YYYY")}`}
                        {booking.effective_from &&
                          booking.effective_until &&
                          " - "}
                        {booking.effective_until &&
                          `Til ${dayjs(booking.effective_until).format("D. MMM YYYY")}`}
                      </Text>
                    )}
                  </div>
                </Group>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => setEditingBooking(booking)}
                  >
                    Rediger
                  </Button>
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
      {editingBooking && (
        <EditRecurringBookingModal
          opened={!!editingBooking}
          onClose={() => setEditingBooking(null)}
          booking={editingBooking}
          rooms={rooms}
          onSuccess={() => {
            onUpdate()
            setEditingBooking(null)
          }}
        />
      )}
    </Stack>
  )
}

function EditRecurringBookingModal({
  opened,
  onClose,
  booking,
  rooms,
  onSuccess,
}: {
  opened: boolean
  onClose: () => void
  booking: RecurringBooking
  rooms: Room[]
  onSuccess: () => void
}) {
  const [roomId, setRoomId] = useState<string | null>(String(booking.room.id))
  const [title, setTitle] = useState(booking.title)
  const [description, setDescription] = useState(booking.description)
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(
    booking.days_of_week.map(String),
  )
  const [startTime, setStartTime] = useState(booking.start_time.slice(0, 5))
  const [endTime, setEndTime] = useState(booking.end_time.slice(0, 5))
  const [effectiveFrom, setEffectiveFrom] = useState<Date | null>(
    booking.effective_from ? new Date(booking.effective_from) : null,
  )
  const [effectiveUntil, setEffectiveUntil] = useState<Date | null>(
    booking.effective_until ? new Date(booking.effective_until) : null,
  )

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateRecurringBookingData>) =>
      bookingsApi.updateRecurringBooking(booking.id, data),
    onSuccess: () => {
      notifications.show({
        title: "Tilbagevendende booking opdateret",
        message: "Bookingen er blevet opdateret.",
        color: "green",
      })
      onSuccess()
    },
    onError: (error: any) => {
      notifications.show({
        title: "Fejl",
        message: extractErrorMessage(
          error,
          "Kunne ikke opdatere booking. Prøv igen.",
        ),
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      !roomId ||
      !title.trim() ||
      daysOfWeek.length === 0 ||
      !startTime ||
      !endTime
    )
      return
    updateMutation.mutate({
      room_id: parseInt(roomId),
      title: title.trim(),
      description: description.trim(),
      days_of_week: daysOfWeek.map((d) => parseInt(d)),
      start_time: startTime,
      end_time: endTime,
      effective_from: effectiveFrom
        ? dayjs(effectiveFrom).format("YYYY-MM-DD")
        : null,
      effective_until: effectiveUntil
        ? dayjs(effectiveUntil).format("YYYY-MM-DD")
        : null,
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
      title="Rediger tilbagevendende booking"
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
          <MultiSelect
            label="Ugedage"
            placeholder="Vælg en eller flere ugedage"
            data={DAYS_OF_WEEK}
            value={daysOfWeek}
            onChange={setDaysOfWeek}
            required
          />
          <Group grow>
            <TimePicker
              label="Start"
              value={startTime}
              onChange={(value) => setStartTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
            <TimePicker
              label="Slut"
              value={endTime}
              onChange={(value) => setEndTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>
          <Group grow>
            <DateInput
              label="Gyldig fra"
              placeholder="Vælg startdato (valgfrit)"
              value={effectiveFrom}
              onChange={(value) =>
                setEffectiveFrom(value ? new Date(value) : null)
              }
              clearable
              inputMode="none"
            />
            <DateInput
              label="Gyldig til"
              placeholder="Vælg slutdato (valgfrit)"
              value={effectiveUntil}
              onChange={(value) =>
                setEffectiveUntil(value ? new Date(value) : null)
              }
              minDate={effectiveFrom || undefined}
              clearable
              inputMode="none"
            />
          </Group>
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={
                !roomId ||
                !title.trim() ||
                daysOfWeek.length === 0 ||
                !startTime ||
                !endTime
              }
            >
              Gem
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

function CreateRecurringBookingModal({
  opened,
  onClose,
  rooms,
  onSuccess,
}: {
  opened: boolean
  onClose: () => void
  rooms: Room[]
  onSuccess: () => void
}) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([])
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState<Date | null>(null)
  const [effectiveUntil, setEffectiveUntil] = useState<Date | null>(null)

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
      notifications.show({
        title: "Fejl",
        message: extractErrorMessage(
          error,
          "Kunne ikke oprette booking. Prøv igen.",
        ),
        color: "red",
      })
    },
  })

  const resetForm = () => {
    setRoomId(null)
    setTitle("")
    setDescription("")
    setDaysOfWeek([])
    setStartTime("")
    setEndTime("")
    setEffectiveFrom(null)
    setEffectiveUntil(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      !roomId ||
      !title.trim() ||
      daysOfWeek.length === 0 ||
      !startTime ||
      !endTime
    )
      return
    createMutation.mutate({
      room_id: parseInt(roomId),
      title: title.trim(),
      description: description.trim(),
      days_of_week: daysOfWeek.map((d) => parseInt(d)),
      start_time: startTime,
      end_time: endTime,
      effective_from: effectiveFrom
        ? dayjs(effectiveFrom).format("YYYY-MM-DD")
        : null,
      effective_until: effectiveUntil
        ? dayjs(effectiveUntil).format("YYYY-MM-DD")
        : null,
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
          <MultiSelect
            label="Ugedage"
            placeholder="Vælg en eller flere ugedage"
            data={DAYS_OF_WEEK}
            value={daysOfWeek}
            onChange={setDaysOfWeek}
            required
          />
          <Group grow>
            <TimePicker
              label="Start"
              value={startTime}
              onChange={(value) => setStartTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
            <TimePicker
              label="Slut"
              value={endTime}
              onChange={(value) => setEndTime(value)}
              withDropdown
              maxDropdownContentHeight={200}
              presets={TIME_PRESETS}
            />
          </Group>
          <Group grow>
            <DateInput
              label="Gyldig fra"
              placeholder="Vælg startdato (valgfrit)"
              value={effectiveFrom}
              onChange={(value) =>
                setEffectiveFrom(value ? new Date(value) : null)
              }
              clearable
              inputMode="none"
            />
            <DateInput
              label="Gyldig til"
              placeholder="Vælg slutdato (valgfrit)"
              value={effectiveUntil}
              onChange={(value) =>
                setEffectiveUntil(value ? new Date(value) : null)
              }
              minDate={effectiveFrom || undefined}
              clearable
              inputMode="none"
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
                daysOfWeek.length === 0 ||
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
