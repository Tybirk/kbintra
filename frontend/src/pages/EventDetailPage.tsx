import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
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
  TypographyStylesProvider,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconMapPin,
  IconClock,
  IconUsers,
  IconDownload,
  IconFolder,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { eventsApi } from "../api/events"
import type {
  EventAttendance,
  EventFile,
  HouseholdMember,
  RsvpItem,
} from "../types"

const MAX_VISIBLE_AVATARS = 5

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const eventId = Number(id)

  const {
    data: event,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getEvent(eventId),
    enabled: !!eventId,
  })

  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)

  const [
    attendeesModalOpened,
    { open: openAttendeesModal, close: closeAttendeesModal },
  ] = useDisclosure(false)

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.deleteEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      notifications.show({
        title: "Begivenhed slettet",
        message: "Begivenheden er blevet slettet.",
        color: "blue",
      })
      navigate("/kalender")
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette begivenhed. Prøv igen.",
        color: "red",
      })
    },
  })

  // Fetch attendees for the avatar preview + modal
  const { data: attendees } = useQuery({
    queryKey: ["event-attendees", eventId],
    queryFn: () => eventsApi.getAttendees(eventId),
    enabled: !!event?.rsvp_enabled,
  })

  if (isLoading) {
    return (
      <Center h={300}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !event) {
    return (
      <Center h={300}>
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

  return (
    <>
      {/* Back button */}
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/kalender")}
        mb="md"
        px={0}
      >
        Tilbage til kalender
      </Button>

      {/* Header */}
      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" wrap="nowrap">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb="xs">
              <Title order={2}>{event.title}</Title>
              {event.is_all_day && <Badge variant="light">Hele dagen</Badge>}
              {event.rsvp_enabled && (
                <Badge variant="light" color="grape">
                  RSVP
                </Badge>
              )}
              {event.visibility === "private" && (
                <Badge variant="light" color="gray">
                  Privat
                </Badge>
              )}
              {isPast && (
                <Badge variant="light" color="gray">
                  Afsluttet
                </Badge>
              )}
            </Group>
          </div>

          {event.is_own && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle" size="lg">
                  <IconDotsVertical size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconEdit size={14} />}
                  onClick={() => navigate(`/kalender/${event.id}/rediger`)}
                >
                  Rediger
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={openDeleteModal}
                >
                  Slet
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>

        {/* Metadata */}
        <Stack gap="xs" mt="md">
          <Group gap="xs">
            <IconClock size={16} color="gray" />
            <Text size="sm">
              {event.is_all_day
                ? dayjs(event.start_datetime).format("dddd D. MMMM YYYY")
                : `${dayjs(event.start_datetime).format("dddd D. MMMM YYYY")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("HH:mm")}`}
            </Text>
          </Group>

          {(event.room || event.location) && (
            <Group gap="xs">
              <IconMapPin size={16} color="gray" />
              <Text size="sm">
                {[event.room?.name, event.location].filter(Boolean).join(", ")}
              </Text>
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
            </Text>
          </Group>
        </Stack>

        {/* Attendee avatar row (Facebook-style) */}
        {event.rsvp_enabled && attendees && attendees.length > 0 && (
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
      </Paper>

      {/* Description */}
      {event.description && (
        <Paper withBorder p="lg" radius="md" mb="md">
          <Title order={4} mb="sm">
            Beskrivelse
          </Title>
          <TypographyStylesProvider>
            <div dangerouslySetInnerHTML={{ __html: event.description }} />
          </TypographyStylesProvider>
        </Paper>
      )}

      {/* Documents */}
      {event.folder && (
        <EventFilesSection eventId={event.id} subgroup={event.subgroup} />
      )}

      {/* iCal download */}
      <Paper withBorder p="lg" radius="md" mb="md">
        <Button
          variant="light"
          leftSection={<IconDownload size={16} />}
          onClick={() => window.open(eventsApi.getICalUrl(event.id), "_blank")}
        >
          Tilføj til kalender
        </Button>
      </Paper>

      {/* RSVP Section — auto-save on click */}
      {event.rsvp_enabled && <RsvpSection eventId={event.id} />}

      {/* Attendees modal */}
      <AttendeesModal
        opened={attendeesModalOpened}
        onClose={closeAttendeesModal}
        attending={attendingList}
        notAttending={notAttendingList}
        notAnswered={notAnsweredList}
      />

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

interface SubgroupRef {
  slug: string
  name: string
}

interface EventFilesSectionProps {
  eventId: number
  subgroup: SubgroupRef | null
}

function EventFilesSection({ eventId, subgroup }: EventFilesSectionProps) {
  const navigate = useNavigate()

  const { data: files, isLoading } = useQuery({
    queryKey: ["event-files", eventId],
    queryFn: () => eventsApi.getFiles(eventId),
  })

  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Group gap="xs" mb="sm">
        <IconFolder size={18} />
        <Title order={4}>Dokumenter</Title>
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

      {subgroup && (
        <Button
          variant="light"
          size="sm"
          mt="sm"
          onClick={() => navigate(`/forum/${subgroup.slug}`)}
        >
          Åbn dokumentmappe i {subgroup.name}
        </Button>
      )}
    </Paper>
  )
}

function RsvpSection({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient()

  const { data: event } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getEvent(eventId),
  })

  const { data: householdMembers, isLoading: householdLoading } = useQuery({
    queryKey: ["event-household", eventId],
    queryFn: () => eventsApi.getHouseholdMembers(eventId),
  })

  const rsvpMutation = useMutation({
    mutationFn: (data: { attendances: RsvpItem[] }) =>
      eventsApi.submitRsvp(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] })
      queryClient.invalidateQueries({ queryKey: ["event-household", eventId] })
      queryClient.invalidateQueries({ queryKey: ["event-attendees", eventId] })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme tilmelding. Prøv igen.",
        color: "red",
      })
    },
  })

  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Title order={4} mb="sm">
        Tilmelding
      </Title>

      {/* RSVP deadline */}
      {event?.rsvp_deadline && (
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
    </Paper>
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

    // Auto-save: build full attendances list and submit immediately
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
      <Text size="sm" fw={600}>
        Din husstand
      </Text>
      {members.map((member) => {
        const key =
          member.type === "adult" ? `user_${member.id}` : `child_${member.id}`
        return (
          <Group key={key} justify="space-between" wrap="nowrap">
            <Text size="sm">{member.name}</Text>
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
          </Group>
        )
      })}
    </Stack>
  )
}
