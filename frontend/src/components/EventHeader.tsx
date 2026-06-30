import { useState } from "react"

import { useNavigate } from "react-router-dom"

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
  Badge,
  Menu,
  ActionIcon,
  Modal,
  SegmentedControl,
  Divider,
  Tooltip,
  Typography,
  Textarea,
  Alert,
} from "@mantine/core"

import { useDisclosure } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconMapPin,
  IconClock,
  IconUsers,
  IconDownload,
  IconFolder,
  IconBan,
  IconAlertCircle,
  IconCalendarPlus,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { eventsApi } from "../api/events"

import { BackButton } from "./BackButton"

import { RichTextContent } from "./RichTextContent"

import type {
  Event,
  EventAttendance,
  EventFile,
  HouseholdMember,
  RsvpItem,
} from "../types"

const MAX_VISIBLE_AVATARS = 5

interface EventHeaderProps {
  slug: string

  showBackButton?: boolean

  // Slots for embedding inside a thread context (Arrangementer thread view).
  // When the event card replaces the thread's first post, these inject the
  // subgroup label, thread badges, and thread-level actions (mute, pin, …).
  subgroupLabel?: string

  extraBadges?: React.ReactNode

  extraActions?: React.ReactNode

  extraMenuItems?: React.ReactNode
}

