import { useState, useEffect, useRef } from "react"
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
  Textarea,
  Modal,
  ScrollArea,
  Badge,
  Box,
  Indicator,
  TypographyStylesProvider,
  Image,
  Anchor,
  FileButton,
  CloseButton,
  ActionIcon,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconPlus,
  IconMessage,
  IconSearch,
  IconCheck,
  IconChecks,
  IconPhoto,
  IconPaperclip,
  IconFile,
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
} from "../types"
import ChatRichTextEditor from "../components/ChatRichTextEditor"
import EmojiPicker from "../components/EmojiPicker"
import { getFileIcon, getFileTypeColor } from "../components/FilePreview"

dayjs.extend(relativeTime)

// Create WebSocket instance
const chatWs = new ChatWebSocket(getAccessToken)

export default function MessagesPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [selectedConversation, setSelectedConversation] =
    useState<number | null>(null)
  const [
    newMessageModalOpened,
    { open: openNewMessageModal, close: closeNewMessageModal },
  ] = useDisclosure(false)
  const [isWsConnected, setIsWsConnected] = useState(false)

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
  }

  const handleNewConversationCreated = (conversationId: number) => {
    closeNewMessageModal()
    chatWs.joinConversation(conversationId)
    setSelectedConversation(conversationId)
    queryClient.invalidateQueries({ queryKey: ["conversations"] })
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
          onClick={openNewMessageModal}
        >
          Ny besked
        </Button>
      </Group>

      <Paper
        withBorder
        radius="md"
        style={{ height: "calc(100vh - 200px)", display: "flex" }}
      >
        {/* Conversation List */}
        <Box
          style={{
            width: 320,
            borderRight: "1px solid var(--mantine-color-gray-3)",
            display: "flex",
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

        {/* Chat Area */}
        <Box style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {selectedConversation ? (
            conversationLoading ? (
              <Center style={{ flex: 1 }}>
                <Loader size="lg" />
              </Center>
            ) : activeConversation ? (
              <ChatArea
                conversation={activeConversation}
                onSendMessage={async (content, attachments) => {
                  const success = await chatWs.sendMessage(selectedConversation, content, attachments)
                  if (!success) {
                    notifications.show({
                      title: "Fejl",
                      message: "Kunne ikke sende besked. Prøv igen.",
                      color: "red",
                    })
                  } else if (!chatWs.isConnected || attachments.length > 0) {
                    // If we used REST fallback or sent attachments, refresh to get the new message
                    queryClient.invalidateQueries({ queryKey: ["conversation", selectedConversation] })
                    queryClient.invalidateQueries({ queryKey: ["conversations"] })
                  }
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

      <NewMessageModal
        opened={newMessageModalOpened}
        onClose={closeNewMessageModal}
        onSuccess={handleNewConversationCreated}
      />
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
              <Avatar src={otherParticipants[0]?.profile_picture} radius="xl" size="md">
                {otherParticipants[0]?.first_name?.[0]}
              </Avatar>
              <Avatar src={otherParticipants[1]?.profile_picture} radius="xl" size="md">
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
}

function ChatArea({ conversation, onSendMessage }: ChatAreaProps) {
  const [message, setMessage] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const otherParticipants = conversation.other_participants
  const displayName =
    otherParticipants.length > 0
      ? otherParticipants
          .map((p) => `${p.first_name} ${p.last_name}`)
          .join(", ")
      : "Unknown"

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }, [conversation.messages])

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
        <Group gap="sm">
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
      </Box>

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
  const isOwn = message.is_own
  const hasContent = message.content.trim().length > 0
  const hasAttachments = message.attachments && message.attachments.length > 0

  return (
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
          <Stack gap="xs" mb={hasContent ? "xs" : 0} align={isOwn ? "flex-end" : "flex-start"}>
            {message.attachments.map((attachment) => {
              const FileIcon = getFileIcon(attachment.name)
              const iconColor = getFileTypeColor(attachment.name)
              return (
                <Box key={attachment.id}>
                  {isImageFile(attachment.name) ? (
                    <Anchor href={attachment.file_url} target="_blank">
                      <Image
                        src={attachment.file_url}
                        alt={attachment.name}
                        radius="md"
                        maw={200}
                        mah={200}
                        fit="contain"
                        style={{ display: "block" }}
                      />
                    </Anchor>
                  ) : (
                    <Anchor
                      href={attachment.file_url}
                      target="_blank"
                      underline="hover"
                    >
                      <Paper
                        p="xs"
                        radius="md"
                        withBorder
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <FileIcon size={20} color={`var(--mantine-color-${iconColor}-6)`} />
                        <Text size="sm" truncate maw={180}>
                          {attachment.name}
                        </Text>
                      </Paper>
                    </Anchor>
                  )}
                </Box>
              )
            })}
          </Stack>
        )}
        {hasContent && (
          <Box style={{ display: "flex", justifyContent: isOwn ? "flex-end" : "flex-start" }}>
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
  )
}

interface NewMessageModalProps {
  opened: boolean
  onClose: () => void
  onSuccess: (conversationId: number) => void
}

function NewMessageModal({ opened, onClose, onSuccess }: NewMessageModalProps) {
  const { user: currentUser } = useAuthStore()
  const [search, setSearch] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])
  const [message, setMessage] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])

  // Fetch users for search
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await apiClient.get("/users/")
      return (response.data.results ?? response.data) as User[]
    },
    enabled: opened,
  })

  const createMutation = useMutation({
    mutationFn: messagingApi.createConversation,
    onSuccess: (data) => {
      onSuccess(data.id)
      setSearch("")
      setSelectedUsers([])
      setMessage("")
      setAttachments([])
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
    // Exclude current user (can't message yourself)
    if (u.id === currentUser?.id) return false
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

  const handleStart = () => {
    if (selectedUsers.length === 0) return
    createMutation.mutate({
      participant_ids: selectedUsers.map((u) => u.id),
      initial_message: message.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
  }

  const handleFilesSelected = (files: File[]) => {
    setAttachments((prev) => [...prev, ...files])
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClose = () => {
    setSearch("")
    setSelectedUsers([])
    setMessage("")
    setAttachments([])
    onClose()
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Ny besked" size="md">
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
                    ×
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
          placeholder={
            selectedUsers.length > 0
              ? "Tilføj flere deltagere..."
              : "Søg brugere..."
          }
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        {selectedUsers.length === 0 || search ? (
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
        ) : null}

        {/* Message input - show when users are selected */}
        {selectedUsers.length > 0 && !search && (
          <>
            {/* Attachment preview */}
            {attachments.length > 0 && (
              <ScrollArea type="auto" offsetScrollbars scrollbarSize={6}>
                <Group gap="xs" wrap="nowrap" pb={4}>
                  {attachments.map((file, index) => (
                    <Box
                      key={`${file.name}-${index}`}
                      pos="relative"
                      style={{
                        border: "1px solid var(--mantine-color-gray-3)",
                        borderRadius: "var(--mantine-radius-sm)",
                        padding: 4,
                        flexShrink: 0,
                      }}
                    >
                      {file.type.startsWith("image/") ? (
                        <Image
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          w={60}
                          h={60}
                          fit="cover"
                          radius="sm"
                        />
                      ) : (
                        <Box
                          w={60}
                          h={60}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "var(--mantine-color-gray-1)",
                            borderRadius: "var(--mantine-radius-sm)",
                          }}
                        >
                          <IconFile size={20} color="gray" />
                          <Text size="xs" c="dimmed" truncate w={55} ta="center">
                            {file.name}
                          </Text>
                        </Box>
                      )}
                      <CloseButton
                        size="xs"
                        pos="absolute"
                        top={-8}
                        right={-8}
                        onClick={() => handleRemoveFile(index)}
                        style={{
                          backgroundColor: "var(--mantine-color-gray-0)",
                          borderRadius: "50%",
                        }}
                      />
                    </Box>
                  ))}
                </Group>
              </ScrollArea>
            )}

            {/* Message input with attachment buttons */}
            <Group gap="xs" align="flex-start">
              <FileButton onChange={handleFilesSelected} multiple accept="image/*">
                {(props) => (
                  <ActionIcon
                    {...props}
                    variant="subtle"
                    color="gray"
                    size="lg"
                    mt={6}
                    title="Vælg billeder"
                  >
                    <IconPhoto size={20} />
                  </ActionIcon>
                )}
              </FileButton>
              <FileButton onChange={handleFilesSelected} multiple>
                {(props) => (
                  <ActionIcon
                    {...props}
                    variant="subtle"
                    color="gray"
                    size="lg"
                    mt={6}
                    title="Vedhæft fil"
                  >
                    <IconPaperclip size={20} />
                  </ActionIcon>
                )}
              </FileButton>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
                placeholder="Skriv en besked (valgfrit)..."
                minRows={2}
                maxRows={6}
                autosize
                style={{ flex: 1 }}
                rightSection={
                  <EmojiPicker
                    onSelect={(emoji) => setMessage((prev) => prev + emoji)}
                  />
                }
                rightSectionPointerEvents="auto"
              />
            </Group>

            <Group justify="flex-end">
              <Button variant="light" onClick={handleClose}>
                Annuller
              </Button>
              <Button onClick={handleStart} loading={createMutation.isPending}>
                {selectedUsers.length === 1
                  ? "Start samtale"
                  : `Start gruppesamtale (${selectedUsers.length})`}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  )
}
