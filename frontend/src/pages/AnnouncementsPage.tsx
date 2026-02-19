import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
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
  ActionIcon,
  Menu,
  Badge,
  Typography,
  Box,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconPlus,
  IconSpeakerphone,
  IconDotsVertical,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { announcementsApi } from "../api/announcements"
import { notificationsApi } from "../api/notifications"
import { filterFilesBySize } from "../config"
import { clearDraft } from "../utils/draftStorage"
import RichTextEditor from "../components/RichTextEditor"
import FileDropzone, { AttachmentArea } from "../components/FileDropzone"
import { AttachmentBadge } from "../components/AttachmentBadge"
import {
  getFileIcon,
  getFileTypeColor,
  FilePreviewModal,
  ImageThumbnail,
  getFileType,
} from "../components/FilePreview"
import type {
  Announcement,
  CreateAnnouncementData,
  AnnouncementAttachment,
} from "../types"

dayjs.extend(relativeTime)

export default function AnnouncementsPage() {
  const queryClient = useQueryClient()
  const { hash } = useLocation()
  const scrolledRef = useRef(false)
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<Announcement | null>(null)
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)
  const [announcementToDelete, setAnnouncementToDelete] =
    useState<number | null>(null)

  const {
    data: announcements,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => announcementsApi.getAnnouncements(),
  })

  // Auto-mark announcement notifications as read when visiting the page
  useEffect(() => {
    void notificationsApi.markReadByLink("/opslag").then(() => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to and highlight a specific announcement when navigating from search
  useEffect(() => {
    if (!hash || !announcements || scrolledRef.current) return
    const el = document.getElementById(hash.slice(1))
    if (el) {
      scrolledRef.current = true
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.style.outline = "2px solid var(--mantine-color-blue-5)"
      el.style.borderRadius = "var(--mantine-radius-md)"
      const timer = setTimeout(() => {
        el.style.outline = ""
        el.style.borderRadius = ""
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [hash, announcements])

  const deleteMutation = useMutation({
    mutationFn: announcementsApi.deleteAnnouncement,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] })
      closeDeleteModal()
      setAnnouncementToDelete(null)
      notifications.show({
        title: "Opslag slettet",
        message: "Opslaget er blevet slettet.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette opslag. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleDeleteClick = (id: number) => {
    setAnnouncementToDelete(id)
    openDeleteModal()
  }

  const handleConfirmDelete = () => {
    if (announcementToDelete) {
      deleteMutation.mutate(announcementToDelete)
    }
  }

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse opslag. Prøv igen.</Text>
      </Center>
    )
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Vigtig post</Title>
          <Text c="dimmed">Vigtige opdateringer for fællesskabet</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Nyt opslag
        </Button>
      </Group>

      <Stack gap="md">
        {announcements?.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Center>
              <Stack align="center" gap="xs">
                <IconSpeakerphone size={48} color="gray" />
                <Text c="dimmed">Ingen opslag endnu.</Text>
                <Button onClick={openCreateModal} mt="sm">
                  Opret første opslag
                </Button>
              </Stack>
            </Center>
          </Paper>
        ) : (
          announcements?.map((announcement) => (
            <div key={announcement.id} id={`announcement-${announcement.id}`}>
              <AnnouncementCard
                announcement={announcement}
                onEdit={() => setEditingAnnouncement(announcement)}
                onDelete={() => handleDeleteClick(announcement.id)}
              />
            </div>
          ))
        )}
      </Stack>

      <CreateAnnouncementModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["announcements"] })
          closeCreateModal()
        }}
      />

      {editingAnnouncement && (
        <EditAnnouncementModal
          opened={!!editingAnnouncement}
          onClose={() => setEditingAnnouncement(null)}
          announcement={editingAnnouncement}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["announcements"] })
            setEditingAnnouncement(null)
          }}
        />
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Slet opslag"
        centered
      >
        <Text mb="lg">
          Er du sikker på, at du vil slette dette opslag? Denne handling kan
          ikke fortrydes.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deleteMutation.isPending}
          >
            Slet
          </Button>
        </Group>
      </Modal>
    </>
  )
}

interface AnnouncementCardProps {
  announcement: Announcement
  onEdit: () => void
  onDelete: () => void
}

