import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconMessage,
  IconSearch,
  IconCheck,
  IconChecks,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { messagingApi, ChatWebSocket } from '../api/messaging';
import { apiClient, getAccessToken } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type {
  Conversation,
  ConversationDetail,
  Message,
  WsMessage,
  User,
} from '../types';
import ChatRichTextEditor from '../components/ChatRichTextEditor';
import RichTextEditor from '../components/RichTextEditor';

dayjs.extend(relativeTime);

// Create WebSocket instance
const chatWs = new ChatWebSocket(getAccessToken);

export default function MessagesPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [newMessageModalOpened, { open: openNewMessageModal, close: closeNewMessageModal }] =
    useDisclosure(false);
  const [isWsConnected, setIsWsConnected] = useState(false);

  // Fetch conversations
  const { data: conversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: messagingApi.getConversations,
  });

  // Fetch selected conversation detail
  const { data: activeConversation, isLoading: conversationLoading } = useQuery({
    queryKey: ['conversation', selectedConversation],
    queryFn: () =>
      selectedConversation ? messagingApi.getConversation(selectedConversation) : null,
    enabled: !!selectedConversation,
  });

  // Connect WebSocket on mount
  useEffect(() => {
    chatWs.connect();

    const unsubConnection = chatWs.onConnectionChange((connected) => {
      setIsWsConnected(connected);
    });

    const unsubMessage = chatWs.onMessage((data) => {
      const wsData = data as WsMessage;

      if (wsData.type === 'new_message') {
        // Update conversation list
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        // Update active conversation if it matches
        if (wsData.message.conversation === selectedConversation) {
          queryClient.setQueryData<ConversationDetail>(
            ['conversation', selectedConversation],
            (old) => {
              if (!old) return old;
              // Check if message already exists to prevent duplicates
              if (old.messages.some((m) => m.id === wsData.message.id)) {
                return old;
              }
              return {
                ...old,
                messages: [...old.messages, wsData.message],
              };
            }
          );
        }
      } else if (wsData.type === 'messages_read') {
        // Update read status in active conversation
        queryClient.invalidateQueries({ queryKey: ['conversation', wsData.conversation_id] });
      } else if (wsData.type === 'new_conversation') {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
    });

    return () => {
      unsubConnection();
      unsubMessage();
      chatWs.disconnect();
    };
  }, [queryClient, selectedConversation]);

  // Mark messages as read when viewing conversation
  useEffect(() => {
    if (selectedConversation && activeConversation?.unread_count) {
      chatWs.markRead(selectedConversation);
      // Optimistically update the conversation detail to mark messages as read
      queryClient.setQueryData<ConversationDetail>(
        ['conversation', selectedConversation],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            unread_count: 0,
            messages: old.messages.map((msg) => ({
              ...msg,
              is_read: msg.is_own ? msg.is_read : true,
            })),
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [selectedConversation, activeConversation?.unread_count, queryClient]);

  const handleSelectConversation = (id: number) => {
    setSelectedConversation(id);
  };

  const handleNewConversationCreated = (conversationId: number) => {
    closeNewMessageModal();
    chatWs.joinConversation(conversationId);
    setSelectedConversation(conversationId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

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
        <Button leftSection={<IconPlus size={16} />} onClick={openNewMessageModal}>
          Ny besked
        </Button>
      </Group>

      <Paper withBorder radius="md" style={{ height: 'calc(100vh - 200px)', display: 'flex' }}>
        {/* Conversation List */}
        <Box
          style={{
            width: 320,
            borderRight: '1px solid var(--mantine-color-gray-3)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
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
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selectedConversation ? (
            conversationLoading ? (
              <Center style={{ flex: 1 }}>
                <Loader size="lg" />
              </Center>
            ) : activeConversation ? (
              <ChatArea
                conversation={activeConversation}
                onSendMessage={(content) => {
                  chatWs.sendMessage(selectedConversation, content);
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
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  currentUserId?: number;
  onClick: () => void;
}

function ConversationItem({
  conversation,
  isSelected,
  currentUserId,
  onClick,
}: ConversationItemProps) {
  const otherParticipants = conversation.other_participants;
  const displayName =
    otherParticipants.length > 0
      ? otherParticipants.map((p) => p.first_name).join(', ')
      : 'Unknown';
  const avatar = otherParticipants[0];

  return (
    <Box
      p="sm"
      style={{
        cursor: 'pointer',
        backgroundColor: isSelected ? 'var(--mantine-color-blue-0)' : undefined,
        borderBottom: '1px solid var(--mantine-color-gray-2)',
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
          <Avatar src={avatar?.profile_picture} radius="xl" size="md">
            {avatar?.first_name?.[0]}
            {avatar?.last_name?.[0]}
          </Avatar>
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
              {conversation.last_message.sender_id === currentUserId ? 'Dig: ' : ''}
              {conversation.last_message.content}
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
  );
}

interface ChatAreaProps {
  conversation: ConversationDetail;
  onSendMessage: (content: string) => void;
}

function ChatArea({ conversation, onSendMessage }: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const otherParticipants = conversation.other_participants;
  const displayName =
    otherParticipants.length > 0
      ? otherParticipants.map((p) => `${p.first_name} ${p.last_name}`).join(', ')
      : 'Unknown';

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [conversation.messages]);

  const handleSend = () => {
    // Strip HTML tags to check if there's actual content
    const textContent = message.replace(/<[^>]*>/g, '').trim();
    if (!textContent) return;
    onSendMessage(message);
    setMessage('');
  };

  return (
    <>
      {/* Header */}
      <Box
        p="md"
        style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
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
              conversation.messages[idx - 1].sender.id !== msg.sender.id;
            const showTime =
              idx === conversation.messages.length - 1 ||
              conversation.messages[idx + 1].sender.id !== msg.sender.id;

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                showAvatar={showAvatar}
                showTime={showTime}
              />
            );
          })}
        </Stack>
      </ScrollArea>

      {/* Input */}
      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <ChatRichTextEditor
          content={message}
          onChange={setMessage}
          onSend={handleSend}
          placeholder="Skriv en besked..."
        />
      </Box>
    </>
  );
}

interface MessageBubbleProps {
  message: Message;
  showAvatar: boolean;
  showTime: boolean;
}

function MessageBubble({ message, showAvatar, showTime }: MessageBubbleProps) {
  const isOwn = message.is_own;

  return (
    <Group
      justify={isOwn ? 'flex-end' : 'flex-start'}
      gap="xs"
      align="flex-end"
      wrap="nowrap"
    >
      {!isOwn && (
        <Avatar
          src={message.sender.profile_picture}
          radius="xl"
          size="sm"
          style={{ visibility: showAvatar ? 'visible' : 'hidden' }}
        >
          {message.sender.first_name?.[0]}
        </Avatar>
      )}
      <Box style={{ maxWidth: '70%' }}>
        <Paper
          p="xs"
          radius="lg"
          style={{
            backgroundColor: isOwn
              ? 'var(--mantine-color-blue-6)'
              : 'var(--mantine-color-gray-1)',
          }}
        >
          <TypographyStylesProvider
            style={{
              color: isOwn ? 'white' : 'inherit',
              fontSize: 'var(--mantine-font-size-sm)',
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: message.content }} />
          </TypographyStylesProvider>
        </Paper>
        {showTime && (
          <Group gap={4} justify={isOwn ? 'flex-end' : 'flex-start'} mt={2}>
            <Text size="xs" c="dimmed">
              {dayjs(message.created_at).format('HH:mm')}
            </Text>
            {isOwn && (
              message.is_read ? (
                <IconChecks size={14} color="var(--mantine-color-blue-6)" />
              ) : (
                <IconCheck size={14} color="gray" />
              )
            )}
          </Group>
        )}
      </Box>
    </Group>
  );
}

interface NewMessageModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (conversationId: number) => void;
}

function NewMessageModal({ opened, onClose, onSuccess }: NewMessageModalProps) {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');

  // Fetch users for search
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiClient.get('/users/');
      return (response.data.results ?? response.data) as User[];
    },
    enabled: opened,
  });

  const createMutation = useMutation({
    mutationFn: messagingApi.createConversation,
    onSuccess: (data) => {
      onSuccess(data.id);
      setSearch('');
      setSelectedUser(null);
      setMessage('');
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke starte samtale',
        color: 'red',
      });
    },
  });

  const filteredUsers = users?.filter(
    (u) =>
      u.first_name.toLowerCase().includes(search.toLowerCase()) ||
      u.last_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleStart = () => {
    if (!selectedUser) return;
    createMutation.mutate({
      participant_ids: [selectedUser.id],
      initial_message: message.trim() || undefined,
    });
  };

  const handleClose = () => {
    setSearch('');
    setSelectedUser(null);
    setMessage('');
    onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Ny besked" size="md">
      <Stack gap="md">
        {!selectedUser ? (
          <>
            <TextInput
              placeholder="Søg brugere..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <ScrollArea h={300}>
              <Stack gap="xs">
                {filteredUsers?.map((u) => (
                  <Paper
                    key={u.id}
                    p="sm"
                    withBorder
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedUser(u)}
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
              </Stack>
            </ScrollArea>
          </>
        ) : (
          <>
            <Paper p="sm" withBorder>
              <Group justify="space-between">
                <Group gap="sm">
                  <Avatar src={selectedUser.profile_picture} radius="xl" size="md">
                    {selectedUser.first_name?.[0]}
                    {selectedUser.last_name?.[0]}
                  </Avatar>
                  <Text fw={500}>
                    {selectedUser.first_name} {selectedUser.last_name}
                  </Text>
                </Group>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setSelectedUser(null)}
                >
                  Skift
                </Button>
              </Group>
            </Paper>

            <RichTextEditor
              content={message}
              onChange={setMessage}
              placeholder="Skriv en besked (valgfrit)..."
              minHeight={100}
            />

            <Group justify="flex-end">
              <Button variant="light" onClick={handleClose}>
                Annuller
              </Button>
              <Button onClick={handleStart} loading={createMutation.isPending}>
                Start samtale
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
