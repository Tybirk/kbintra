import {
  useState,
  useEffect,
  useRef,
  memo,
  lazy,
  Suspense,
  type RefObject,
} from "react"

import { useParams, useNavigate, useLocation } from "react-router-dom"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import * as Sentry from "@sentry/react"

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
  ScrollArea,
  Badge,
  Box,
  Indicator,
  Image,
  CloseButton,
  ActionIcon,
  Menu,
  Anchor,
  Divider,
  Popover,
  UnstyledButton,
} from "@mantine/core"

import { useDisclosure, useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconPlus,
  IconMessage,
  IconSearch,
  IconCheck,
  IconChecks,
  IconArrowLeft,
  IconUserPlus,
  IconDots,
  IconLogout,
  IconEdit,
  IconPencil,
  IconTrash,
  IconCopy,
  IconMoodSmile,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { messagingApi, chatWs } from "../api/messaging"

import { apiClient } from "../api/client"

import UserPickerModal from "../components/UserPickerModal"

import { useAuthStore } from "../store/authStore"

import type {
  Conversation,
  ConversationDetail,
  Message,
  WsMessage,
  WsMessageEdited,
  WsMessageDeleted,
  WsMessageReacted,
  WsConversationRenamed,
  WsMessageReactionEntry,
  MessageReactionSummary,
  ReactionType,
  User,
  MessageAttachment,
} from "../types"

import ChatRichTextEditor from "../components/ChatRichTextEditor"

import { clearDraft } from "../utils/draftStorage"

import { getFileIcon, getFileTypeColor } from "../components/FilePreview"

import { AttachmentCarousel } from "../components/AttachmentCarousel"

import FileDropzone from "../components/FileDropzone"

import { filterFilesBySize } from "../config"

const LazyPicker = lazy(() => import("@emoji-mart/react"))

const emojiDataPromise = () => import("@emoji-mart/data").then((m) => m.default)

// Default quick-reaction emojis

const DEFAULT_EMOJIS: string[] = [
  "\u{1F44D}",

  "\u2764\uFE0F",

  "\u{1F602}",

  "\u{1F62E}",

  "\u{1F622}",

  "\u{1F389}",
]

interface EmojiPickerData {
  native: string
}

export default function MessagesPage() {
  const { user } = useAuthStore()

  const { conversationId } = useParams<{ conversationId?: string }>()

  const navigate = useNavigate()

  const queryClient = useQueryClient()

  const [selectedConversation, setSelectedConversation] =
    useState<number | null>(
      conversationId ? parseInt(conversationId, 10) : null,
    )

  const [isComposingNew, setIsComposingNew] = useState(false)

  const [isWsConnected, setIsWsConnected] = useState(chatWs.isConnected)

  const [conversationSearch, setConversationSearch] = useState("")

  const isMobile = useMediaQuery("(max-width: 768px)")

  const inConversationMobile =
    !!isMobile && (!!selectedConversation || isComposingNew)

  // Track on-screen keyboard height so the fixed mobile conversation view pulls
  // up above it. position: fixed is anchored to the layout viewport, which
  // doesn't shrink when the keyboard appears, so without this the input sits
  // behind the keyboard on first focus.
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  useEffect(() => {
    if (!inConversationMobile) {
      setKeyboardOffset(0)
      return
    }
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop
      setKeyboardOffset(Math.max(0, offset))
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [inConversationMobile])

  const selectedConversationRef = useRef(selectedConversation)

  const lastMarkedReadConversation = useRef<number | null>(null)

  // Sync URL param to state when URL changes (e.g., from notification link)

  useEffect(() => {
    const urlConversationId = conversationId
      ? parseInt(conversationId, 10)
      : null

    if (urlConversationId !== selectedConversation) {
      setSelectedConversation(urlConversationId)

      if (urlConversationId) {
        setIsComposingNew(false)
      }
    }

    // Note: selectedConversation is intentionally excluded to prevent sync loops.

    // This effect syncs URL -> state, not the other way around.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Fetch conversations

  const { data: conversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ["conversations"],

    queryFn: messagingApi.getConversations,
  })

  const reportedBadConversations = useRef(false)

  if (
    conversations != null &&
    !Array.isArray(conversations) &&
    !reportedBadConversations.current
  ) {
    reportedBadConversations.current = true

    Sentry.captureMessage("MessagesPage: conversations is not an array", {
      level: "error",

      extra: { conversations: JSON.stringify(conversations).slice(0, 500) },
    })
  }

  const safeConversations = Array.isArray(conversations) ? conversations : []

  const filteredConversations = conversationSearch.trim()
    ? safeConversations.filter((conv) => {
        const term = conversationSearch.trim().toLowerCase()
        const others = conv.other_participants ?? []

        if (others.length === 0) {
          return "slettet bruger".includes(term)
        }

        return others.some(
          (p) =>
            p.first_name.toLowerCase().includes(term) ||
            p.last_name.toLowerCase().includes(term) ||
            `${p.first_name} ${p.last_name}`.toLowerCase().includes(term),
        )
      })
    : safeConversations

  // Fetch selected conversation detail

  const { data: activeConversation, isLoading: conversationLoading } = useQuery(
    {
      queryKey: ["conversation", selectedConversation],

      queryFn: () =>
        selectedConversation
          ? messagingApi.getConversation(selectedConversation)
          : null,

      enabled: !!selectedConversation,
    },
  )

  const reportedBadActiveConversation = useRef<number | null>(null)

  if (
    activeConversation != null &&
    !Array.isArray(activeConversation.other_participants) &&
    reportedBadActiveConversation.current !== activeConversation.id
  ) {
    reportedBadActiveConversation.current = activeConversation.id

    Sentry.captureMessage(
      "MessagesPage: activeConversation.other_participants is not an array",
      {
        level: "error",
        extra: {
          conversation: JSON.stringify(activeConversation).slice(0, 1000),
          selectedConversation,
        },
      },
    )
  }

  // Keep ref in sync with state

  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  // Connect WebSocket on mount (stable — does not reconnect on conversation switch)

  useEffect(() => {
    chatWs.connect()

    const unsubConnection = chatWs.onConnectionChange((connected) => {
      setIsWsConnected(connected)
    })

    const unsubMessage = chatWs.onMessage((data) => {
      const wsData = data as WsMessage

      if (wsData.type === "new_message") {
        // Update conversation list

        queryClient.invalidateQueries({ queryKey: ["conversations"] })

        // Update active conversation if it matches

        const currentConv = selectedConversationRef.current

        if (wsData.message.conversation === currentConv) {
          queryClient.setQueryData<ConversationDetail>(
            ["conversation", currentConv],

            (old) => {
              if (!old) return old

              // Check if message already exists to prevent duplicates

              if (old.messages.some((m) => m.id === wsData.message.id)) {
                return old
              }

              return {
                ...old,

                messages: [...old.messages, wsData.message],
              }
            },
          )

          // Mark as read immediately since we're actively viewing this conversation

          chatWs.markRead(currentConv)

          queryClient.invalidateQueries({
            queryKey: ["messages", "unread-count"],
          })
        }
      } else if (wsData.type === "messages_read") {
        // Update read status in active conversation

        queryClient.invalidateQueries({
          queryKey: ["conversation", wsData.conversation_id],
        })
      } else if (wsData.type === "new_conversation") {
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      } else if (wsData.type === "message_edited") {
        const editedData = wsData as WsMessageEdited

        queryClient.setQueryData<ConversationDetail>(
          ["conversation", editedData.conversation_id],

          (old) => {
            if (!old) return old

            return {
              ...old,

              messages: old.messages.map((m) =>
                m.id === editedData.message_id
                  ? {
                      ...m,

                      content: editedData.content,

                      edited_at: editedData.edited_at,
                    }
                  : m,
              ),
            }
          },
        )
      } else if (wsData.type === "message_deleted") {
        const deletedData = wsData as WsMessageDeleted

        queryClient.setQueryData<ConversationDetail>(
          ["conversation", deletedData.conversation_id],

          (old) => {
            if (!old) return old

            return {
              ...old,

              messages: old.messages.map((m) =>
                m.id === deletedData.message_id
                  ? { ...m, is_deleted: true, content: "" }
                  : m,
              ),
            }
          },
        )
      } else if (wsData.type === "message_reacted") {
        const reactedData = wsData as WsMessageReacted

        const currentUserId = user?.id ?? -1

        queryClient.setQueryData<ConversationDetail>(
          ["conversation", reactedData.conversation_id],

          (old) => {
            if (!old) return old

            return {
              ...old,

              messages: old.messages.map((m) =>
                m.id === reactedData.message_id
                  ? {
                      ...m,

                      reactions: reactedData.reactions.map(
                        (
                          r: WsMessageReactionEntry,
                        ): MessageReactionSummary => ({
                          reaction_type: r.reaction_type as ReactionType,

                          emoji: r.emoji,

                          count: r.count,

                          has_reacted: r.user_ids.includes(currentUserId),

                          users: r.users,
                        }),
                      ),
                    }
                  : m,
              ),
            }
          },
        )
      } else if (wsData.type === "conversation_renamed") {
        const renameData = wsData as WsConversationRenamed

        queryClient.setQueryData<ConversationDetail>(
          ["conversation", renameData.conversation_id],

          (old) => {
            if (!old) return old

            return { ...old, name: renameData.name }
          },
        )

        queryClient.setQueryData<Conversation[]>(["conversations"], (old) => {
          if (!old) return old

          return old.map((c) =>
            c.id === renameData.conversation_id
              ? { ...c, name: renameData.name }
              : c,
          )
        })
      }
    })

    return () => {
      unsubConnection()

      unsubMessage()
    }
  }, [queryClient])

  // Mark messages as read when opening a conversation.

  // The backend auto-marks messages as read when the conversation is fetched,

  // so unread_count in the response is always 0 — we cannot rely on it as a

  // condition. Instead, run once per conversation selection (tracked via ref)

  // and invalidate the sidebar list and header badge caches.

  useEffect(() => {
    if (!selectedConversation || !activeConversation) return

    if (lastMarkedReadConversation.current === selectedConversation) return

    lastMarkedReadConversation.current = selectedConversation

    chatWs.markRead(selectedConversation)

    queryClient.invalidateQueries({ queryKey: ["conversations"] })

    queryClient.invalidateQueries({ queryKey: ["messages", "unread-count"] })
  }, [selectedConversation, activeConversation, queryClient])

  // Polling fallback when WebSocket is disconnected

  useEffect(() => {
    if (isWsConnected || !selectedConversation) {
      return
    }

    // Poll for new messages every 5 seconds when WebSocket is down

    const pollInterval = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: ["conversation", selectedConversation],
      })

      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    }, 5000)

    return () => clearInterval(pollInterval)
  }, [isWsConnected, selectedConversation, queryClient])

  const handleSelectConversation = (id: number) => {
    setSelectedConversation(id)

    setIsComposingNew(false)

    navigate(`/beskeder/${id}`, { replace: true })
  }

  const handleStartNewMessage = () => {
    setSelectedConversation(null)

    setIsComposingNew(true)

    navigate("/beskeder", { replace: true })
  }

  const handleNewConversationCreated = (newConversationId: number) => {
    setIsComposingNew(false)

    chatWs.joinConversation(newConversationId)

    setSelectedConversation(newConversationId)

    navigate(`/beskeder/${newConversationId}`, { replace: true })

    queryClient.invalidateQueries({ queryKey: ["conversations"] })
  }

  const handleCancelNewMessage = () => {
    setIsComposingNew(false)
  }

  const handleLeaveConversation = async () => {
    if (!selectedConversation) return

    try {
      await messagingApi.leaveConversation(selectedConversation)

      setSelectedConversation(null)

      navigate("/beskeder", { replace: true })

      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    } catch (error) {
      showErrorNotification(error, "Kunne ikke forlade samtalen")
    }
  }

  return (
    <Box
      style={{
        display: "flex",

        flexDirection: "column",

        overflow: "hidden",

        ...(inConversationMobile
          ? {
              // Full-screen overlay for mobile conversation view

              position: "fixed",

              top: "var(--app-shell-header-height, 60px)",

              left: 0,

              right: 0,

              bottom: keyboardOffset,
            }
          : { height: "100%" }),
      }}
    >
      {!inConversationMobile && (
        <Group justify="space-between" mb="md">
          <div>
            <Title order={1}>Beskeder</Title>
            <Group gap="xs">
              <Text c="dimmed">Direkte beskeder</Text>
              {isWsConnected && (
                <Badge size="xs" color="green" variant="dot">
                  Live
                </Badge>
              )}
            </Group>
          </div>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleStartNewMessage}
          >
            Ny besked
          </Button>
        </Group>
      )}

      <Paper
        withBorder={!inConversationMobile}
        radius={inConversationMobile ? 0 : "md"}
        style={{
          flex: 1,

          minHeight: inConversationMobile ? undefined : "400px",

          display: "flex",

          overflow: "hidden",
        }}
      >
        {/* Conversation List - hide on mobile when conversation is selected */}
        <Box
          style={{
            width: isMobile ? "100%" : 320,

            borderRight: isMobile
              ? "none"
              : "1px solid var(--mantine-color-default-border)",

            display:
              isMobile && (selectedConversation || isComposingNew)
                ? "none"
                : "flex",

            flexDirection: "column",
          }}
        >
          <Box
            p="md"
            style={{
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <TextInput
              placeholder="Find samtale..."
              leftSection={<IconSearch size={16} />}
              size="sm"
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.currentTarget.value)}
            />
          </Box>
          <ScrollArea style={{ flex: 1 }}>
            {conversationsLoading ? (
              <Center h={200}>
                <Loader size="sm" />
              </Center>
            ) : filteredConversations.length === 0 ? (
              <Center h={200}>
                <Stack align="center" gap="xs">
                  <IconMessage size={48} color="gray" />
                  <Text c="dimmed" size="sm">
                    {conversationSearch.trim()
                      ? "Ingen samtaler matcher søgningen"
                      : "Ingen samtaler endnu"}
                  </Text>
                </Stack>
              </Center>
            ) : (
              <div role="listbox" aria-label="Samtaler">
                {filteredConversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isSelected={conv.id === selectedConversation}
                    currentUserId={user?.id}
                    onClick={() => handleSelectConversation(conv.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </Box>

        {/* Chat Area - hide on mobile when no conversation is selected */}
        <Box
          style={{
            flex: 1,

            minWidth: 0,

            display:
              isMobile && !selectedConversation && !isComposingNew
                ? "none"
                : "flex",

            flexDirection: "column",
          }}
        >
          {isComposingNew ? (
            <NewConversationArea
              onBack={isMobile ? handleCancelNewMessage : undefined}
              onSuccess={handleNewConversationCreated}
            />
          ) : selectedConversation ? (
            conversationLoading ? (
              <Center style={{ flex: 1 }}>
                <Loader size="lg" />
              </Center>
            ) : activeConversation ? (
              <ChatArea
                key={activeConversation.id}
                conversation={activeConversation}
                onBack={
                  isMobile
                    ? () => {
                        setSelectedConversation(null)

                        navigate("/beskeder", { replace: true })
                      }
                    : undefined
                }
                onSendMessage={async (
                  content,

                  attachments,

                  mentionedUserIds,
                ) => {
                  const success = await chatWs.sendMessage(
                    selectedConversation,

                    content,

                    attachments,

                    mentionedUserIds,
                  )

                  if (!success) {
                    notifications.show({
                      title: "Fejl",

                      message: "Kunne ikke sende besked. Prøv igen.",

                      color: "red",
                    })
                  } else if (
                    !chatWs.isConnected ||
                    attachments.length > 0 ||
                    mentionedUserIds.length > 0
                  ) {
                    // If we used REST fallback or sent attachments/mentions, refresh to get the new message

                    queryClient.invalidateQueries({
                      queryKey: ["conversation", selectedConversation],
                    })

                    queryClient.invalidateQueries({
                      queryKey: ["conversations"],
                    })
                  }
                }}
                onParticipantsAdded={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["conversation", selectedConversation],
                  })

                  queryClient.invalidateQueries({
                    queryKey: ["conversations"],
                  })
                }}
                onLeave={handleLeaveConversation}
                isMobile={isMobile ?? false}
                onMessageUpdated={(messageId, content, editedAt) => {
                  queryClient.setQueryData<ConversationDetail>(
                    ["conversation", selectedConversation],

                    (old) => {
                      if (!old) return old

                      return {
                        ...old,

                        messages: old.messages.map((m) =>
                          m.id === messageId
                            ? { ...m, content, edited_at: editedAt }
                            : m,
                        ),
                      }
                    },
                  )
                }}
                onMessageDeleted={(messageId) => {
                  queryClient.setQueryData<ConversationDetail>(
                    ["conversation", selectedConversation],

                    (old) => {
                      if (!old) return old

                      return {
                        ...old,

                        messages: old.messages.map((m) =>
                          m.id === messageId
                            ? { ...m, is_deleted: true, content: "" }
                            : m,
                        ),
                      }
                    },
                  )
                }}
              />
            ) : null
          ) : (
            <Center style={{ flex: 1 }}>
              <Stack align="center" gap="xs">
                <IconMessage size={64} color="gray" />
                <Text c="dimmed">Vælg en samtale for at sende beskeder</Text>
              </Stack>
            </Center>
          )}
        </Box>
      </Paper>
    </Box>
  )
}

