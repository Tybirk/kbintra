import { useState, useEffect, useRef } from "react"
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
  TextInput,
  Modal,
  ScrollArea,
  Badge,
  Box,
  Indicator,
  TypographyStylesProvider,
  Image,
  CloseButton,
  ActionIcon,
  Menu,
} from "@mantine/core"
import { useDisclosure, useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
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
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { messagingApi, ChatWebSocket } from "../api/messaging"
import { apiClient, getAccessToken } from "../api/client"
import { useAuthStore } from "../store/authStore"
import type {
  Conversation,
  ConversationDetail,
  Message,
  WsMessage,
  User,
  MessageAttachment,
} from "../types"
import ChatRichTextEditor from "../components/ChatRichTextEditor"
import { getFileIcon, getFileTypeColor } from "../components/FilePreview"
import { AttachmentCarousel } from "../components/AttachmentCarousel"

dayjs.extend(relativeTime)

// Create WebSocket instance
const chatWs = new ChatWebSocket(getAccessToken)

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
  const [isWsConnected, setIsWsConnected] = useState(false)
  const isMobile = useMediaQuery("(max-width: 768px)")

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
  }, [conversationId])

  // Fetch conversations
  const { data: conversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: messagingApi.getConversations,
  })

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

  // Connect WebSocket on mount
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
        if (wsData.message.conversation === selectedConversation) {
          queryClient.setQueryData<ConversationDetail>(
            ["conversation", selectedConversation],
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
        }
      } else if (wsData.type === "messages_read") {
        // Update read status in active conversation
        queryClient.invalidateQueries({
          queryKey: ["conversation", wsData.conversation_id],
        })
      } else if (wsData.type === "new_conversation") {
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      }
    })

    return () => {
      unsubConnection()
      unsubMessage()
      chatWs.disconnect()
    }
  }, [queryClient, selectedConversation])

  // Mark messages as read when viewing conversation
  useEffect(() => {
    if (selectedConversation && activeConversation?.unread_count) {
      chatWs.markRead(selectedConversation)
      // Optimistically update the conversation detail to mark messages as read
      queryClient.setQueryData<ConversationDetail>(
        ["conversation", selectedConversation],
        (old) => {
          if (!old) return old
          return {
            ...old,
            unread_count: 0,
            messages: old.messages.map((msg) => ({
              ...msg,
              is_read: msg.is_own ? msg.is_read : true,
            })),
          }
        },
      )
      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    }
  }, [selectedConversation, activeConversation?.unread_count, queryClient])

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
    } catch {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke forlade samtalen",
        color: "red",
      })
    }
  }

  return (
    <>
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

      <Paper
        withBorder
        radius="md"
        style={{ height: "calc(100vh - 200px)", display: "flex" }}
      >
        {/* Conversation List - hide on mobile when conversation is selected */}
        <Box
          style={{
            width: isMobile ? "100%" : 320,
            borderRight: isMobile
              ? "none"
              : "1px solid var(--mantine-color-gray-3)",
            display:
              isMobile && (selectedConversation || isComposingNew)
                ? "none"
                : "flex",
            flexDirection: "column",
          }}
        >
          <Box
            p="md"
            style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
          >
            <TextInput
              placeholder="Søg i samtaler..."
              leftSection={<IconSearch size={16} />}
              size="sm"
            />
          </Box>
          <ScrollArea style={{ flex: 1 }}>
            {conversationsLoading ? (
              <Center h={200}>
                <Loader size="sm" />
              </Center>
            ) : conversations?.length === 0 ? (
              <Center h={200}>
                <Stack align="center" gap="xs">
                  <IconMessage size={48} color="gray" />
                  <Text c="dimmed" size="sm">
                    Ingen samtaler endnu
                  </Text>
                </Stack>
              </Center>
            ) : (
              conversations?.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isSelected={conv.id === selectedConversation}
                  currentUserId={user?.id}
                  onClick={() => handleSelectConversation(conv.id)}
                />
              ))
            )}
          </ScrollArea>
        </Box>

        {/* Chat Area - hide on mobile when no conversation is selected */}
        <Box
          style={{
            flex: 1,
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
                conversation={activeConversation}
                onBack={
                  isMobile
                    ? () => {
                        setSelectedConversation(null)
                        navigate("/beskeder", { replace: true })
                      }
                    : undefined
                }
                onSendMessage={async (content, attachments) => {
                  const success = await chatWs.sendMessage(
                    selectedConversation,
                    content,
                    attachments,
                  )
                  if (!success) {
                    notifications.show({
                      title: "Fejl",
                      message: "Kunne ikke sende besked. Prøv igen.",
                      color: "red",
                    })
                  } else if (!chatWs.isConnected || attachments.length > 0) {
                    // If we used REST fallback or sent attachments, refresh to get the new message
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
    </>
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
  const otherParticipants = conversation.other_participants
  const isGroupChat = otherParticipants.length > 1
  const displayName =
    otherParticipants.length > 0
      ? otherParticipants.map((p) => p.first_name).join(", ")
      : "Unknown"
  const avatar = otherParticipants[0]

  return (
    <Box
      p="sm"
      style={{
        cursor: "pointer",
        backgroundColor: isSelected ? "var(--mantine-color-blue-0)" : undefined,
        borderBottom: "1px solid var(--mantine-color-gray-2)",
      }}
      onClick={onClick}
    >
      <Group gap="sm" wrap="nowrap">
        <Indicator
          disabled={conversation.unread_count === 0}
          color="blue"
          size={10}
          offset={4}
        >
          {isGroupChat ? (
            <Avatar.Group spacing="sm">
              <Avatar
                src={otherParticipants[0]?.profile_picture}
                radius="xl"
                size="md"
              >
                {otherParticipants[0]?.first_name?.[0]}
              </Avatar>
              <Avatar
                src={otherParticipants[1]?.profile_picture}
                radius="xl"
                size="md"
              >
                {otherParticipants.length > 2
                  ? `+${otherParticipants.length - 1}`
                  : otherParticipants[1]?.first_name?.[0]}
              </Avatar>
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
            <Text fw={conversation.unread_count > 0 ? 600 : 500} truncate>
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
              {conversation.last_message.content.replace(/<[^>]*>/g, "")}
            </Text>
          )}
        </div>
        {conversation.unread_count > 0 && (
          <Badge size="sm" circle>
            {conversation.unread_count}
          </Badge>
        )}
      </Group>
    </Box>
  )
}

interface ChatAreaProps {
  conversation: ConversationDetail
  onSendMessage: (content: string, attachments: File[]) => Promise<void> | void
  onBack?: () => void
  onParticipantsAdded?: () => void
  onLeave?: () => void
}

function ChatArea({
  conversation,
  onSendMessage,
  onBack,
  onParticipantsAdded,
  onLeave,
}: ChatAreaProps) {
  const [message, setMessage] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const [
    addParticipantsOpened,
    { open: openAddParticipants, close: closeAddParticipants },
  ] = useDisclosure(false)
  const [
    leaveConfirmOpened,
    { open: openLeaveConfirm, close: closeLeaveConfirm },
  ] = useDisclosure(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevConversationIdRef = useRef<number | null>(null)

  const otherParticipants = conversation.other_participants
  const displayName =
    otherParticipants.length > 0
      ? otherParticipants
          .map((p) => `${p.first_name} ${p.last_name}`)
          .join(", ")
      : "Unknown"

  // Scroll to bottom when opening a conversation (instant) or when new messages arrive (smooth)
  useEffect(() => {
    if (scrollRef.current) {
      const isNewConversation = prevConversationIdRef.current !== conversation.id
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: isNewConversation ? "auto" : "smooth",
      })
      prevConversationIdRef.current = conversation.id
    }
  }, [conversation.id, conversation.messages])

  const handleSend = async () => {
    const textContent = message.trim()
    if ((!textContent && attachments.length === 0) || isSending) return

    setIsSending(true)
    const messageContent = message
    const messageAttachments = [...attachments]
    setMessage("") // Clear immediately for better UX
    setAttachments([])

    try {
      await onSendMessage(messageContent, messageAttachments)
    } catch (error) {
      // Restore message and attachments if send failed
      setMessage(messageContent)
      setAttachments(messageAttachments)
      console.error("Failed to send message:", error)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      {/* Header */}
      <Box
        p="md"
        style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
      >
        <Group gap="sm" justify="space-between">
          <Group gap="sm">
            {onBack && (
              <ActionIcon variant="subtle" onClick={onBack} size="lg">
                <IconArrowLeft size={20} />
              </ActionIcon>
            )}
            <Avatar
              src={otherParticipants[0]?.profile_picture}
              radius="xl"
              size="md"
            >
              {otherParticipants[0]?.first_name?.[0]}
            </Avatar>
            <div>
              <Text fw={500}>{displayName}</Text>
              <Text size="xs" c="dimmed">
                {conversation.participants.length} deltagere
              </Text>
            </div>
          </Group>
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="lg">
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconUserPlus size={16} />}
                onClick={openAddParticipants}
              >
                Tilføj personer
              </Menu.Item>
              {conversation.participants.length > 2 && (
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

      <AddParticipantsModal
        opened={addParticipantsOpened}
        onClose={closeAddParticipants}
        conversation={conversation}
        onSuccess={() => {
          closeAddParticipants()
          onParticipantsAdded?.()
        }}
      />

      <Modal
        opened={leaveConfirmOpened}
        onClose={closeLeaveConfirm}
        title="Forlad samtale"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Er du sikker på, at du vil forlade denne samtale? Du vil ikke længere
            kunne se beskeder i samtalen.
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

      {/* Messages */}
      <ScrollArea style={{ flex: 1 }} p="md" viewportRef={scrollRef}>
        <Stack gap="sm">
          {conversation.messages.map((msg, idx) => {
            const showAvatar =
              idx === 0 ||
              conversation.messages[idx - 1].sender.id !== msg.sender.id
            const showTime =
              idx === conversation.messages.length - 1 ||
              conversation.messages[idx + 1].sender.id !== msg.sender.id

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                showAvatar={showAvatar}
                showTime={showTime}
              />
            )
          })}
        </Stack>
      </ScrollArea>

      {/* Input */}
      <Box
        p="md"
        style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}
      >
        <ChatRichTextEditor
          content={message}
          onChange={setMessage}
          onSend={handleSend}
          placeholder="Skriv en besked..."
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </Box>
    </>
  )
}

interface MessageBubbleProps {
  message: Message
  showAvatar: boolean
  showTime: boolean
}

function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(filename)
}

function MessageBubble({ message, showAvatar, showTime }: MessageBubbleProps) {
  const [carouselOpened, setCarouselOpened] = useState(false)
  const [carouselInitialIndex, setCarouselInitialIndex] = useState(0)

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

  return (
    <>
      <Group
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
        <Box style={{ maxWidth: "70%" }}>
          {hasAttachments && (
            <Stack
              gap="xs"
              mb={hasContent ? "xs" : 0}
              align={isOwn ? "flex-end" : "flex-start"}
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
                    }}
                    onClick={() => handleAttachmentClick(attachment)}
                  >
                    <FileIcon
                      size={20}
                      color={`var(--mantine-color-${iconColor}-6)`}
                    />
                    <Text size="sm" truncate maw={180}>
                      {attachment.name}
                    </Text>
                  </Paper>
                )
              })}
            </Stack>
          )}
          {hasContent && (
            <Box
              style={{
                display: "flex",
                justifyContent: isOwn ? "flex-end" : "flex-start",
              }}
            >
              <Paper
                p="xs"
                radius="lg"
                style={{
                  backgroundColor: isOwn
                    ? "var(--mantine-color-blue-6)"
                    : "var(--mantine-color-gray-1)",
                  maxWidth: "100%",
                }}
              >
                <TypographyStylesProvider
                  style={{
                    color: isOwn ? "white" : "inherit",
                    fontSize: "var(--mantine-font-size-sm)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div dangerouslySetInnerHTML={{ __html: message.content }} />
                </TypographyStylesProvider>
              </Paper>
            </Box>
          )}
          {showTime && (
            <Group gap={4} justify={isOwn ? "flex-end" : "flex-start"} mt={2}>
              <Text size="xs" c="dimmed">
                {dayjs(message.created_at).format("HH:mm")}
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
      </Group>

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
}

interface NewConversationAreaProps {
  onBack?: () => void
  onSuccess: (conversationId: number) => void
}

function NewConversationArea({ onBack, onSuccess }: NewConversationAreaProps) {
  const { user: currentUser } = useAuthStore()
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
      onSuccess(data.id)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke starte samtale",
        color: "red",
      })
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

  const showDropdown = isSearchFocused && (search || selectedUsers.length === 0)

  return (
    <>
      {/* Header with recipient selector */}
      <Box
        p="md"
        style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
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
                        borderBottom: "1px solid var(--mantine-color-gray-2)",
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
        style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}
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

interface AddParticipantsModalProps {
  opened: boolean
  onClose: () => void
  conversation: ConversationDetail
  onSuccess: () => void
}

function AddParticipantsModal({
  opened,
  onClose,
  conversation,
  onSuccess,
}: AddParticipantsModalProps) {
  const [search, setSearch] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])

  // Get existing participant IDs
  const existingParticipantIds = new Set(
    conversation.participants.map((p) => p.id),
  )

  // Fetch users for search
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await apiClient.get("/users/")
      return (response.data.results ?? response.data) as User[]
    },
    enabled: opened,
  })

  const addMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      messagingApi.addParticipants(conversation.id, userIds),
    onSuccess: () => {
      onSuccess()
      setSearch("")
      setSelectedUsers([])
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke tilføje deltagere",
        color: "red",
      })
    },
  })

  const searchTerm = search.trim().toLowerCase()
  const filteredUsers = users?.filter((u) => {
    // Exclude users already in the conversation
    if (existingParticipantIds.has(u.id)) return false
    // Exclude already selected users
    if (selectedUsers.some((s) => s.id === u.id)) return false
    // If no search term, show all
    if (!searchTerm) return true
    // Search in first name, last name, and full name
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
  }

  const handleRemoveUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  const handleAdd = () => {
    if (selectedUsers.length === 0) return
    addMutation.mutate(selectedUsers.map((u) => u.id))
  }

  const handleClose = () => {
    setSearch("")
    setSelectedUsers([])
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Tilføj deltagere"
      size="md"
    >
      <Stack gap="md">
        {/* Selected users as badges */}
        {selectedUsers.length > 0 && (
          <Group gap="xs">
            {selectedUsers.map((u) => (
              <Badge
                key={u.id}
                size="lg"
                variant="light"
                leftSection={
                  <Avatar src={u.profile_picture} size={20} radius="xl">
                    {u.first_name?.[0]}
                  </Avatar>
                }
                rightSection={
                  <Box
                    component="span"
                    style={{ cursor: "pointer", marginLeft: 4 }}
                    onClick={() => handleRemoveUser(u.id)}
                  >
                    x
                  </Box>
                }
                styles={{
                  root: { paddingLeft: 4, paddingRight: 8 },
                  section: { marginRight: 4 },
                }}
              >
                {u.first_name} {u.last_name}
              </Badge>
            ))}
          </Group>
        )}

        {/* Search and user list */}
        <TextInput
          placeholder="Søg brugere..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <ScrollArea h={200}>
          <Stack gap="xs">
            {filteredUsers?.map((u) => (
              <Paper
                key={u.id}
                p="sm"
                withBorder
                style={{ cursor: "pointer" }}
                onClick={() => handleSelectUser(u)}
              >
                <Group gap="sm">
                  <Avatar src={u.profile_picture} radius="xl" size="md">
                    {u.first_name?.[0]}
                    {u.last_name?.[0]}
                  </Avatar>
                  <div>
                    <Text fw={500}>
                      {u.first_name} {u.last_name}
                    </Text>
                    {u.house_name && (
                      <Text size="xs" c="dimmed">
                        {u.house_name}
                      </Text>
                    )}
                  </div>
                </Group>
              </Paper>
            ))}
            {filteredUsers?.length === 0 && (
              <Text c="dimmed" ta="center" py="md">
                Ingen brugere fundet
              </Text>
            )}
          </Stack>
        </ScrollArea>

        <Group justify="flex-end">
          <Button variant="light" onClick={handleClose}>
            Annuller
          </Button>
          <Button
            onClick={handleAdd}
            loading={addMutation.isPending}
            disabled={selectedUsers.length === 0}
          >
            Tilføj {selectedUsers.length > 0 ? `(${selectedUsers.length})` : ""}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
