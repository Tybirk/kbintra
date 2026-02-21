import { useState, useMemo, useEffect } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
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
  Switch,
  Select,
  TagsInput,
  Alert,
} from "@mantine/core"
import { DateInput, DatePickerInput, TimePicker } from "@mantine/dates"
import { notifications } from "@mantine/notifications"
import { IconArrowLeft, IconMapPin, IconAlertCircle } from "@tabler/icons-react"
import dayjs from "dayjs"

import { clearDraft, loadDraft, saveDraft } from "../utils/draftStorage"
import { eventsApi } from "../api/events"
import { bookingsApi } from "../api/bookings"
import { forumApi } from "../api/forum"
import RichTextEditor from "../components/RichTextEditor"
import { AttachmentArea } from "../components/FileDropzone"
import { AttachmentBadge } from "../components/AttachmentBadge"
import type { CreateEventData, EventFile, EventVisibility } from "../types"

type FormErrors = Partial<Record<string, string>>

function parseDrfErrors(error: unknown): FormErrors {
  const data = (error as { response?: { data?: Record<string, unknown> } })
    ?.response?.data
  if (!data || typeof data !== "object")
    return { _form: "Noget gik galt. Prøv igen." }

  const errors: FormErrors = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === "non_field_errors") {
      errors._form = Array.isArray(value) ? value.join("\n") : String(value)
    } else {
      errors[key] = Array.isArray(value) ? value.join(" ") : String(value)
    }
  }
  return Object.keys(errors).length > 0
    ? errors
    : { _form: "Noget gik galt. Prøv igen." }
}

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