interface ConversationItemProps {
  conversation: Conversation

  isSelected: boolean

  currentUserId?: number

  onClick: () => void
}

function ConversationItem({
  conversation,

  isSelected,

  currentUserId,

  onClick,
}: ConversationItemProps) {
  const otherParticipants = conversation.other_participants ?? []

  const isGroupChat = otherParticipants.length > 1

  const hasNoParticipants = otherParticipants.length === 0

  const displayName = conversation.name
    ? conversation.name
    : hasNoParticipants
      ? "Slettet bruger"
      : otherParticipants.map((p) => p.first_name).join(", ")

  const avatar = otherParticipants[0]

  const unreadLabel =
    conversation.unread_count > 0 ? `, ${conversation.unread_count} ulæste` : ""

  return (
    <UnstyledButton
      p="sm"
      w="100%"
      role="option"
      aria-selected={isSelected}
      aria-label={`Samtale med ${displayName}${unreadLabel}`}
      style={{
        cursor: "pointer",

        backgroundColor: isSelected
          ? "var(--mantine-color-blue-light)"
          : undefined,

        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
      onClick={onClick}
    >
      <Group gap="sm" wrap="nowrap">
        <Indicator
          disabled={conversation.unread_count === 0}
          color="blue"
          size={10}
          offset={4}
          zIndex={1}
        >
          {isGroupChat ? (
            <Avatar.Group spacing="sm">
              {otherParticipants.slice(0, 3).map((p) => (
                <Avatar
                  key={p.id}
                  src={p.profile_picture}
                  radius="xl"
                  size="md"
                >
                  {p.first_name?.[0]}
                </Avatar>
              ))}
              {otherParticipants.length > 3 && (
                <Avatar radius="xl" size="md">
                  +{otherParticipants.length - 3}
                </Avatar>
              )}
            </Avatar.Group>
          ) : (
            <Avatar src={avatar?.profile_picture} radius="xl" size="md">
              {avatar?.first_name?.[0]}
              {avatar?.last_name?.[0]}
            </Avatar>
          )}
        </Indicator>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text
              fw={conversation.unread_count > 0 ? 600 : 500}
              truncate
              c={hasNoParticipants ? "dimmed" : undefined}
              fs={hasNoParticipants ? "italic" : undefined}
            >
              {displayName}
            </Text>
            {conversation.last_message && (
              <Text size="xs" c="dimmed">
                {dayjs(conversation.last_message.created_at).fromNow()}
              </Text>
            )}
          </Group>
          {conversation.last_message && (
            <Text size="sm" c="dimmed" truncate>
              {conversation.last_message.sender_id === currentUserId
                ? "Dig: "
                : isGroupChat
                  ? `${otherParticipants.find((p) => p.id === conversation.last_message?.sender_id)?.first_name || ""}: `
                  : ""}
              {conversation.last_message.content

                .replace(/<\/[^>]+>/g, " ")

                .replace(/<[^>]*>/g, "")

                .replace(/\s+/g, " ")

                .trim()}
            </Text>
          )}
        </div>
        {conversation.unread_count > 0 && (
          <Badge size="sm" circle>
            {conversation.unread_count}
          </Badge>
        )}
      </Group>
    </UnstyledButton>
  )
}

interface ChatAreaProps {
  conversation: ConversationDetail

  onSendMessage: (
    content: string,

    attachments: File[],

    mentionedUserIds: number[],
  ) => Promise<void> | void

  onBack?: () => void

  onParticipantsAdded?: () => void

  onLeave?: () => void

  onMessageUpdated?: (
    messageId: number,

    content: string,

    editedAt: string,
  ) => void

  onMessageDeleted?: (messageId: number) => void

  isMobile?: boolean
}

function getDateLabel(date: dayjs.Dayjs): string {
  const today = dayjs().startOf("day")

  const msgDay = date.startOf("day")

  const diff = today.diff(msgDay, "day")

  if (diff === 0) return "I dag"

  if (diff === 1) return "I går"

  if (diff < 7) {
    const name = date.format("dddd")

    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  if (date.year() === today.year()) return date.format("D. MMMM")

  return date.format("D. MMMM YYYY")
}

const TIME_GAP_MINUTES = 20

interface MessageListProps {
  messages: Message[]

  isMobile: boolean | undefined

  onEdit?: (messageId: number, content: string, editedAt: string) => void

  onUnsend?: (messageId: number) => void

  scrollViewportRef: RefObject<HTMLDivElement | null>
}

const MessageList = memo(function MessageList({
  messages,

  isMobile,

  onEdit,

  onUnsend,

  scrollViewportRef,
}: MessageListProps) {
  return (
    <div
      ref={scrollViewportRef}
      style={{
        flex: 1,

        overflowY: "auto",

        overflowX: "hidden",

        scrollbarGutter: "stable",

        padding: "var(--mantine-spacing-md)",

        overscrollBehavior: "contain",
      }}
    >
      <Stack gap="sm" style={{ width: "100%" }}>
        {messages.map((msg, idx) => {
          const prevMsg = idx > 0 ? messages[idx - 1] : null

          const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null

          const sameSenderAsPrev =
            prevMsg != null && prevMsg.sender.id === msg.sender.id

          const sameSenderAsNext =
            nextMsg != null && nextMsg.sender.id === msg.sender.id

          const timeSincePrev = prevMsg
            ? dayjs(msg.created_at).diff(dayjs(prevMsg.created_at), "minute")
            : Infinity

          const timeToNext = nextMsg
            ? dayjs(nextMsg.created_at).diff(dayjs(msg.created_at), "minute")
            : Infinity

          const showDateSeparator =
            !prevMsg ||
            !dayjs(msg.created_at).isSame(dayjs(prevMsg.created_at), "day")

          const showAvatar =
            !sameSenderAsPrev ||
            timeSincePrev >= TIME_GAP_MINUTES ||
            showDateSeparator

          const showTime =
            !sameSenderAsNext ||
            timeToNext >= TIME_GAP_MINUTES ||
            (nextMsg != null &&
              !dayjs(msg.created_at).isSame(dayjs(nextMsg.created_at), "day"))

          const dateLabel = showDateSeparator
            ? getDateLabel(dayjs(msg.created_at))
            : null

          return (
            <Box key={msg.id}>
              {dateLabel && (
                <Divider
                  label={
                    <Text size="xs" c="dimmed" fw={500}>
                      {dateLabel}
                    </Text>
                  }
                  labelPosition="center"
                  my="sm"
                />
              )}
              {showAvatar &&
                !showDateSeparator &&
                timeSincePrev >= TIME_GAP_MINUTES && <Box mt="xs" />}
              <MessageBubble
                message={msg}
                showAvatar={showAvatar}
                showTime={showTime}
                showInlineTime={!isMobile}
                onEdit={onEdit}
                onUnsend={onUnsend}
              />
            </Box>
          )
        })}
      </Stack>
    </div>
  )
})

function ChatArea({
  conversation,

  onSendMessage,

  onBack,

  onParticipantsAdded,

  onLeave,

  onMessageUpdated,

  onMessageDeleted,

  isMobile,
}: ChatAreaProps) {
  const location = useLocation()

  const [message, setMessage] = useState("")

  const [attachments, setAttachments] = useState<File[]>([])

  const [mentionedUserIds, setMentionedUserIds] = useState<number[]>([])

  const [isSending, setIsSending] = useState(false)

  const [
    addParticipantsOpened,

    { open: openAddParticipants, close: closeAddParticipants },
  ] = useDisclosure(false)

  const [
    leaveConfirmOpened,

    { open: openLeaveConfirm, close: closeLeaveConfirm },
  ] = useDisclosure(false)

  const [
    participantsPopoverOpened,

    { toggle: toggleParticipantsPopover, close: closeParticipantsPopover },
  ] = useDisclosure(false)

  const [renameOpened, { open: openRename, close: closeRename }] =
    useDisclosure(false)

  const [renameName, setRenameName] = useState(conversation.name || "")

  const renameInputRef = useRef<HTMLInputElement>(null)

  const [isRenaming, setIsRenaming] = useState(false)

  const queryClient = useQueryClient()

  const scrollRef = useRef<HTMLDivElement>(null)

  const prevConversationIdRef = useRef<number | null>(null)

  const highlightedHashRef = useRef<string | null>(null)

  const addParticipantsMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      messagingApi.addParticipants(conversation.id, userIds),

    onSuccess: () => {
      closeAddParticipants()

      onParticipantsAdded?.()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke tilføje deltagere")
    },
  })

  const otherParticipants = conversation.other_participants ?? []

  const allParticipants = conversation.participants ?? []

  const isGroupChat = otherParticipants.length > 1

  const hasNoParticipants = otherParticipants.length === 0

  const displayName = conversation.name
    ? conversation.name
    : hasNoParticipants
      ? "Slettet bruger"
      : otherParticipants

          .map((p) => `${p.first_name} ${p.last_name}`)

          .join(", ")

  const handleRename = async () => {
    setIsRenaming(true)

    try {
      await messagingApi.renameConversation(conversation.id, renameName.trim())

      queryClient.invalidateQueries({
        queryKey: ["conversation", conversation.id],
      })

      queryClient.invalidateQueries({ queryKey: ["conversations"] })

      closeRename()
    } catch (error) {
      showErrorNotification(error, "Kunne ikke omdøbe samtalen")
    } finally {
      setIsRenaming(false)
    }
  }

  // Scroll to bottom when opening a conversation (instant) or when new messages arrive (smooth)

  useEffect(() => {
    if (scrollRef.current) {
      const isNewConversation =
        prevConversationIdRef.current !== conversation.id

      // If navigating with a hash fragment, scroll to that message instead

      if (location.hash && highlightedHashRef.current !== location.hash) {
        highlightedHashRef.current = location.hash

        const timer = setTimeout(() => {
          const el = document.getElementById(location.hash.slice(1))

          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" })

            el.style.transition = "box-shadow 0.3s ease"

            el.style.boxShadow = "0 0 0 3px var(--mantine-color-blue-4)"

            setTimeout(() => {
              el.style.boxShadow = ""
            }, 2000)
          }
        }, 100)

        prevConversationIdRef.current = conversation.id

        return () => clearTimeout(timer)
      }

      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,

        behavior: isNewConversation ? "auto" : "smooth",
      })

      prevConversationIdRef.current = conversation.id
    }
  }, [conversation.id, conversation.messages, location.hash])

  const handleSend = async () => {
    const textContent = message.trim()

    if ((!textContent && attachments.length === 0) || isSending) return

    setIsSending(true)

    const messageContent = message

    const messageAttachments = [...attachments]

    const messageMentions = [...mentionedUserIds]

    setMessage("") // Clear immediately for better UX

    setAttachments([])

    setMentionedUserIds([])

    clearDraft("msg-" + conversation.id)

    try {
      await onSendMessage(messageContent, messageAttachments, messageMentions)
    } catch (error) {
      // Restore message, attachments, and mentions if send failed

      setMessage(messageContent)

      setAttachments(messageAttachments)

      setMentionedUserIds(messageMentions)

      console.error("Failed to send message:", error)
    } finally {
      setIsSending(false)
    }
  }

  const handleDrop = (files: File[]) => {
    const { validFiles, errors } = filterFilesBySize(files)

    for (const error of errors) {
      notifications.show({ color: "red", message: error })
    }

    if (validFiles.length > 0) {
      setAttachments((prev) => [...prev, ...validFiles])
    }
  }

  return (
    <FileDropzone
      onDrop={handleDrop}
      style={{
        flex: 1,

        display: "flex",

        flexDirection: "column",

        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        p="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap="sm" justify="space-between" wrap="nowrap">
          <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
            {onBack && (
              <ActionIcon variant="subtle" onClick={onBack} size="lg">
                <IconArrowLeft size={20} />
              </ActionIcon>
            )}
            <Popover
              opened={participantsPopoverOpened}
              onClose={closeParticipantsPopover}
              position="bottom-start"
              shadow="md"
              withinPortal
            >
              <Popover.Target>
                <UnstyledButton
                  onClick={toggleParticipantsPopover}
                  style={{
                    display: "flex",

                    alignItems: "center",

                    gap: 8,

                    minWidth: 0,

                    flex: 1,
                  }}
                >
                  {isGroupChat ? (
                    <Avatar.Group spacing="sm" style={{ flexShrink: 0 }}>
                      {otherParticipants.slice(0, 3).map((p) => (
                        <Avatar
                          key={p.id}
                          src={p.profile_picture}
                          radius="xl"
                          size="md"
                        >
                          {p.first_name?.[0]}
                        </Avatar>
                      ))}
                      {otherParticipants.length > 3 && (
                        <Avatar radius="xl" size="md">
                          +{otherParticipants.length - 3}
                        </Avatar>
                      )}
                    </Avatar.Group>
                  ) : (
                    <Avatar
                      src={otherParticipants[0]?.profile_picture}
                      radius="xl"
                      size="md"
                      style={{ flexShrink: 0 }}
                    >
                      {otherParticipants[0]?.first_name?.[0]}
                    </Avatar>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <Text
                      fw={500}
                      truncate
                      c={hasNoParticipants ? "dimmed" : undefined}
                      fs={hasNoParticipants ? "italic" : undefined}
                    >
                      {displayName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {allParticipants.length} deltagere
                    </Text>
                  </div>
                </UnstyledButton>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  {allParticipants.map((p) => (
                    <Group key={p.id} gap="sm" wrap="nowrap">
                      <Avatar src={p.profile_picture} radius="xl" size="sm">
                        {p.first_name?.[0]}
                      </Avatar>
                      <Text size="sm">
                        {p.first_name} {p.last_name}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Popover.Dropdown>
            </Popover>
          </Group>
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="lg">
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconPencil size={16} />}
                onClick={() => {
                  setRenameName(conversation.name || "")

                  openRename()
                }}
              >
                Omdøb samtale
              </Menu.Item>
              <Menu.Item
                leftSection={<IconUserPlus size={16} />}
                onClick={openAddParticipants}
              >
                Tilføj personer
              </Menu.Item>
              {allParticipants.length > 2 && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    leftSection={<IconLogout size={16} />}
                    color="red"
                    onClick={openLeaveConfirm}
                  >
                    Forlad samtale
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Box>

      <UserPickerModal
        opened={addParticipantsOpened}
        onClose={closeAddParticipants}
        title="Tilføj deltagere"
        confirmLabel="Tilføj"
        excludeUserIds={allParticipants.map((p) => p.id)}
        loading={addParticipantsMutation.isPending}
        onConfirm={(ids) => addParticipantsMutation.mutate(ids)}
      />

      <Modal
        opened={leaveConfirmOpened}
        onClose={closeLeaveConfirm}
        title="Forlad samtale"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Er du sikker på, at du vil forlade denne samtale? Du vil ikke
            længere kunne se beskeder i samtalen.
          </Text>
          <Group justify="flex-end">
            <Button variant="light" onClick={closeLeaveConfirm}>
              Annuller
            </Button>
            <Button
              color="red"
              onClick={() => {
                closeLeaveConfirm()

                onLeave?.()
              }}
            >
              Forlad
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={renameOpened}
        onClose={closeRename}
        title="Omdøb samtale"
        size="sm"
        onEnterTransitionEnd={() => renameInputRef.current?.focus()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()

            handleRename()
          }}
        >
          <Stack gap="md">
            <TextInput
              ref={renameInputRef}
              label="Samtalens navn"
              description="Tøm feltet for at vise deltagernavne i stedet"
              placeholder="Indtast et navn..."
              value={renameName}
              onChange={(e) => setRenameName(e.currentTarget.value)}
              maxLength={100}
            />
            <Group justify="flex-end">
              <Button variant="light" onClick={closeRename}>
                Annuller
              </Button>
              <Button type="submit" loading={isRenaming}>
                Gem
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Messages */}
      <MessageList
        messages={conversation.messages}
        isMobile={isMobile}
        onEdit={onMessageUpdated}
        onUnsend={onMessageDeleted}
        scrollViewportRef={scrollRef}
      />

      {/* Input */}
      <Box
        py="sm"
        px={isMobile ? 4 : "md"}
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      >
        <ChatRichTextEditor
          content={message}
          onChange={setMessage}
          onSend={handleSend}
          placeholder="Skriv en besked..."
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onMentionedUsersChange={setMentionedUserIds}
          mentionableUsers={otherParticipants}
          draftKey={"msg-" + conversation.id}
        />
      </Box>
    </FileDropzone>
  )
}

type MessageSegment = {
  type: "text" | "link"

  value: string
}

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g

function isGiphyMediaUrl(url: string): boolean {
  try {
    return /^media\d*\.giphy\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function truncateUrl(url: string, maxLen = 40): string {
  try {
    const parsed = new URL(url)

    const display = parsed.hostname + parsed.pathname

    if (display.length <= maxLen) return display

    return display.slice(0, maxLen) + "…"
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "…" : url
  }
}

function MessageContent({
  content,

  isOwn,
}: {
  content: string

  isOwn: boolean
}) {
  const parts: MessageSegment[] = []

  let lastIndex = 0

  for (const match of content.matchAll(URL_REGEX)) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) })
    }

    parts.push({ type: "link", value: match[0] })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) })
  }

  if (parts.length === 0) return <>{content}</>

  return (
    <>
      {parts.map((part, i) =>
        part.type === "link" && isGiphyMediaUrl(part.value) ? (
          <img
            key={i}
            src={part.value}
            alt="GIF"
            style={{
              maxWidth: "200px",

              borderRadius: "var(--mantine-radius-sm)",

              display: "block",

              marginTop: 4,

              marginBottom: 4,
            }}
          />
        ) : part.type === "link" ? (
          <Anchor
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: isOwn ? "white" : undefined,

              textDecoration: "underline",
            }}
          >
            {truncateUrl(part.value)}
          </Anchor>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  )
}

