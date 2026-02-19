import { useState, useMemo, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Group,
  Button,
  Stack,
  TextInput,
  Textarea,
  Modal,
  MultiSelect,
  Alert,
} from "@mantine/core"
import { DateInput, TimePicker } from "@mantine/dates"
import { notifications } from "@mantine/notifications"
import { IconAlertCircle } from "@tabler/icons-react"
import dayjs from "dayjs"

import { eventsApi } from "../../api/events"
import type { Room, CalendarBooking, CreateEventData } from "../../types"

// Generate half-hour time presets
export const TIME_PRESETS = [
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

/** Extract error messages from Django REST Framework responses */
export function extractErrorMessage(error: any, fallback: string): string {
  const data = error?.response?.data
  if (!data) return fallback
  if (typeof data.detail === "string") return data.detail
  if (
    Array.isArray(data.non_field_errors) &&
    data.non_field_errors.length > 0
  ) {
    return data.non_field_errors.join(" ")
  }
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
  if (fieldErrors.length > 0) return fieldErrors.join(" ")
  return fallback
}

interface CreateBookingModalProps {
  opened: boolean
  onClose: () => void
  rooms: Room[]
  initialDate: Date | null
  initialHour: number | null
  onSuccess: () => void
}

export function CreateBookingModal({
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

  useEffect(() => {
    if (opened && initialDate) {
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
  }, [opened, initialDate, initialHour])

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
    mutationFn: (data: CreateEventData) => eventsApi.createEvent(data),
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
      notifications.show({ title: "Fejl", message: errorMessage, color: "red" })
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
      visibility: "private",
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

  const durationHours = useMemo(() => {
    if (!startDatetime || !endDatetime) return 0
    return (endDatetime.getTime() - startDatetime.getTime()) / (1000 * 60 * 60)
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
              description=" tid"
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

export function EditBookingModal({
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
      eventsApi.updateEvent(parseInt(booking.id), data),
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
      notifications.show({ title: "Fejl", message: errorMessage, color: "red" })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDatetime || !endDatetime) return
    updateMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    })
  }

  const durationHours = useMemo(() => {
    if (!startDatetime || !endDatetime) return 0
    return (endDatetime.getTime() - startDatetime.getTime()) / (1000 * 60 * 60)
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