export default function EventFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id
  const eventId = Number(id)

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const visibility: EventVisibility = "community"
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState("")
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [endTime, setEndTime] = useState("")
  const [stedTags, setStedTags] = useState<string[]>([])
  const [subgroupId, setSubgroupId] = useState<string | null>(null)
  const [rsvpEnabled, setRsvpEnabled] = useState(false)
  const [rsvpDeadline, setRsvpDeadline] = useState<Date | null>(null)
  const [attachments, setAttachments] = useState<File[]>([])
  const [multiDate, setMultiDate] = useState(false)
  const [extraDates, setExtraDates] = useState<Date[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [roomConflicts, setRoomConflicts] = useState<string | null>(null)

  useEffect(() => {
    if (isEditMode) return
    loadDraft("new-event-title").then((draft) => {
      if (draft) setTitle(draft)
    })
  }, [isEditMode])

  useEffect(() => {
    if (isEditMode) return
    const t = setTimeout(() => saveDraft("new-event-title", title), 1500)
    return () => clearTimeout(t)
  }, [title, isEditMode])

  const clearErrors = () => {
    if (Object.keys(errors).length > 0) setErrors({})
  }

  // Pre-select subgroup and date from URL params (e.g. /kalender/opret?subgroup=5&date=2026-02-27)
  useEffect(() => {
    if (!isEditMode) {
      const sgParam = searchParams.get("subgroup")
      if (sgParam) setSubgroupId(sgParam)
      const dateParam = searchParams.get("date")
      if (dateParam) {
        const parsed = new Date(dateParam)
        if (!isNaN(parsed.getTime())) {
          setStartDate(parsed)
          setEndDate(parsed)
        }
      }
      const timeParam = searchParams.get("time")
      if (timeParam && /^\d{2}:\d{2}$/.test(timeParam)) {
        setStartTime(timeParam)
        setEndTime(addOneHour(timeParam))
      }
    }
  }, [searchParams, isEditMode])

  // Fetch existing event in edit mode
  const { data: existingEvent, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getEvent(eventId),
    enabled: isEditMode,
  })

  // Fetch existing files in edit mode
  const { data: existingFiles } = useQuery({
    queryKey: ["event-files", eventId],
    queryFn: () => eventsApi.getFiles(eventId),
    enabled: isEditMode,
  })

  // Fetch rooms and subgroups
  const { data: rooms } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => bookingsApi.getRooms(),
  })

  const { data: subgroups } = useQuery({
    queryKey: ["subgroups"],
    queryFn: () => forumApi.getSubgroups(),
  })

  // Room name → ID lookup + derived state from stedTags
  const roomByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rooms || []) map.set(r.name, r.id)
    return map
  }, [rooms])

  const selectedRoomIds = stedTags
    .filter((t) => roomByName.has(t))
    .map((t) => roomByName.get(t)!)
  const customLocation = stedTags.filter((t) => !roomByName.has(t)).join(", ")

  // Populate form in edit mode
  useEffect(() => {
    if (existingEvent) {
      setTitle(existingEvent.title)
      setDescription(existingEvent.description)
      setStartDate(new Date(existingEvent.start_datetime))
      setStartTime(dayjs(existingEvent.start_datetime).format("HH:mm"))
      setEndDate(new Date(existingEvent.end_datetime))
      setEndTime(dayjs(existingEvent.end_datetime).format("HH:mm"))
      const tags: string[] = []
      existingEvent.rooms.forEach((r) => tags.push(r.name))
      if (existingEvent.location) tags.push(existingEvent.location)
      setStedTags(tags)
      setSubgroupId(
        existingEvent.subgroup ? String(existingEvent.subgroup.id) : null,
      )
      setRsvpEnabled(existingEvent.rsvp_enabled)
      setRsvpDeadline(
        existingEvent.rsvp_deadline
          ? new Date(existingEvent.rsvp_deadline)
          : null,
      )
    }
  }, [existingEvent])

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

  // Proactive room availability check (primary date + extra dates)
  useEffect(() => {
    if (selectedRoomIds.length === 0 || !startDatetime || !endDatetime) {
      setRoomConflicts(null)
      return
    }
    const duration = endDatetime.getTime() - startDatetime.getTime()
    const [h, m] = startTime.split(":").map(Number)

    // Build list of all date ranges to check
    const datesToCheck: Date[] = [startDatetime]
    if (multiDate && extraDates.length > 0) {
      for (const d of extraDates) {
        datesToCheck.push(dayjs(d).hour(h).minute(m).second(0).toDate())
      }
    }

    const timeout = setTimeout(async () => {
      try {
        const allMsgs: string[] = []
        for (const checkStart of datesToCheck) {
          const checkEnd = new Date(checkStart.getTime() + duration)
          const result = await bookingsApi.checkAvailability({
            room_ids: selectedRoomIds,
            start_datetime: checkStart.toISOString(),
            end_datetime: checkEnd.toISOString(),
            exclude_event_id: isEditMode ? eventId : undefined,
          })
          if (!result.can_book_all) {
            const dateLabel = dayjs(checkStart).format("D. MMM")
            for (const [rid, conflicts] of Object.entries(
              result.conflicts_by_room,
            )) {
              const room = rooms?.find((r) => r.id === Number(rid))
              const prefix = datesToCheck.length > 1 ? `${dateLabel} — ` : ""
              allMsgs.push(
                `${prefix}${room?.name || `Lokale ${rid}`}: ${conflicts.join("; ")}`,
              )
            }
          }
        }
        setRoomConflicts(allMsgs.length > 0 ? allMsgs.join("\n") : null)
      } catch {
        // Silently fail — backend will catch it on submit
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [
    selectedRoomIds.join(","),
    startDatetime,
    endDatetime,
    isEditMode,
    eventId,
    rooms,
    multiDate,
    extraDates,
  ])

  const handleStartDateChange = (value: string | null) => {
    clearErrors()
    const newDate = value ? new Date(value) : null
    setStartDate(newDate)
    if (newDate && !endDate) {
      setEndDate(newDate)
    }
  }

  const handleStartTimeChange = (value: string) => {
    clearErrors()
    setStartTime(value)
    if (value && (!endTime || endTime <= value)) {
      setEndTime(addOneHour(value))
    }
  }

  const handleAddFiles = (files: File[]) => {
    setAttachments((prev) => [
      ...prev,
      ...files.filter((f) => !prev.some((p) => p.name === f.name)),
    ])
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  // Upload files after event creation/update
  const uploadFiles = async (targetEventId: number) => {
    if (attachments.length === 0) return
    try {
      await eventsApi.uploadFiles(targetEventId, attachments)
    } catch {
      notifications.show({
        title: "Advarsel",
        message: "Begivenheden blev gemt, men filerne kunne ikke uploades.",
        color: "yellow",
      })
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateEventData) => eventsApi.createEvent(data),
    onSuccess: async (result) => {
      await uploadFiles(result.id)
      clearDraft("new-event-title")
      clearDraft("new-event-description")
      queryClient.invalidateQueries({ queryKey: ["events"] })
      notifications.show({
        title: "Begivenhed oprettet",
        message: "Din begivenhed er blevet tilføjet til kalenderen.",
        color: "green",
      })
      navigate(`/kalender/${result.id}`)
    },
    onError: (error) => {
      const fieldErrors = parseDrfErrors(error)
      setErrors(fieldErrors)
      if (Object.keys(fieldErrors).length === 0) {
        notifications.show({
          title: "Fejl",
          message: "Kunne ikke oprette begivenhed. Prøv igen.",
          color: "red",
        })
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: CreateEventData) => eventsApi.updateEvent(eventId, data),
    onSuccess: async () => {
      await uploadFiles(eventId)
      queryClient.invalidateQueries({ queryKey: ["events"] })
      queryClient.invalidateQueries({ queryKey: ["event", eventId] })
      queryClient.invalidateQueries({ queryKey: ["event-files", eventId] })
      notifications.show({
        title: "Begivenhed opdateret",
        message: "Din begivenhed er blevet opdateret.",
        color: "green",
      })
      navigate(`/kalender/${eventId}`)
    },
    onError: (error) => {
      const fieldErrors = parseDrfErrors(error)
      setErrors(fieldErrors)
      if (Object.keys(fieldErrors).length === 0) {
        notifications.show({
          title: "Fejl",
          message: "Kunne ikke opdatere begivenhed. Prøv igen.",
          color: "red",
        })
      }
    },
  })

  const [multiDatePending, setMultiDatePending] = useState(false)

  const submitMultiDate = (trimmedTitle: string) => {
    setMultiDatePending(true)
    const allDates = [startDate!, ...extraDates].sort(
      (a, b) => dayjs(a).valueOf() - dayjs(b).valueOf(),
    )
    const duration = endDatetime!.getTime() - startDatetime!.getTime()
    const [startHours, startMinutes] = startTime.split(":").map(Number)

    const run = async () => {
      const createdIds: number[] = []
      try {
        for (const date of allDates) {
          const dateLabel = dayjs(date).format("D. MMM")
          const adjustedStart = dayjs(date)
            .hour(startHours)
            .minute(startMinutes)
            .second(0)
            .toDate()
          const adjustedEnd = new Date(adjustedStart.getTime() + duration)

          const data: CreateEventData = {
            title: `${trimmedTitle} (${dateLabel})`,
            description: description.trim(),
            visibility,
            start_datetime: adjustedStart.toISOString(),
            end_datetime: adjustedEnd.toISOString(),
            location: customLocation,
            room_ids: selectedRoomIds.length > 0 ? selectedRoomIds : undefined,
            subgroup_id: subgroupId ? Number(subgroupId) : null,
            rsvp_enabled: rsvpEnabled,
            rsvp_deadline:
              rsvpEnabled && rsvpDeadline ? rsvpDeadline.toISOString() : null,
          }

          const result = await eventsApi.createEvent(data)
          createdIds.push(result.id)

          if (attachments.length > 0) {
            try {
              await eventsApi.uploadFiles(result.id, attachments)
            } catch {
              // Ignore file upload errors for individual events
            }
          }
        }

        clearDraft("new-event-title")
        clearDraft("new-event-description")
        queryClient.invalidateQueries({ queryKey: ["events"] })
        notifications.show({
          title: "Begivenheder oprettet",
          message: `${createdIds.length} begivenheder blev tilføjet til kalenderen.`,
          color: "green",
        })
        navigate("/kalender")
      } catch (error) {
        const fieldErrors = parseDrfErrors(error)
        setErrors(fieldErrors)
        if (Object.keys(fieldErrors).length === 0) {
          notifications.show({
            title: "Fejl",
            message: "Kunne ikke oprette alle begivenheder. Prøv igen.",
            color: "red",
          })
        }
      } finally {
        setMultiDatePending(false)
      }
    }

    run()
  }

  const handleSubmit = () => {
    setErrors({})
    if (!title.trim() || !startDatetime || !endDatetime) return

    const trimmedTitle = title.trim()

    // Multi-date creation (create mode only)
    if (!isEditMode && multiDate && extraDates.length > 0) {
      submitMultiDate(trimmedTitle)
      return
    }

    // Single event creation or edit
    const data: CreateEventData = {
      title: trimmedTitle,
      description: description.trim(),
      visibility,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
      location: customLocation,
      room_ids: selectedRoomIds.length > 0 ? selectedRoomIds : undefined,
      subgroup_id: subgroupId ? Number(subgroupId) : null,
      rsvp_enabled: rsvpEnabled,
      rsvp_deadline:
        rsvpEnabled && rsvpDeadline ? rsvpDeadline.toISOString() : null,
    }

    if (isEditMode) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const isPending =
    createMutation.isPending || updateMutation.isPending || multiDatePending
  const endBeforeStart =
    !!startDatetime && !!endDatetime && endDatetime <= startDatetime
  const isFormValid =
    !!title.trim() &&
    !!startDatetime &&
    !!endDatetime &&
    !endBeforeStart &&
    !roomConflicts

  if (isEditMode && eventLoading) {
    return (
      <Center h={300}>
        <Loader size="lg" />
      </Center>
    )
  }

  const subgroupOptions = (subgroups || []).map((s) => ({
    value: String(s.id),
    label: s.name,
  }))

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() =>
          isEditMode ? navigate(`/kalender/${eventId}`) : navigate("/kalender")
        }
        mb="md"
        px={0}
      >
        {isEditMode ? "Tilbage til begivenhed" : "Tilbage til kalender"}
      </Button>

      <Title order={2} mb="lg">
        {isEditMode ? "Rediger begivenhed" : "Opret begivenhed"}
      </Title>

      <Paper withBorder p="lg" radius="md">
        <form onSubmit={(e) => e.preventDefault()}>
          <Stack gap="md">
            <TextInput
              label="Titel"
              placeholder="Begivenhedstitel"
              value={title}
              onChange={(e) => {
                clearErrors()
                setTitle(e.currentTarget.value)
              }}
              error={errors.title}
              required
            />

            <div>
              <Text size="sm" fw={500} mb={4}>
                Beskrivelse
              </Text>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Beskrivelse, dagsorden, etc. (valgfrit)"
                minHeight={120}
                draftKey={isEditMode ? undefined : "new-event-description"}
              />
            </div>

            {/* File upload */}
            <div>
              <Text size="sm" fw={500} mb={4}>
                Dokumenter
              </Text>
              {isEditMode && existingFiles && existingFiles.length > 0 && (
                <Stack gap="xs" mb="xs">
                  {existingFiles.map((file: EventFile) => (
                    <Text
                      key={file.id}
                      size="sm"
                      c="blue"
                      style={{ cursor: "pointer" }}
                      onClick={() => window.open(file.file_url, "_blank")}
                    >
                      {file.name}
                    </Text>
                  ))}
                </Stack>
              )}
              <AttachmentArea onAddFiles={handleAddFiles}>
                {attachments.length > 0 && (
                  <Group gap="xs" wrap="wrap">
                    {attachments.map((file, i) => (
                      <AttachmentBadge
                        key={`${file.name}-${i}`}
                        file={file}
                        onRemove={() => handleRemoveFile(i)}
                      />
                    ))}
                  </Group>
                )}
              </AttachmentArea>
            </div>

            <Group grow>
              <DateInput
                label="Startdato"
                placeholder="Vælg dato"
                value={startDate}
                onChange={handleStartDateChange}
                minDate={isEditMode ? undefined : new Date()}
                error={errors.start_datetime}
                required
              />
              <TimePicker
                label="Starttid"
                value={startTime}
                onChange={handleStartTimeChange}
                error={errors.start_datetime}
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
                onChange={(value) => {
                  clearErrors()
                  setEndDate(value ? new Date(value) : null)
                }}
                minDate={startDate || undefined}
                error={errors.end_datetime}
                required
              />
              <TimePicker
                label="Sluttid"
                value={endTime}
                onChange={(value) => {
                  clearErrors()
                  setEndTime(value)
                }}
                error={errors.end_datetime}
                withDropdown
                maxDropdownContentHeight={200}
                presets={TIME_PRESETS}
              />
            </Group>

            {endBeforeStart && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="orange"
                variant="light"
              >
                Sluttidspunkt skal være efter starttidspunkt.
              </Alert>
            )}

            <TagsInput
              label="Sted"
              placeholder="Vælg lokale eller skriv sted"
              leftSection={<IconMapPin size={16} />}
              data={(rooms || []).map((r) => r.name)}
              value={stedTags}
              onChange={(value) => {
                clearErrors()
                setStedTags(value)
              }}
              error={errors.room_ids || errors.location}
              clearable
            />

            {selectedRoomIds.length > 0 && !roomConflicts && (
              <Text size="xs" c="dimmed" mt={-8}>
                Lokale valgt — tilgængelighed tjekkes automatisk
              </Text>
            )}

            {roomConflicts && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="orange"
                title="Lokale optaget"
              >
                {roomConflicts}
              </Alert>
            )}

            <Select
              label="Gruppe"
              placeholder="Vælg gruppe (valgfrit)"
              data={subgroupOptions}
              value={subgroupId}
              onChange={setSubgroupId}
              clearable
              searchable
            />

            <Switch
              label="Tilmelding (RSVP)"
              description="Tillad beboere at tilmelde sig begivenheden"
              checked={rsvpEnabled}
              onChange={(e) => setRsvpEnabled(e.currentTarget.checked)}
            />

            {!isEditMode && (
              <Switch
                label="Opret denne begivenhed på flere datoer"
                description="Samme begivenhed oprettes for hver valgt dato"
                checked={multiDate}
                onChange={(e) => {
                  setMultiDate(e.currentTarget.checked)
                  if (!e.currentTarget.checked) setExtraDates([])
                }}
              />
            )}

            {!isEditMode && multiDate && (
              <DatePickerInput<"multiple">
                type="multiple"
                label="Ekstra datoer"
                placeholder="Klik for at vælge datoer"
                value={extraDates}
                onChange={(dates) => setExtraDates(dates as unknown as Date[])}
                description={`${extraDates.length} ekstra dato${
                  extraDates.length !== 1 ? "er" : ""
                } valgt (plus startdatoen ovenfor)`}
                valueFormat="ddd, D. MMM"
                minDate={new Date()}
                clearable
              />
            )}

            {rsvpEnabled && (
              <DateInput
                label="Svarfrist"
                placeholder="Vælg svarfrist (valgfrit)"
                description={
                  multiDate && extraDates.length > 0
                    ? "Svarfrist kan ikke sættes for begivenheder på flere datoer"
                    : "Deadline sættes til kl. 23:59 på den valgte dato"
                }
                value={multiDate && extraDates.length > 0 ? null : rsvpDeadline}
                onChange={(value) => {
                  if (value) {
                    // Default deadline to end of selected day (23:59:59)
                    const eod = dayjs(value).endOf("day").toDate()
                    setRsvpDeadline(eod)
                  } else {
                    setRsvpDeadline(null)
                  }
                }}
                minDate={isEditMode ? undefined : new Date()}
                maxDate={startDate || undefined}
                error={errors.rsvp_deadline}
                clearable
                disabled={multiDate && extraDates.length > 0}
              />
            )}

            {errors._form && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                title="Fejl"
                color="red"
                withCloseButton
                onClose={() =>
                  setErrors((e) => {
                    const { _form, ...rest } = e
                    return rest
                  })
                }
              >
                {errors._form}
              </Alert>
            )}

            <Group justify="flex-end" mt="md">
              <Button
                variant="light"
                onClick={() =>
                  isEditMode
                    ? navigate(`/kalender/${eventId}`)
                    : navigate("/kalender")
                }
              >
                Annuller
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                loading={isPending}
                disabled={!isFormValid}
              >
                {isEditMode ? "Gem ændringer" : "Opret begivenhed"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </>
  )
}