interface MessageBubbleProps {
  message: Message

  showAvatar: boolean

  showTime: boolean

  showInlineTime?: boolean

  onEdit?: (messageId: number, content: string, editedAt: string) => void

  onUnsend?: (messageId: number) => void
}

function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(filename)
}

const MessageBubble = memo(function MessageBubble({
  message,

  showAvatar,

  showTime,

  showInlineTime,

  onEdit,

  onUnsend,
}: MessageBubbleProps) {
  const [carouselOpened, setCarouselOpened] = useState(false)

  const [carouselInitialIndex, setCarouselInitialIndex] = useState(0)

  const [menuOpened, setMenuOpened] = useState(false)

  const [reactionPickerOpened, setReactionPickerOpened] = useState(false)

  const [fullEmojiPickerOpened, setFullEmojiPickerOpened] = useState(false)

  const [emojiData, setEmojiData] = useState<object | null>(null)

  const [isHovered, setIsHovered] = useState(false)

  const [isEditing, setIsEditing] = useState(false)

  const [editContent, setEditContent] = useState(message.content)

  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const isMobileDevice = useMediaQuery("(max-width: 768px)")

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reactionMutation = useMutation({
    mutationFn: (reactionType: ReactionType) =>
      messagingApi.toggleMessageReaction(message.id, reactionType),

    onSuccess: () => {
      setReactionPickerOpened(false)

      setFullEmojiPickerOpened(false)
    },

    onError: (error: unknown) =>
      showErrorNotification(error, "Kunne ikke tilføje reaktion"),
  })

  const handleTouchStart = () => {
    if (message.is_deleted || message.is_system_message) return

    longPressTimer.current = setTimeout(() => {
      setReactionPickerOpened(true)
    }, 500)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)

      longPressTimer.current = null
    }
  }

  const handleCopy = () => {
    const plainText = message.content

      .replace(/<\/[^>]+>/g, " ")

      .replace(/<[^>]*>/g, "")

      .replace(/\s+/g, " ")

      .trim()

    navigator.clipboard.writeText(plainText).catch(() => {})
  }

  const handleStartEdit = () => {
    setEditContent(message.content)

    setIsEditing(true)
  }

  const handleSaveEdit = async () => {
    const trimmed = editContent.trim()

    if (!trimmed || isSavingEdit) return

    setIsSavingEdit(true)

    try {
      const updated = await messagingApi.editMessage(message.id, trimmed)

      onEdit?.(
        message.id,

        updated.content,

        updated.edited_at ?? new Date().toISOString(),
      )

      setIsEditing(false)
    } catch (error) {
      showErrorNotification(error, "Kunne ikke redigere besked")
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleUnsend = async () => {
    try {
      await messagingApi.unsendMessage(message.id)

      onUnsend?.(message.id)
    } catch (error) {
      showErrorNotification(error, "Kunne ikke fortryde afsendelse")
    }
  }

  // Render system messages differently

  if (message.is_system_message) {
    return (
      <Center py="xs">
        <Text size="sm" c="dimmed" ta="center">
          {message.content}
        </Text>
      </Center>
    )
  }

  // Render deleted messages as a placeholder

  if (message.is_deleted) {
    const isOwn = message.is_own

    return (
      <Group
        id={`msg-${message.id}`}
        justify={isOwn ? "flex-end" : "flex-start"}
        gap="xs"
        align="flex-end"
        wrap="nowrap"
      >
        {!isOwn && (
          <Avatar
            src={message.sender.profile_picture}
            radius="xl"
            size="sm"
            style={{ visibility: showAvatar ? "visible" : "hidden" }}
          >
            {message.sender.first_name?.[0]}
          </Avatar>
        )}
        <Paper
          p="xs"
          radius="lg"
          style={{
            backgroundColor: "var(--mantine-color-default-hover)",

            border: "1px dashed var(--mantine-color-default-border)",
          }}
        >
          <Text size="sm" c="dimmed" fs="italic">
            Besked slettet
          </Text>
        </Paper>
      </Group>
    )
  }

  const isOwn = message.is_own

  const hasContent = message.content.trim().length > 0

  const hasAttachments = message.attachments && message.attachments.length > 0

  // Sort attachments: images first, then other files

  const imageAttachments =
    message.attachments?.filter((att) => isImageFile(att.name)) || []

  const otherAttachments =
    message.attachments?.filter((att) => !isImageFile(att.name)) || []

  const allAttachments = [...imageAttachments, ...otherAttachments]

  const handleAttachmentClick = (attachment: MessageAttachment) => {
    const index = allAttachments.findIndex((att) => att.id === attachment.id)

    setCarouselInitialIndex(index >= 0 ? index : 0)

    setCarouselOpened(true)
  }

  const menuVisible = isMobileDevice || isHovered || menuOpened

  const menuButton = (
    <Menu
      opened={menuOpened}
      onChange={setMenuOpened}
      position={isOwn ? "left" : "right"}
      withArrow
      withinPortal
    >
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="sm"
          color="gray"
          style={{
            opacity: menuVisible ? 1 : 0,

            pointerEvents: menuVisible ? "auto" : "none",

            transition: "opacity 0.1s",

            flexShrink: 0,
          }}
          onMouseDown={(e) => e.preventDefault()}
          aria-label="Beskedindstillinger"
          aria-hidden={!menuVisible}
          tabIndex={menuVisible ? 0 : -1}
        >
          <IconDots size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {isOwn && (
          <Menu.Item
            leftSection={<IconEdit size={14} />}
            onClick={handleStartEdit}
          >
            Rediger
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={handleCopy}>
          Kopiér
        </Menu.Item>
        {isOwn && (
          <>
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={handleUnsend}
            >
              Fortryd afsendelse
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  )

  const handleOpenFullEmojiPicker = () => {
    if (!emojiData) {
      emojiDataPromise().then(setEmojiData)
    }

    setReactionPickerOpened(false)

    setFullEmojiPickerOpened((o) => !o)
  }

  const handleFullEmojiSelect = (emoji: EmojiPickerData) => {
    reactionMutation.mutate(emoji.native)
  }

  const reactionVisible =
    isHovered || reactionPickerOpened || fullEmojiPickerOpened

  const emojiPickerButton = (
    <>
      <Popover
        opened={reactionPickerOpened}
        onChange={setReactionPickerOpened}
        position="top"
        withArrow
        withinPortal
      >
        <Popover.Target>
          <ActionIcon
            variant="subtle"
            size="sm"
            color="gray"
            style={{
              display: isMobileDevice ? "none" : undefined,

              opacity: reactionVisible ? 1 : 0,

              pointerEvents: reactionVisible ? "auto" : "none",

              transition: "opacity 0.1s",

              flexShrink: 0,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setFullEmojiPickerOpened(false)

              setReactionPickerOpened((o) => !o)
            }}
            aria-label="Tilføj reaktion"
            aria-hidden={!reactionVisible}
            tabIndex={reactionVisible ? 0 : -1}
          >
            <IconMoodSmile size={14} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <Group gap={4}>
            {DEFAULT_EMOJIS.map((emoji) => {
              const existing = (message.reactions ?? []).find(
                (r) => r.reaction_type === emoji,
              )

              return (
                <ActionIcon
                  key={emoji}
                  variant={existing?.has_reacted ? "filled" : "subtle"}
                  color={existing?.has_reacted ? "blue" : "gray"}
                  size="lg"
                  onClick={() => reactionMutation.mutate(emoji)}
                  loading={
                    reactionMutation.isPending &&
                    reactionMutation.variables === emoji
                  }
                >
                  <Text size="lg">{emoji}</Text>
                </ActionIcon>
              )
            })}
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={handleOpenFullEmojiPicker}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Group>
        </Popover.Dropdown>
      </Popover>
      <Popover
        opened={fullEmojiPickerOpened}
        onChange={setFullEmojiPickerOpened}
        position="top"
        width="auto"
        shadow="md"
        withinPortal
      >
        <Popover.Target>
          <Box style={{ width: 0, height: 0 }} />
        </Popover.Target>
        <Popover.Dropdown p={0} style={{ border: "none", background: "none" }}>
          {fullEmojiPickerOpened && (
            <Suspense fallback={<Loader size="sm" m="md" />}>
              <LazyPicker
                data={emojiData}
                onEmojiSelect={handleFullEmojiSelect}
                locale="da"
                theme="light"
                previewPosition="none"
                skinTonePosition="search"
                searchPosition="sticky"
                navPosition="top"
                perLine={9}
                emojiSize={22}
                emojiButtonSize={32}
                maxFrequentRows={2}
              />
            </Suspense>
          )}
        </Popover.Dropdown>
      </Popover>
    </>
  )

  // Mobile reaction picker — anchor is fixed bottom-right so popup always appears on-screen

  const mobileReactionPicker = isMobileDevice && (
    <Popover
      opened={reactionPickerOpened}
      onChange={setReactionPickerOpened}
      position="top-end"
      withArrow
      withinPortal
    >
      <Popover.Target>
        <Box
          style={{
            position: "fixed",

            bottom: 80,

            right: 16,

            width: 1,

            height: 1,
          }}
        />
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Group gap={2}>
          {DEFAULT_EMOJIS.map((emoji) => {
            const existing = (message.reactions ?? []).find(
              (r) => r.reaction_type === emoji,
            )

            return (
              <ActionIcon
                key={emoji}
                variant={existing?.has_reacted ? "filled" : "subtle"}
                color={existing?.has_reacted ? "blue" : "gray"}
                size="md"
                onClick={() => reactionMutation.mutate(emoji)}
                loading={
                  reactionMutation.isPending &&
                  reactionMutation.variables === emoji
                }
              >
                <Text size="md">{emoji}</Text>
              </ActionIcon>
            )
          })}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            onClick={() => {
              setReactionPickerOpened(false)

              handleOpenFullEmojiPicker()
            }}
          >
            <IconDots size={16} />
          </ActionIcon>
        </Group>
        <Divider my="xs" />
        <Stack gap={0}>
          <UnstyledButton
            px="xs"
            py={6}
            style={{ borderRadius: "var(--mantine-radius-sm)" }}
            onClick={() => {
              handleCopy()

              setReactionPickerOpened(false)
            }}
          >
            <Group gap="xs">
              <IconCopy size={14} color="var(--mantine-color-dimmed)" />
              <Text size="sm">Kopiér</Text>
            </Group>
          </UnstyledButton>
          {isOwn && (
            <UnstyledButton
              px="xs"
              py={6}
              style={{ borderRadius: "var(--mantine-radius-sm)" }}
              onClick={() => {
                handleStartEdit()

                setReactionPickerOpened(false)
              }}
            >
              <Group gap="xs">
                <IconEdit size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm">Rediger</Text>
              </Group>
            </UnstyledButton>
          )}
          {isOwn && (
            <UnstyledButton
              px="xs"
              py={6}
              style={{ borderRadius: "var(--mantine-radius-sm)" }}
              onClick={() => {
                void handleUnsend()

                setReactionPickerOpened(false)
              }}
            >
              <Group gap="xs">
                <IconTrash size={14} color="var(--mantine-color-red-6)" />
                <Text size="sm" c="red">
                  Fortryd afsendelse
                </Text>
              </Group>
            </UnstyledButton>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )

  if (isEditing) {
    return (
      <Stack
        id={`msg-${message.id}`}
        gap="xs"
        ref={(el) =>
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
      >
        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={20}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()

              void handleSaveEdit()
            }

            if (e.key === "Escape") {
              setIsEditing(false)
            }
          }}
        />
        <Group gap="xs" justify="flex-end">
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setIsEditing(false)}
          >
            Annuller
          </Button>
          <Button
            size="xs"
            loading={isSavingEdit}
            onClick={() => void handleSaveEdit()}
          >
            Gem
          </Button>
        </Group>
      </Stack>
    )
  }

  return (
    <>
      <Group
        id={`msg-${message.id}`}
        justify={isOwn ? "flex-end" : "flex-start"}
        gap="xs"
        align="flex-end"
        wrap="nowrap"
        style={{ position: "relative" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={(e) => {
          e.preventDefault()

          setMenuOpened(true)
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        {!isOwn && (
          <Avatar
            src={message.sender.profile_picture}
            radius="xl"
            size="sm"
            style={{ visibility: showAvatar ? "visible" : "hidden" }}
          >
            {message.sender.first_name?.[0]}
          </Avatar>
        )}

        {/* Emoji + menu buttons appear to the left for own messages (desktop only) */}
        {isOwn && emojiPickerButton}
        {isOwn && !isMobileDevice && menuButton}

        <Box style={{ maxWidth: "70%", minWidth: 0, overflow: "hidden" }}>
          {hasAttachments && (
            <Stack
              gap="xs"
              mb={hasContent ? "xs" : 0}
              align={isOwn ? "flex-end" : "flex-start"}
              style={{ width: "100%" }}
            >
              {imageAttachments.map((attachment) => (
                <Box
                  key={attachment.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => handleAttachmentClick(attachment)}
                >
                  <Image
                    src={attachment.file_url}
                    alt={attachment.name}
                    radius="md"
                    maw={200}
                    mah={200}
                    fit="contain"
                    style={{ display: "block" }}
                  />
                </Box>
              ))}
              {otherAttachments.map((attachment) => {
                const FileIcon = getFileIcon(attachment.name)

                const iconColor = getFileTypeColor(attachment.name)

                return (
                  <Paper
                    key={attachment.id}
                    p="xs"
                    radius="md"
                    withBorder
                    style={{
                      display: "inline-flex",

                      alignItems: "center",

                      gap: 8,

                      cursor: "pointer",

                      maxWidth: "100%",
                    }}
                    onClick={() => handleAttachmentClick(attachment)}
                  >
                    <FileIcon
                      size={20}
                      color={`var(--mantine-color-${iconColor}-6)`}
                      style={{ flexShrink: 0 }}
                    />
                    <Text size="sm" truncate style={{ minWidth: 0 }}>
                      {attachment.name}
                    </Text>
                  </Paper>
                )
              })}
            </Stack>
          )}
          {showInlineTime && !hasContent && hasAttachments && (
            <Group gap={4} justify={isOwn ? "flex-end" : "flex-start"} mt={2}>
              {showTime &&
                isOwn &&
                (message.is_read ? (
                  <IconChecks size={14} color="var(--mantine-color-blue-6)" />
                ) : (
                  <IconCheck size={14} color="gray" />
                ))}
              <Text size="xs" c="dimmed">
                {dayjs(message.created_at).format("HH:mm")}
              </Text>
              {showTime && message.edited_at && (
                <Text size="xs" c="dimmed">
                  (redigeret)
                </Text>
              )}
            </Group>
          )}
          {hasContent && (
            <Box
              style={{
                display: "flex",

                justifyContent: isOwn ? "flex-end" : "flex-start",

                alignItems: "flex-end",

                gap: 6,
              }}
            >
              {showInlineTime && isOwn && (
                <Group gap={4} style={{ flexShrink: 0, alignSelf: "flex-end" }}>
                  {showTime &&
                    isOwn &&
                    (message.is_read ? (
                      <IconChecks
                        size={14}
                        color="var(--mantine-color-blue-6)"
                      />
                    ) : (
                      <IconCheck size={14} color="gray" />
                    ))}
                  <Text size="xs" c="dimmed" style={{ lineHeight: "20px" }}>
                    {dayjs(message.created_at).format("HH:mm")}
                  </Text>
                  {showTime && message.edited_at && (
                    <Text size="xs" c="dimmed" style={{ lineHeight: "20px" }}>
                      (redigeret)
                    </Text>
                  )}
                </Group>
              )}
              <Paper
                p="xs"
                radius="lg"
                style={{
                  backgroundColor: isOwn
                    ? "var(--mantine-color-blue-6)"
                    : "var(--mantine-color-default-hover)",
                }}
              >
                <Text
                  size="sm"
                  style={{
                    color: isOwn ? "white" : "inherit",

                    whiteSpace: "pre-wrap",

                    overflowWrap: "anywhere",
                  }}
                >
                  <MessageContent content={message.content} isOwn={isOwn} />
                </Text>
              </Paper>
              {showInlineTime && !isOwn && (
                <Group gap={4} style={{ flexShrink: 0, alignSelf: "flex-end" }}>
                  <Text size="xs" c="dimmed" style={{ lineHeight: "20px" }}>
                    {dayjs(message.created_at).format("HH:mm")}
                  </Text>
                  {showTime && message.edited_at && (
                    <Text size="xs" c="dimmed" style={{ lineHeight: "20px" }}>
                      (redigeret)
                    </Text>
                  )}
                </Group>
              )}
            </Box>
          )}
          {showTime && !showInlineTime && (
            <Group gap={4} justify={isOwn ? "flex-end" : "flex-start"} mt={2}>
              <Text size="xs" c="dimmed">
                {dayjs(message.created_at).format("HH:mm")}
                {message.edited_at && (
                  <Text span size="xs" c="dimmed" ml={4}>
                    (redigeret)
                  </Text>
                )}
              </Text>
              {isOwn &&
                (message.is_read ? (
                  <IconChecks size={14} color="var(--mantine-color-blue-6)" />
                ) : (
                  <IconCheck size={14} color="gray" />
                ))}
            </Group>
          )}
        </Box>

        {/* Menu + emoji buttons appear to the right for others' messages (desktop only) */}
        {!isOwn && !isMobileDevice && menuButton}
        {!isOwn && emojiPickerButton}

        {/* Mobile long-press reaction picker */}
        {mobileReactionPicker}
      </Group>

      {/* Reactions display */}
      {(message.reactions ?? []).length > 0 && (
        <Group
          gap={4}
          mt={2}
          justify={isOwn ? "flex-end" : "flex-start"}
          style={{ paddingLeft: !isOwn ? 28 : 0 }}
        >
          {(message.reactions ?? []).map((reaction) => (
            <UnstyledButton
              key={reaction.reaction_type}
              onClick={() => reactionMutation.mutate(reaction.reaction_type)}
              disabled={reactionMutation.isPending}
            >
              <Box
                px="xs"
                py={2}
                style={{
                  display: "inline-flex",

                  alignItems: "center",

                  gap: 4,

                  borderRadius: "var(--mantine-radius-xl)",

                  backgroundColor: reaction.has_reacted
                    ? "var(--mantine-color-blue-light)"
                    : "var(--mantine-color-default-hover)",

                  border: `1px solid ${
                    reaction.has_reacted
                      ? "var(--mantine-color-blue-light-color)"
                      : "var(--mantine-color-default-border)"
                  }`,

                  cursor: "pointer",
                }}
              >
                <Text size="xs" lh={1}>
                  {reaction.emoji}
                </Text>
                <Text
                  size="xs"
                  fw={600}
                  c={reaction.has_reacted ? "blue.7" : "gray.7"}
                >
                  {reaction.count}
                </Text>
              </Box>
            </UnstyledButton>
          ))}
        </Group>
      )}

      {hasAttachments && (
        <AttachmentCarousel
          attachments={allAttachments}
          opened={carouselOpened}
          onClose={() => setCarouselOpened(false)}
          initialIndex={carouselInitialIndex}
        />
      )}
    </>
  )
})

interface NewConversationAreaProps {
  onBack?: () => void

  onSuccess: (conversationId: number) => void
}

function NewConversationArea({ onBack, onSuccess }: NewConversationAreaProps) {
  const { user: currentUser } = useAuthStore()

  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")

  const [selectedUsers, setSelectedUsers] = useState<User[]>([])

  const [message, setMessage] = useState("")

  const [attachments, setAttachments] = useState<File[]>([])

  const [isSearchFocused, setIsSearchFocused] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Fetch users for search

  const { data: users } = useQuery({
    queryKey: ["users"],

    queryFn: async () => {
      const response = await apiClient.get("/users/")

      return (response.data.results ?? response.data) as User[]
    },
  })

  const createMutation = useMutation({
    mutationFn: messagingApi.createConversation,

    onSuccess: (data) => {
      // Seed the conversation cache with the full response so messages are

      // visible immediately when navigating to the conversation, without

      // waiting for a separate fetch or WebSocket event.

      queryClient.setQueryData<ConversationDetail>(
        ["conversation", data.id],

        data,
      )

      queryClient.invalidateQueries({ queryKey: ["conversations"] })

      onSuccess(data.id)
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke starte samtale")
    },
  })

  const searchTerm = search.trim().toLowerCase()

  const filteredUsers = users?.filter((u) => {
    if (u.id === currentUser?.id) return false

    if (selectedUsers.some((s) => s.id === u.id)) return false

    if (!searchTerm) return true

    const firstName = (u.first_name || "").toLowerCase()

    const lastName = (u.last_name || "").toLowerCase()

    const fullName = `${firstName} ${lastName}`

    return (
      firstName.includes(searchTerm) ||
      lastName.includes(searchTerm) ||
      fullName.includes(searchTerm)
    )
  })

  const handleSelectUser = (user: User) => {
    setSelectedUsers((prev) => [...prev, user])

    setSearch("")

    searchInputRef.current?.focus()
  }

  const handleRemoveUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  const handleSend = async () => {
    if (selectedUsers.length === 0) return

    createMutation.mutate({
      participant_ids: selectedUsers.map((u) => u.id),

      initial_message: message.trim() || undefined,

      attachments: attachments.length > 0 ? attachments : undefined,
    })
  }

  const showDropdown =
    search.trim().length > 0 || (isSearchFocused && selectedUsers.length === 0)

  return (
    <>
      {/* Header with recipient selector */}
      <Box
        p="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap="sm" mb="xs">
          {onBack && (
            <ActionIcon variant="subtle" onClick={onBack} size="lg">
              <IconArrowLeft size={20} />
            </ActionIcon>
          )}
          <Text fw={500} size="lg">
            Ny besked
          </Text>
        </Group>

        {/* Recipient selector */}
        <Box pos="relative">
          <Group gap="xs" align="center" wrap="wrap">
            <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              Til:
            </Text>
            {selectedUsers.map((u) => (
              <Badge
                key={u.id}
                size="lg"
                variant="light"
                leftSection={
                  <Avatar src={u.profile_picture} size={18} radius="xl">
                    {u.first_name?.[0]}
                  </Avatar>
                }
                rightSection={
                  <CloseButton
                    size="xs"
                    variant="transparent"
                    onClick={() => handleRemoveUser(u.id)}
                  />
                }
                styles={{
                  root: { paddingLeft: 4, paddingRight: 2 },

                  section: { marginRight: 2 },
                }}
              >
                {u.first_name}
              </Badge>
            ))}
            <TextInput
              ref={searchInputRef}
              placeholder={
                selectedUsers.length === 0
                  ? "Søg efter personer..."
                  : "Tilføj flere..."
              }
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              variant="unstyled"
              size="sm"
              style={{ flex: 1, minWidth: 120 }}
              styles={{
                input: {
                  minHeight: 28,
                },
              }}
            />
          </Group>

          {/* User search dropdown */}
          {showDropdown && (
            <Paper
              shadow="md"
              withBorder
              pos="absolute"
              top="100%"
              left={0}
              right={0}
              mt="xs"
              style={{ zIndex: 100, maxHeight: 250, overflow: "auto" }}
            >
              {filteredUsers && filteredUsers.length > 0 ? (
                <Stack gap={0}>
                  {filteredUsers.slice(0, 10).map((u) => (
                    <Box
                      key={u.id}
                      p="sm"
                      style={{
                        cursor: "pointer",

                        borderBottom:
                          "1px solid var(--mantine-color-default-border)",
                      }}
                      onMouseDown={() => handleSelectUser(u)}
                    >
                      <Group gap="sm">
                        <Avatar src={u.profile_picture} radius="xl" size="sm">
                          {u.first_name?.[0]}
                          {u.last_name?.[0]}
                        </Avatar>
                        <div>
                          <Text size="sm" fw={500}>
                            {u.first_name} {u.last_name}
                          </Text>
                          {u.house_name && (
                            <Text size="xs" c="dimmed">
                              {u.house_name}
                            </Text>
                          )}
                        </div>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Text c="dimmed" ta="center" py="md" size="sm">
                  {search
                    ? "Ingen brugere fundet"
                    : "Begynd at skrive for at søge"}
                </Text>
              )}
            </Paper>
          )}
        </Box>

        {selectedUsers.length > 0 && (
          <Text size="xs" c="dimmed" mt="xs">
            <IconUserPlus
              size={12}
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />
            Du kan tilføje flere personer for at oprette en gruppesamtale
          </Text>
        )}
      </Box>

      {/* Empty state / instructions */}
      <ScrollArea style={{ flex: 1 }} p="md">
        {selectedUsers.length === 0 ? (
          <Center style={{ height: "100%" }}>
            <Stack align="center" gap="xs">
              <IconMessage size={48} color="gray" />
              <Text c="dimmed" ta="center">
                Vælg en eller flere modtagere ovenfor
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Du kan starte en samtale med én person eller oprette en
                gruppesamtale med flere
              </Text>
            </Stack>
          </Center>
        ) : (
          <Center style={{ height: "100%" }}>
            <Stack align="center" gap="xs">
              <Avatar.Group>
                {selectedUsers.slice(0, 3).map((u) => (
                  <Avatar key={u.id} src={u.profile_picture} radius="xl">
                    {u.first_name?.[0]}
                  </Avatar>
                ))}
                {selectedUsers.length > 3 && (
                  <Avatar radius="xl">+{selectedUsers.length - 3}</Avatar>
                )}
              </Avatar.Group>
              <Text fw={500}>
                {selectedUsers.length === 1
                  ? `Ny samtale med ${selectedUsers[0].first_name}`
                  : `Gruppesamtale med ${selectedUsers.length} personer`}
              </Text>
              <Text size="sm" c="dimmed">
                Skriv din første besked nedenfor
              </Text>
            </Stack>
          </Center>
        )}
      </ScrollArea>

      {/* Message input */}
      <Box
        p="md"
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      >
        <ChatRichTextEditor
          content={message}
          onChange={setMessage}
          onSend={handleSend}
          placeholder="Skriv en besked..."
          disabled={selectedUsers.length === 0 || createMutation.isPending}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </Box>
    </>
  )
}