export default function EventHeader({
  slug,
  showBackButton = true,
  subgroupLabel,
  extraBadges,
  extraActions,
  extraMenuItems,
}: EventHeaderProps) {
  const navigate = useNavigate()

  const queryClient = useQueryClient()

  const {
    data: event,

    isLoading,

    error,
  } = useQuery({
    queryKey: ["event", slug],

    queryFn: () => eventsApi.getEvent(slug),

    enabled: !!slug,
  })

  const [
    deleteModalOpened,

    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)

  const [
    cancelModalOpened,

    { open: openCancelModal, close: closeCancelModal },
  ] = useDisclosure(false)

  const [
    attendeesModalOpened,

    { open: openAttendeesModal, close: closeAttendeesModal },
  ] = useDisclosure(false)

  const [cancelMessage, setCancelMessage] = useState("")

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.deleteEvent(event!.slug),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })

      queryClient.invalidateQueries({ queryKey: ["bookings"] })

      notifications.show({
        title: "Begivenhed slettet",

        message: "Begivenheden er blevet slettet.",

        color: "blue",
      })

      navigate("/kalender")
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette begivenhed. Prøv igen.")
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => eventsApi.cancelEvent(event!.slug, cancelMessage),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", slug] })

      queryClient.invalidateQueries({ queryKey: ["events"] })

      queryClient.invalidateQueries({ queryKey: ["calendar"] })

      closeCancelModal()

      notifications.show({
        title: "Begivenhed aflyst",

        message:
          "Begivenheden er blevet aflyst og berørte brugere er notificeret.",

        color: "orange",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke aflyse begivenheden. Prøv igen.",
      )
    },
  })

  const { data: attendees } = useQuery({
    queryKey: ["event-attendees", slug],

    queryFn: () => eventsApi.getAttendees(slug),

    enabled: !!event?.rsvp_enabled,
  })

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !event) {
    return (
      <Center h={200}>
        <Stack align="center" gap="md">
          <Text c="red">Kunne ikke indlæse begivenhed.</Text>
          <Button variant="light" onClick={() => navigate("/kalender")}>
            Tilbage til kalender
          </Button>
        </Stack>
      </Center>
    )
  }

  const isPast = dayjs(event.end_datetime).isBefore(dayjs())

  const attendingList = attendees?.filter((a) => a.status === "attending") ?? []

  const notAttendingList =
    attendees?.filter((a) => a.status === "not_attending") ?? []

  const notAnsweredList =
    attendees?.filter((a) => a.status === "not_answered") ?? []

  const hasDescription = !!event.description

  const hasFiles = !!event.folder

  const hasRsvp = event.rsvp_enabled

  const hasAttendeeAvatars =
    event.rsvp_enabled && attendees && attendees.length > 0

  return (
    <>
      {showBackButton && (
        <BackButton to="/kalender" label="Tilbage til kalender" />
      )}

      {/* Main event card */}
      <Paper withBorder p="lg" radius="md" mb="md">
        {/* Header: title + badges + menu */}
        <Group justify="space-between" wrap="nowrap">
          <div style={{ flex: 1, minWidth: 0 }}>
            {subgroupLabel && (
              <Text size="sm" c="dimmed" mb={4}>
                {subgroupLabel}
              </Text>
            )}
            <Group gap="xs" mb="xs">
              <Title order={2} style={{ wordBreak: "break-word" }}>
                {event.title}
              </Title>
              {event.is_cancelled && (
                <Badge variant="filled" color="red" size="lg">
                  AFLYST
                </Badge>
              )}
              {event.visibility === "private" && (
                <Badge variant="light" color="gray">
                  Privat
                </Badge>
              )}
              {isPast && !event.is_cancelled && (
                <Badge variant="light" color="gray">
                  Afsluttet
                </Badge>
              )}
              {extraBadges}
            </Group>
            {event.is_cancelled && event.cancellation_message && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="red"
                variant="light"
                mt="xs"
              >
                {event.cancellation_message}
              </Alert>
            )}
          </div>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {extraActions}
            {(event.can_edit || extraMenuItems) && (
              <Menu shadow="md" width={200}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="lg">
                    <IconDotsVertical size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {extraMenuItems}
                  {event.can_edit && extraMenuItems && <Menu.Divider />}
                  {event.can_edit && (
                    <>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() =>
                          navigate(`/kalender/${event.slug}/rediger`)
                        }
                      >
                        Rediger begivenhed
                      </Menu.Item>
                      {!event.is_cancelled && (
                        <Menu.Item
                          color="orange"
                          leftSection={<IconBan size={14} />}
                          onClick={openCancelModal}
                        >
                          Aflys begivenhed
                        </Menu.Item>
                      )}
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={openDeleteModal}
                      >
                        Slet begivenhed
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>

        {/* Metadata */}
        <Stack gap="xs" mt="md">
          <Group gap="xs">
            <IconClock size={16} color="gray" />
            <Text size="sm">
              {dayjs(event.start_datetime).isSame(
                dayjs(event.end_datetime),

                "day",
              )
                ? `${dayjs(event.start_datetime).format("dddd D. MMMM YYYY")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("HH:mm")}`
                : `${dayjs(event.start_datetime).format("dddd D. MMMM YYYY")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("dddd D. MMMM YYYY")} kl. ${dayjs(event.end_datetime).format("HH:mm")}`}
            </Text>
            <Tooltip label="Tilføj til kalender" withArrow>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                onClick={() => void eventsApi.downloadICal(event.slug)}
              >
                <IconCalendarPlus size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {event.resolved_location && (
            <Group gap="xs">
              <IconMapPin size={16} color="gray" />
              <Text size="sm">{event.resolved_location}</Text>
            </Group>
          )}

          {event.subgroup && (
            <Group gap="xs">
              <IconUsers size={16} color="gray" />
              <Text
                size="sm"
                c="blue"
                style={{ cursor: "pointer" }}
                onClick={() => navigate(`/forum/${event.subgroup!.slug}`)}
              >
                {event.subgroup.name}
              </Text>
            </Group>
          )}

          <Group gap="xs">
            <Avatar
              src={event.created_by.profile_picture}
              size="xs"
              radius="xl"
            >
              {event.created_by.first_name?.[0]}
            </Avatar>
            <Text size="sm" c="dimmed">
              Oprettet af {event.created_by.first_name}{" "}
              {event.created_by.last_name}
              {event.edited_by && (
                <>
                  {" "}
                  · redigeret af {event.edited_by.first_name}{" "}
                  {event.edited_by.last_name}
                </>
              )}
            </Text>
          </Group>
        </Stack>

        {/* Attendee avatar row */}
        {hasAttendeeAvatars && (
          <>
            <Divider my="md" />
            <Group
              gap="xs"
              style={{ cursor: "pointer" }}
              onClick={openAttendeesModal}
            >
              <Avatar.Group>
                {attendingList.slice(0, MAX_VISIBLE_AVATARS).map((a) => (
                  <Tooltip
                    key={a.id}
                    label={getAttendeeName(a)}
                    withArrow
                    position="top"
                  >
                    <Avatar src={a.user?.profile_picture} size="sm" radius="xl">
                      {getAttendeeName(a)[0]}
                    </Avatar>
                  </Tooltip>
                ))}
                {attendingList.length > MAX_VISIBLE_AVATARS && (
                  <Avatar size="sm" radius="xl">
                    +{attendingList.length - MAX_VISIBLE_AVATARS}
                  </Avatar>
                )}
              </Avatar.Group>
              <Text size="sm" c="dimmed">
                {attendingList.length} deltager
                {notAttendingList.length > 0 &&
                  ` · ${notAttendingList.length} afmeldt`}
              </Text>
            </Group>
          </>
        )}

        {/* Description */}
        {hasDescription && (
          <>
            <Divider my="md" />
            <Typography>
              <RichTextContent html={event.description} />
            </Typography>
          </>
        )}

        {/* Files */}
        {hasFiles && (
          <>
            <Divider my="md" />
            <EventFilesSection eventSlug={event.slug} />
          </>
        )}

        {/* RSVP */}
        {hasRsvp && !event.is_cancelled && (
          <>
            <Divider my="md" />
            <RsvpSection event={event} />
          </>
        )}
        {hasRsvp && event.is_cancelled && (
          <>
            <Divider my="md" />
            <Alert icon={<IconBan size={16} />} color="gray" variant="light">
              Begivenheden er aflyst — tilmelding er ikke længere mulig.
            </Alert>
          </>
        )}
      </Paper>

      {/* Attendees modal */}
      <AttendeesModal
        opened={attendeesModalOpened}
        onClose={closeAttendeesModal}
        attending={attendingList}
        notAttending={notAttendingList}
        notAnswered={notAnsweredList}
      />

      {/* Cancel confirmation modal */}
      <Modal
        opened={cancelModalOpened}
        onClose={closeCancelModal}
        title="Aflys begivenhed"
        centered
      >
        <Text mb="sm">
          Alle berørte brugere vil modtage en notifikation om aflysningen.
        </Text>
        <Textarea
          label="Begrundelse (valgfri)"
          placeholder="Fortæl hvorfor begivenheden er aflyst..."
          value={cancelMessage}
          onChange={(e) => setCancelMessage(e.currentTarget.value)}
          mb="lg"
          maxLength={500}
          autosize
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="light" onClick={closeCancelModal}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={() => cancelMutation.mutate()}
            loading={cancelMutation.isPending}
          >
            Bekræft aflysning
          </Button>
        </Group>
      </Modal>

      {/* Delete confirmation modal */}
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
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Slet
          </Button>
        </Group>
      </Modal>
    </>
  )
}

function getAttendeeName(a: EventAttendance): string {
  return a.user
    ? `${a.user.first_name} ${a.user.last_name}`
    : a.child_name || "Ukendt"
}

interface AttendeesModalProps {
  opened: boolean

  onClose: () => void

  attending: EventAttendance[]

  notAttending: EventAttendance[]

  notAnswered: EventAttendance[]
}

function AttendeesModal({
  opened,

  onClose,

  attending,

  notAttending,

  notAnswered,
}: AttendeesModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Deltagere" size="md">
      <Stack gap="md">
        {attending.length > 0 && (
          <div>
            <Text size="sm" fw={600} c="green" mb="xs">
              Deltager ({attending.length})
            </Text>
            <Stack gap="xs">
              {attending.map((a) => (
                <AttendeeRow key={a.id} attendance={a} />
              ))}
            </Stack>
          </div>
        )}

        {notAttending.length > 0 && (
          <div>
            <Text size="sm" fw={600} c="red" mb="xs">
              Afmeldt ({notAttending.length})
            </Text>
            <Stack gap="xs">
              {notAttending.map((a) => (
                <AttendeeRow key={a.id} attendance={a} />
              ))}
            </Stack>
          </div>
        )}

        {notAnswered.length > 0 && (
          <div>
            <Text size="sm" fw={600} c="dimmed" mb="xs">
              Ikke svaret ({notAnswered.length})
            </Text>
            <Stack gap="xs">
              {notAnswered.map((a) => (
                <AttendeeRow key={a.id} attendance={a} />
              ))}
            </Stack>
          </div>
        )}

        {attending.length === 0 &&
          notAttending.length === 0 &&
          notAnswered.length === 0 && (
            <Text c="dimmed" ta="center">
              Ingen tilmeldinger endnu.
            </Text>
          )}
      </Stack>
    </Modal>
  )
}