function AnnouncementCard({
  announcement,
  onEdit,
  onDelete,
}: AnnouncementCardProps) {
  const [previewFile, setPreviewFile] = useState<AnnouncementAttachment | null>(
    null,
  )

  // Convert attachment to ForumFile format for FilePreviewModal
  const toForumFile = (attachment: AnnouncementAttachment) => ({
    id: attachment.id,
    name: attachment.name,
    file: attachment.file,
    file_url: attachment.file_url,
    uploaded_by: attachment.uploaded_by,
    is_own: false,
    uploaded_at: attachment.uploaded_at,
  })

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
              {announcement.author.first_name} {announcement.author.last_name} •{" "}
              {dayjs(announcement.created_at).fromNow()}
            </Text>
          </div>
        </Group>

        <Group gap="xs">
          {announcement.priority > 0 && (
            <Badge color="red" variant="light">
              Prioritet
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
                <Menu.Item
                  leftSection={<IconEdit size={14} />}
                  onClick={onEdit}
                >
                  Rediger
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={onDelete}
                >
                  Slet
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <Typography>
        <div dangerouslySetInnerHTML={{ __html: announcement.content }} />
      </Typography>

      {/* Attachments */}
      {announcement.attachments && announcement.attachments.length > 0 && (
        <Box
          mt="md"
          pt="md"
          style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}
        >
          <Text size="sm" fw={500} mb="xs">
            Vedhæftede filer ({announcement.attachments.length})
          </Text>
          <Group gap="xs">
            {announcement.attachments.map((attachment) => {
              const fileType = getFileType(attachment.name)
              const FileIcon = getFileIcon(attachment.name)
              const fileColor = getFileTypeColor(attachment.name)

              if (fileType === "image") {
                return (
                  <ImageThumbnail
                    key={attachment.id}
                    file={toForumFile(attachment)}
                    onClick={() => setPreviewFile(attachment)}
                  />
                )
              }

              return (
                <Paper
                  key={attachment.id}
                  withBorder
                  p="xs"
                  radius="sm"
                  style={{ cursor: "pointer" }}
                  onClick={() => setPreviewFile(attachment)}
                >
                  <Group gap="xs">
                    <FileIcon size={20} color={fileColor} />
                    <Text size="sm" lineClamp={1} style={{ maxWidth: 150 }}>
                      {attachment.name}
                    </Text>
                  </Group>
                </Paper>
              )
            })}
          </Group>
        </Box>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={toForumFile(previewFile)}
          opened={!!previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </Paper>
  )
}

interface CreateAnnouncementModalProps {
  opened: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateAnnouncementModal({
  opened,
  onClose,
  onSuccess,
}: CreateAnnouncementModalProps) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])

  const createMutation = useMutation({
    mutationFn: ({
      data,
      files,
    }: {
      data: CreateAnnouncementData
      files: File[]
    }) =>
      announcementsApi.createAnnouncement(
        data,
        files.length > 0 ? files : undefined,
      ),
    onSuccess: () => {
      notifications.show({
        title: "Opslag oprettet",
        message: "Dit opslag er blevet offentliggjort.",
        color: "green",
      })
      setTitle("")
      setContent("")
      setAttachments([])
      clearDraft("new-announcement")
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette opslag. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    createMutation.mutate({
      data: { title: title.trim(), content: content.trim() },
      files: attachments,
    })
  }

  const handleAddFiles = (files: File[]) => {
    const { validFiles, errors } = filterFilesBySize(files)
    if (errors.length > 0) {
      errors.forEach((error) => {
        notifications.show({
          title: "File too large",
          message: error,
          color: "red",
        })
      })
    }
    if (validFiles.length > 0) {
      setAttachments((prev) => [...prev, ...validFiles])
    }
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Opret opslag" size="lg">
      <FileDropzone onDrop={handleAddFiles}>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Titel"
              placeholder="Opslagstitel"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              required
            />
            <div>
              <Text size="sm" fw={500} mb={4}>
                Indhold
              </Text>
              <RichTextEditor
                content={content}
                onChange={setContent}
                placeholder="Skriv dit opslag..."
                minHeight={200}
                onFilePaste={handleAddFiles}
                draftKey="new-announcement"
              />
            </div>

            <AttachmentArea onAddFiles={handleAddFiles}>
              {attachments.length > 0 && (
                <Group gap="xs">
                  {attachments.map((file, index) => (
                    <AttachmentBadge
                      key={`${file.name}-${file.size}-${index}`}
                      file={file}
                      onRemove={() => handleRemoveFile(index)}
                    />
                  ))}
                </Group>
              )}
            </AttachmentArea>

            <Group justify="flex-end">
              <Button variant="light" onClick={onClose}>
                Annuller
              </Button>
              <Button
                type="submit"
                loading={createMutation.isPending}
                disabled={
                  !title.trim() || !content.trim() || content === "<p></p>"
                }
              >
                Opret opslag
              </Button>
            </Group>
          </Stack>
        </form>
      </FileDropzone>
    </Modal>
  )
}

interface EditAnnouncementModalProps {
  opened: boolean
  onClose: () => void
  announcement: Announcement
  onSuccess: () => void
}

function EditAnnouncementModal({
  opened,
  onClose,
  announcement,
  onSuccess,
}: EditAnnouncementModalProps) {
  const [title, setTitle] = useState(announcement.title)
  const [content, setContent] = useState(announcement.content)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateAnnouncementData>) =>
      announcementsApi.updateAnnouncement(announcement.id, data),
    onSuccess: () => {
      notifications.show({
        title: "Opslag opdateret",
        message: "Dit opslag er blevet opdateret.",
        color: "green",
      })
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere opslag. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    updateMutation.mutate({ title: title.trim(), content: content.trim() })
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Rediger opslag" size="lg">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Titel"
            placeholder="Opslagstitel"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Indhold
            </Text>
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Skriv dit opslag..."
              minHeight={200}
            />
          </div>
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={
                !title.trim() || !content.trim() || content === "<p></p>"
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
