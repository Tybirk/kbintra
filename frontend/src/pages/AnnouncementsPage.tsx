import { useState } from 'react';
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
  ActionIcon,
  Menu,
  Badge,
  TypographyStylesProvider,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconSpeakerphone,
  IconDotsVertical,
  IconEdit,
  IconTrash,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { announcementsApi } from '../api/announcements';
import RichTextEditor from '../components/RichTextEditor';
import type { Announcement, CreateAnnouncementData } from '../types';

dayjs.extend(relativeTime);

export default function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] =
    useDisclosure(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);
  const [announcementToDelete, setAnnouncementToDelete] = useState<number | null>(null);

  const { data: announcements, isLoading, error } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => announcementsApi.getAnnouncements(),
  });

  const deleteMutation = useMutation({
    mutationFn: announcementsApi.deleteAnnouncement,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      closeDeleteModal();
      setAnnouncementToDelete(null);
      notifications.show({
        title: 'Announcement deleted',
        message: 'The announcement has been deleted.',
        color: 'blue',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete announcement. Please try again.',
        color: 'red',
      });
    },
  });

  const handleDeleteClick = (id: number) => {
    setAnnouncementToDelete(id);
    openDeleteModal();
  };

  const handleConfirmDelete = () => {
    if (announcementToDelete) {
      deleteMutation.mutate(announcementToDelete);
    }
  };

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Failed to load announcements. Please try again.</Text>
      </Center>
    );
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Announcements</Title>
          <Text c="dimmed">Important updates for the community</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          New Announcement
        </Button>
      </Group>

      <Stack gap="md">
        {announcements?.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Center>
              <Stack align="center" gap="xs">
                <IconSpeakerphone size={48} color="gray" />
                <Text c="dimmed">No announcements yet.</Text>
                <Button onClick={openCreateModal} mt="sm">
                  Create First Announcement
                </Button>
              </Stack>
            </Center>
          </Paper>
        ) : (
          announcements?.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onEdit={() => setEditingAnnouncement(announcement)}
              onDelete={() => handleDeleteClick(announcement.id)}
            />
          ))
        )}
      </Stack>

      <CreateAnnouncementModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['announcements'] });
          closeCreateModal();
        }}
      />

      {editingAnnouncement && (
        <EditAnnouncementModal
          opened={!!editingAnnouncement}
          onClose={() => setEditingAnnouncement(null)}
          announcement={editingAnnouncement}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['announcements'] });
            setEditingAnnouncement(null);
          }}
        />
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Delete Announcement"
        centered
      >
        <Text mb="lg">
          Are you sure you want to delete this announcement? This action cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deleteMutation.isPending}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </>
  );
}

interface AnnouncementCardProps {
  announcement: Announcement;
  onEdit: () => void;
  onDelete: () => void;
}

function AnnouncementCard({ announcement, onEdit, onDelete }: AnnouncementCardProps) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <Avatar
            src={announcement.author.profile_picture}
            radius="xl"
            size="md"
          >
            {announcement.author.first_name?.[0]}
            {announcement.author.last_name?.[0]}
          </Avatar>
          <div>
            <Text fw={500}>{announcement.title}</Text>
            <Text size="sm" c="dimmed">
              {announcement.author.first_name} {announcement.author.last_name} •{' '}
              {dayjs(announcement.created_at).fromNow()}
            </Text>
          </div>
        </Group>

        <Group gap="xs">
          {announcement.priority > 0 && (
            <Badge color="red" variant="light">
              Priority
            </Badge>
          )}
          {announcement.is_own && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                  Edit
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={onDelete}
                >
                  Delete
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <TypographyStylesProvider>
        <div dangerouslySetInnerHTML={{ __html: announcement.content }} />
      </TypographyStylesProvider>
    </Paper>
  );
}

interface CreateAnnouncementModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateAnnouncementModal({
  opened,
  onClose,
  onSuccess,
}: CreateAnnouncementModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: CreateAnnouncementData) =>
      announcementsApi.createAnnouncement(data),
    onSuccess: () => {
      notifications.show({
        title: 'Announcement created',
        message: 'Your announcement has been posted.',
        color: 'green',
      });
      setTitle('');
      setContent('');
      onSuccess();
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to create announcement. Please try again.',
        color: 'red',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    createMutation.mutate({ title: title.trim(), content: content.trim() });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create Announcement" size="lg">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Announcement title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Content
            </Text>
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Write your announcement..."
              minHeight={200}
            />
          </div>
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!title.trim() || !content.trim() || content === '<p></p>'}
            >
              Post Announcement
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface EditAnnouncementModalProps {
  opened: boolean;
  onClose: () => void;
  announcement: Announcement;
  onSuccess: () => void;
}

function EditAnnouncementModal({
  opened,
  onClose,
  announcement,
  onSuccess,
}: EditAnnouncementModalProps) {
  const [title, setTitle] = useState(announcement.title);
  const [content, setContent] = useState(announcement.content);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateAnnouncementData>) =>
      announcementsApi.updateAnnouncement(announcement.id, data),
    onSuccess: () => {
      notifications.show({
        title: 'Announcement updated',
        message: 'Your announcement has been updated.',
        color: 'green',
      });
      onSuccess();
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to update announcement. Please try again.',
        color: 'red',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    updateMutation.mutate({ title: title.trim(), content: content.trim() });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Edit Announcement" size="lg">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Announcement title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Content
            </Text>
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Write your announcement..."
              minHeight={200}
            />
          </div>
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={!title.trim() || !content.trim() || content === '<p></p>'}
            >
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