function AttendeeRow({ attendance }: { attendance: EventAttendance }) {
  const name = getAttendeeName(attendance)

  return (
    <Group gap="sm" ml="sm">
      <Avatar src={attendance.user?.profile_picture} size="sm" radius="xl">
        {name[0]}
      </Avatar>
      <Text size="sm">{name}</Text>
    </Group>
  )
}

interface EventFilesSectionProps {
  eventSlug: string
}

function EventFilesSection({ eventSlug }: EventFilesSectionProps) {
  const { data: files, isLoading } = useQuery({
    queryKey: ["event-files", eventSlug],

    queryFn: () => eventsApi.getFiles(eventSlug),
  })

  return (
    <div>
      <Group gap="xs" mb="sm">
        <IconFolder size={18} />
        <Text size="sm" fw={600}>
          Dokumenter
        </Text>
      </Group>

      {isLoading ? (
        <Center h={60}>
          <Loader size="sm" />
        </Center>
      ) : files && files.length > 0 ? (
        <Stack gap="xs">
          {files.map((file: EventFile) => (
            <Group key={file.id} gap="sm">
              <IconDownload size={14} color="gray" />
              <Text
                size="sm"
                c="blue"
                style={{ cursor: "pointer" }}
                onClick={() => window.open(file.file_url, "_blank")}
              >
                {file.name}
              </Text>
              <Text size="xs" c="dimmed">
                {file.uploaded_by.first_name} {file.uploaded_by.last_name}
              </Text>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Ingen dokumenter.
        </Text>
      )}
    </div>
  )
}

function RsvpSection({ event }: { event: Event }) {
  const eventSlug = event.slug

  const queryClient = useQueryClient()

  const { data: householdMembers, isLoading: householdLoading } = useQuery({
    queryKey: ["event-household", eventSlug],

    queryFn: () => eventsApi.getHouseholdMembers(eventSlug),
  })

  const rsvpMutation = useMutation({
    mutationFn: (data: { attendances: RsvpItem[] }) =>
      eventsApi.submitRsvp(eventSlug, data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventSlug] })

      queryClient.invalidateQueries({
        queryKey: ["event-household", eventSlug],
      })

      queryClient.invalidateQueries({
        queryKey: ["event-attendees", eventSlug],
      })

      notifications.show({
        message: "Tilmelding gemt",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme tilmelding. Prøv igen.")
    },
  })

  return (
    <div>
      <Text size="sm" fw={600} mb="sm">
        Tilmelding
      </Text>

      {/* RSVP deadline */}
      {event.rsvp_deadline && (
        <Text size="sm" c="dimmed" mb="sm">
          Svarfrist:{" "}
          {dayjs(event.rsvp_deadline).format("D. MMMM YYYY kl. HH:mm")}
        </Text>
      )}

      {/* Household RSVP — auto-save on click */}
      {householdLoading ? (
        <Center h={100}>
          <Loader size="sm" />
        </Center>
      ) : householdMembers && householdMembers.length > 0 ? (
        <HouseholdRsvpForm
          members={householdMembers}
          onChangeStatus={(attendances) => rsvpMutation.mutate({ attendances })}
          isPending={rsvpMutation.isPending}
        />
      ) : null}
    </div>
  )
}

interface HouseholdRsvpFormProps {
  members: HouseholdMember[]

  onChangeStatus: (attendances: RsvpItem[]) => void

  isPending: boolean
}

function HouseholdRsvpForm({
  members,

  onChangeStatus,

  isPending,
}: HouseholdRsvpFormProps) {
  const [statuses, setStatuses] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}

    for (const member of members) {
      const key =
        member.type === "adult" ? `user_${member.id}` : `child_${member.id}`

      initial[key] = member.current_status || "not_answered"
    }

    return initial
  })

  const handleChange = (memberKey: string, value: string) => {
    const newStatuses = { ...statuses, [memberKey]: value }

    setStatuses(newStatuses)

    const attendances: RsvpItem[] = members.map((member) => {
      const key =
        member.type === "adult" ? `user_${member.id}` : `child_${member.id}`

      const status = (
        key === memberKey ? value : newStatuses[key]
      ) as RsvpItem["status"]

      if (member.type === "adult") {
        return { user_id: member.id, status }
      }

      return { child_id: member.id, status }
    })

    onChangeStatus(attendances)
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        Din husstand
      </Text>
      {members.map((member) => {
        const key =
          member.type === "adult" ? `user_${member.id}` : `child_${member.id}`

        return (
          <Group key={key} wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={statuses[key]}
              onChange={(value) => handleChange(key, value)}
              disabled={isPending}
              data={[
                { label: "Deltager", value: "attending" },

                { label: "Deltager ikke", value: "not_attending" },
              ]}
            />
            <Text size="sm">{member.name}</Text>
          </Group>
        )
      })}
    </Stack>
  )
}
