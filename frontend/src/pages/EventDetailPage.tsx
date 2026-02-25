import { useState, useEffect } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
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
  Anchor,
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
  IconBan,
  IconAlertCircle,
  IconExternalLink,
  IconMessage,
  IconCalendarPlus,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { eventsApi } from "../api/events"
import { notificationsApi } from "../api/notifications"
import { forumApi } from "../api/forum"
import { clearDraft } from "../utils/draftStorage"
import RichTextEditor from "../components/RichTextEditor"
import Reactions from "../components/Reactions"
import UserLink from "../components/UserLink"
import type {
  Event,
  EventAttendance,
  EventFile,
  HouseholdMember,
  Post,
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

  // Auto-mark event notifications as read when visiting the event page
  useEffect(() => {
    if (eventId) {
      void notificationsApi.markReadByLink(`/kalender/${eventId}`).then(() => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
      })
    }
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    mutationFn: () => eventsApi.deleteEvent(eventId),
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette begivenhed. Prøv igen.",
        color: "red",
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => eventsApi.cancelEvent(eventId, cancelMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      queryClient.invalidateQueries({ queryKey: ["calendar"] })
      closeCancelModal()
      notifications.show({
        title: "Arrangement aflyst",
        message:
          "Arrangementet er blevet aflyst og berørte brugere er notificeret.",
        color: "orange",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke aflyse arrangementet. Prøv igen.",
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

  const hasDescription = !!event.description
  const hasFiles = !!event.folder
  const hasRsvp = event.rsvp_enabled
  const hasAttendeeAvatars =
    event.rsvp_enabled && attendees && attendees.length > 0

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

      {/* Main event card */}
      <Paper withBorder p="lg" radius="md" mb="md">
        {/* Header: title + badges + menu */}
        <Group justify="space-between" wrap="nowrap">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb="xs">
              <Title order={2}>{event.title}</Title>
              {event.is_cancelled && (
                <Badge variant="filled" color="red" size="lg">
                  AFLYST
                </Badge>
              )}
              {event.rsvp_enabled && !event.is_cancelled && (
                <Badge variant="light" color="grape">
                  RSVP
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

          {event.can_edit && (
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
                {!event.is_cancelled && (
                  <Menu.Item
                    color="orange"
                    leftSection={<IconBan size={14} />}
                    onClick={openCancelModal}
                  >
                    Aflys
                  </Menu.Item>
                )}
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
                onClick={() => void eventsApi.downloadICal(event.id)}
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
              <div dangerouslySetInnerHTML={{ __html: event.description }} />
            </Typography>
          </>
        )}

        {/* Files */}
        {hasFiles && (
          <>
            <Divider my="md" />
            <EventFilesSection eventId={event.id} />
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
              Arrangementet er aflyst — tilmelding er ikke længere mulig.
            </Alert>
          </>
        )}
      </Paper>

      {/* Discussion thread — separate card */}
      {event.thread_id && (
        <DiscussionSection
          threadId={event.thread_id}
          subgroupSlug={event.thread_subgroup_slug}
          threadSlug={event.thread_slug}
        />
      )}

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
        title="Aflys arrangement"
        centered
      >
        <Text mb="sm">
          Alle berørte brugere vil modtage en notifikation om aflysningen.
        </Text>
        <Textarea
          label="Begrundelse (valgfri)"
          placeholder="Fortæl hvorfor arrangementet er aflyst..."
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
  eventId: number
}

function EventFilesSection({ eventId }: EventFilesSectionProps) {
  const { data: files, isLoading } = useQuery({
    queryKey: ["event-files", eventId],
    queryFn: () => eventsApi.getFiles(eventId),
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
  const eventId = event.id
  const queryClient = useQueryClient()

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
      notifications.show({
        message: "Tilmelding gemt",
        color: "green",
      })
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
      <Text size="sm" fw={500}>
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

interface DiscussionSectionProps {
  threadId: number
  subgroupSlug: string | null
  threadSlug: string | null
}

interface UpdatePostMutationProps {
  postId: number
  content: string
}

function DiscussionSection({
  threadId,
  subgroupSlug,
  threadSlug,
}: DiscussionSectionProps) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [content, setContent] = useState("")
  const [editingPostId, setEditingPostId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState("")

  const { data: thread, isLoading } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => forumApi.getThread(threadId),
  })

  // Scroll to and highlight a specific post when navigating from a notification
  useEffect(() => {
    if (!thread || !location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (!el) return
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.style.transition = "box-shadow 0.3s ease"
      el.style.boxShadow = "0 0 0 3px var(--mantine-color-blue-4)"
      setTimeout(() => {
        el.style.boxShadow = ""
      }, 2000)
    }, 100)
    return () => clearTimeout(timer)
  }, [thread, location.hash])

  const createPostMutation = useMutation({
    mutationFn: () => forumApi.createPost(threadId, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      setContent("")
      clearDraft("event-reply-" + threadId)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke sende indlæg. Prøv igen.",
        color: "red",
      })
    },
  })

  const updatePostMutation = useMutation({
    mutationFn: ({ postId, content }: UpdatePostMutationProps) =>
      forumApi.updatePost(postId, { content: content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      setEditingPostId(null)
      setEditContent("")
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere indlæg. Prøv igen.",
        color: "red",
      })
    },
  })

  const deletePostMutation = useMutation({
    mutationFn: (postId: number) => forumApi.deletePost(postId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette indlæg. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = () => {
    const stripped = content.replace(/<[^>]+>/g, "").trim()
    if (!stripped) return
    createPostMutation.mutate()
  }

  const handleStartEdit = (post: Post) => {
    setEditingPostId(post.id)
    setEditContent(post.content)
  }

  const handleCancelEdit = () => {
    setEditingPostId(null)
    setEditContent("")
  }

  const handleSaveEdit = (postId: number) => {
    updatePostMutation.mutate({ postId, content: editContent })
  }

  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconMessage size={16} />
          <Text size="sm" fw={600}>
            Diskussion
          </Text>
          {thread && (
            <Text size="sm" c="dimmed">
              ({thread.posts.length})
            </Text>
          )}
        </Group>
        {subgroupSlug && threadSlug && (
          <Anchor
            href={`/forum/${subgroupSlug}/traad/${threadSlug}`}
            target="_blank"
            size="sm"
          >
            <Group gap={4}>
              Se i forum
              <IconExternalLink size={12} />
            </Group>
          </Anchor>
        )}
      </Group>

      {isLoading ? (
        <Center h={80}>
          <Loader size="sm" />
        </Center>
      ) : (
        <Stack gap="md">
          {thread?.posts.map((post) => (
            <Paper
              key={post.id}
              id={`post-${post.id}`}
              withBorder
              p="md"
              radius="sm"
            >
              <Group justify="space-between" mb="xs" wrap="nowrap">
                <Group gap="xs">
                  <Avatar
                    src={post.author.profile_picture}
                    size="sm"
                    radius="xl"
                  >
                    {post.author.first_name?.[0]}
                  </Avatar>
                  <div>
                    <UserLink
                      id={post.author.id}
                      firstName={post.author.first_name}
                      lastName={post.author.last_name}
                      size="sm"
                      fw={500}
                    />
                    <Text size="xs" c="dimmed">
                      {dayjs(post.created_at).format("D. MMM YYYY HH:mm")}
                    </Text>
                  </div>
                </Group>
                {post.can_edit && editingPostId !== post.id && (
                  <Menu shadow="md" width={160}>
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm">
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={13} />}
                        onClick={() => handleStartEdit(post)}
                      >
                        Rediger
                      </Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={13} />}
                        onClick={() => deletePostMutation.mutate(post.id)}
                        disabled={deletePostMutation.isPending}
                      >
                        Slet
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>

              {editingPostId === post.id ? (
                <Stack gap="xs">
                  <RichTextEditor
                    content={editContent}
                    onChange={setEditContent}
                    minHeight={100}
                  />
                  <Group gap="xs" justify="flex-end">
                    <Button
                      variant="light"
                      size="xs"
                      onClick={handleCancelEdit}
                    >
                      Annuller
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => handleSaveEdit(post.id)}
                      loading={updatePostMutation.isPending}
                    >
                      Gem
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <>
                  <Typography>
                    <div dangerouslySetInnerHTML={{ __html: post.content }} />
                  </Typography>
                  <Reactions
                    postId={post.id}
                    threadQueryKey={["thread", threadId]}
                    reactions={post.reactions}
                  />
                </>
              )}
            </Paper>
          ))}

          {/* Reply form */}
          <Paper withBorder p="md" radius="sm">
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Skriv et svar..."
              minHeight={100}
              draftKey={"event-reply-" + threadId}
            />
            <Group justify="flex-end" mt="xs">
              <Button
                size="sm"
                onClick={handleSubmit}
                loading={createPostMutation.isPending}
              >
                Send
              </Button>
            </Group>
          </Paper>
        </Stack>
      )}
    </Paper>
  )
}
