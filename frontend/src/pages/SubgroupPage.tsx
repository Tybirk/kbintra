import { useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Paper,
  Group,
  Badge,
  Button,
  Loader,
  Center,
  Stack,
  Avatar,
  TextInput,
  Modal,
  Tabs,
  ActionIcon,
  Breadcrumbs,
  Anchor,
  FileInput,
  FileButton,
  Select,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconPlus,
  IconPin,
  IconLock,
  IconMessage,
  IconFolder,
  IconUpload,
  IconFolderPlus,
  IconTrash,
  IconDownload,
  IconChevronRight,
  IconFolderSymlink,
  IconEye,
  IconPaperclip,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { forumApi } from "../api/forum"
import RichTextEditor from "../components/RichTextEditor"
import {
  FilePreviewModal,
  ImageThumbnail,
  getFileIcon,
  getFileType,
  getFileTypeColor,
} from "../components/FilePreview"
import { AttachmentBadge } from "../components/AttachmentBadge"
import { useAuthStore } from "../store/authStore"
import type { Thread, CreateThreadData, Folder, ForumFile } from "../types"

interface CreateThreadParams {
  data: CreateThreadData
  files: File[]
}

dayjs.extend(relativeTime)

export default function SubgroupPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<string | null>("threads")
  const [
    createThreadModalOpened,
    { open: openCreateThreadModal, close: closeCreateThreadModal },
  ] = useDisclosure(false)

  const { data: subgroup, isLoading: subgroupLoading } = useQuery({
    queryKey: ["subgroup", slug],
    queryFn: () => forumApi.getSubgroup(slug!),
    enabled: !!slug,
  })

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ["threads", slug],
    queryFn: () => forumApi.getThreads(slug!),
    enabled: !!slug,
  })

  const isLoading = subgroupLoading || threadsLoading

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (!subgroup) {
    return (
      <Center h={200}>
        <Text c="red">Subgroup not found.</Text>
      </Center>
    )
  }

  // Sort threads: pinned first, then by updated_at
  const sortedThreads = [...(threads || [])].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1
    if (!a.is_pinned && b.is_pinned) return 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/forum")}
        mb="md"
      >
        Back to Forum
      </Button>

      <Group justify="space-between" mb="md">
        <div>
          <Group gap="xs">
            <Title order={1}>{subgroup.name}</Title>
            {subgroup.is_committee && (
              <Badge variant="filled" color="teal">
                Udvalg
              </Badge>
            )}
          </Group>
          {subgroup.description && (
            <Text c="dimmed">{subgroup.description}</Text>
          )}
        </div>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="threads" leftSection={<IconMessage size={16} />}>
            Diskussioner
          </Tabs.Tab>
          <Tabs.Tab value="documents" leftSection={<IconFolder size={16} />}>
            Dokumenter
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="threads" pt="md">
          <Group justify="flex-end" mb="md">
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={openCreateThreadModal}
            >
              Ny diskussion
            </Button>
          </Group>
          <Stack gap="md">
            {sortedThreads.length === 0 ? (
              <Paper withBorder p="xl" radius="md">
                <Center>
                  <Stack align="center" gap="xs">
                    <IconMessage size={48} color="gray" />
                    <Text c="dimmed">
                      Ingen diskussioner endnu. Start samtalen!
                    </Text>
                    <Button onClick={openCreateThreadModal} mt="sm">
                      Opret første diskussion
                    </Button>
                  </Stack>
                </Center>
              </Paper>
            ) : (
              sortedThreads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onClick={() => navigate(`/forum/${slug}/${thread.id}`)}
                />
              ))
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="documents" pt="md">
          <DocumentsTab subgroupSlug={slug!} />
        </Tabs.Panel>
      </Tabs>

      <CreateThreadModal
        opened={createThreadModalOpened}
        onClose={closeCreateThreadModal}
        subgroupSlug={slug!}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["threads", slug] })
          closeCreateThreadModal()
        }}
      />
    </>
  )
}

interface ThreadRowProps {
  thread: Thread
  onClick: () => void
}

function ThreadRow({ thread, onClick }: ThreadRowProps) {
  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Avatar src={thread.author.profile_picture} radius="xl" size="md">
            {thread.author.first_name?.[0]}
            {thread.author.last_name?.[0]}
          </Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={4}>
              {thread.is_pinned && (
                <IconPin size={14} color="var(--mantine-color-blue-6)" />
              )}
              {thread.is_closed && (
                <IconLock size={14} color="var(--mantine-color-orange-6)" />
              )}
              <Text fw={500} lineClamp={1}>
                {thread.title}
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              {thread.author.first_name} {thread.author.last_name} •{" "}
              {dayjs(thread.created_at).fromNow()}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <Badge variant="light" color="gray">
            {thread.post_count} {thread.post_count === 1 ? "reply" : "replies"}
          </Badge>
          {thread.last_post_at && (
            <Text size="xs" c="dimmed">
              Last activity {dayjs(thread.last_post_at).fromNow()}
            </Text>
          )}
        </Group>
      </Group>
    </Paper>
  )
}

interface CreateThreadModalProps {
  opened: boolean
  onClose: () => void
  subgroupSlug: string
  onSuccess: () => void
}

function CreateThreadModal({
  opened,
  onClose,
  subgroupSlug,
  onSuccess,
}: CreateThreadModalProps) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const resetRef = useRef<() => void>(null)

  const createMutation = useMutation({
    mutationFn: ({ data, files }: CreateThreadParams) =>
      forumApi.createThread(
        subgroupSlug,
        data,
        files.length > 0 ? files : undefined,
      ),
    onSuccess: () => {
      notifications.show({
        title: "Thread created",
        message: "Your thread has been posted.",
        color: "green",
      })
      setTitle("")
      setContent("")
      setAttachments([])
      resetRef.current?.()
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to create thread. Please try again.",
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
    setAttachments((prev) => [...prev, ...files])
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create New Thread"
      size="lg"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="What do you want to discuss?"
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
              placeholder="Write your first post..."
              minHeight={200}
            />
          </div>

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

          <Group justify="space-between">
            <FileButton resetRef={resetRef} onChange={handleAddFiles} multiple>
              {(props) => (
                <Button
                  variant="light"
                  leftSection={<IconPaperclip size={16} />}
                  {...props}
                >
                  Attach Files
                </Button>
              )}
            </FileButton>
            <Group>
              <Button variant="light" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={createMutation.isPending}
                disabled={!title.trim() || !content.trim()}
              >
                Create Thread
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

// =============================================================================
// Documents Tab Components
// =============================================================================

interface DocumentsTabProps {
  subgroupSlug: string
}

function DocumentsTab({ subgroupSlug }: DocumentsTabProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
  const [folderPath, setFolderPath] = useState<Array<{
    id: number | null
    name: string
  }>>([{ id: null, name: "Dokumenter" }])
  const [
    createFolderModalOpened,
    { open: openCreateFolderModal, close: closeCreateFolderModal },
  ] = useDisclosure(false)
  const [
    uploadModalOpened,
    { open: openUploadModal, close: closeUploadModal },
  ] = useDisclosure(false)

  // Fetch folders for current location
  const { data: folders, isLoading: foldersLoading } = useQuery({
    queryKey: ["folders", subgroupSlug, currentFolderId],
    queryFn: () =>
      forumApi.getFolders(subgroupSlug, currentFolderId ?? undefined),
  })

  // Fetch files - either root level or inside a folder
  const { data: files, isLoading: filesLoading } = useQuery({
    queryKey:
      currentFolderId !== null
        ? ["files", currentFolderId]
        : ["rootFiles", subgroupSlug],
    queryFn: () =>
      currentFolderId !== null
        ? forumApi.getFiles(currentFolderId)
        : forumApi.getRootFiles(subgroupSlug),
  })

  const navigateToFolder = (folderId: number | null, folderName: string) => {
    if (folderId === null) {
      // Going back to root
      setCurrentFolderId(null)
      setFolderPath([{ id: null, name: "Dokumenter" }])
    } else {
      setCurrentFolderId(folderId)
      // Check if we're going back in the path
      const existingIndex = folderPath.findIndex((f) => f.id === folderId)
      if (existingIndex >= 0) {
        setFolderPath(folderPath.slice(0, existingIndex + 1))
      } else {
        setFolderPath([...folderPath, { id: folderId, name: folderName }])
      }
    }
  }

  const isLoading = foldersLoading || filesLoading

  return (
    <>
      {/* Breadcrumbs */}
      <Group justify="space-between" mb="md">
        <Breadcrumbs>
          {folderPath.map((item, index) => (
            <Anchor
              key={item.id ?? "root"}
              onClick={() => navigateToFolder(item.id, item.name)}
              style={{ cursor: "pointer" }}
              fw={index === folderPath.length - 1 ? 500 : undefined}
            >
              {item.name}
            </Anchor>
          ))}
        </Breadcrumbs>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconFolderPlus size={16} />}
            onClick={openCreateFolderModal}
            size="sm"
          >
            Ny mappe
          </Button>
          <Button
            leftSection={<IconUpload size={16} />}
            onClick={openUploadModal}
            size="sm"
          >
            Upload fil
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Center h={200}>
          <Loader />
        </Center>
      ) : (
        <Stack gap="sm">
          {/* Folders */}
          {folders?.map((folder: Folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onClick={() => navigateToFolder(folder.id, folder.name)}
            />
          ))}

          {/* Files */}
          {files?.map((file: ForumFile) => {
            const canModify = file.is_own || user?.is_staff === true
            const invalidateFiles = () => {
              if (currentFolderId !== null) {
                queryClient.invalidateQueries({
                  queryKey: ["files", currentFolderId],
                })
              } else {
                queryClient.invalidateQueries({
                  queryKey: ["rootFiles", subgroupSlug],
                })
              }
            }
            return (
              <FileRow
                key={file.id}
                file={file}
                subgroupSlug={subgroupSlug}
                canModify={canModify}
                onDelete={invalidateFiles}
                onMove={invalidateFiles}
              />
            )
          })}

          {/* Empty state */}
          {(!folders || folders.length === 0) &&
            (!files || files.length === 0) && (
              <Paper withBorder p="xl" radius="md">
                <Center>
                  <Stack align="center" gap="xs">
                    <IconFolder size={48} color="gray" />
                    <Text c="dimmed">
                      {currentFolderId === null
                        ? "Ingen dokumenter endnu."
                        : "Denne mappe er tom."}
                    </Text>
                    <Group gap="xs" mt="sm">
                      <Button variant="light" onClick={openCreateFolderModal}>
                        Opret mappe
                      </Button>
                      <Button onClick={openUploadModal}>Upload fil</Button>
                    </Group>
                  </Stack>
                </Center>
              </Paper>
            )}
        </Stack>
      )}

      <CreateFolderModal
        opened={createFolderModalOpened}
        onClose={closeCreateFolderModal}
        subgroupSlug={subgroupSlug}
        parentId={currentFolderId}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["folders", subgroupSlug, currentFolderId],
          })
          closeCreateFolderModal()
        }}
      />

      <UploadFileModal
        opened={uploadModalOpened}
        onClose={closeUploadModal}
        subgroupSlug={subgroupSlug}
        folderId={currentFolderId}
        onSuccess={() => {
          if (currentFolderId !== null) {
            queryClient.invalidateQueries({
              queryKey: ["files", currentFolderId],
            })
          } else {
            queryClient.invalidateQueries({
              queryKey: ["rootFiles", subgroupSlug],
            })
          }
          closeUploadModal()
        }}
      />
    </>
  )
}

interface FolderRowProps {
  folder: Folder
  onClick: () => void
}

function FolderRow({ folder, onClick }: FolderRowProps) {
  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <Group justify="space-between">
        <Group gap="md">
          <IconFolder size={24} color="var(--mantine-color-blue-6)" />
          <div>
            <Text fw={500}>{folder.name}</Text>
            <Text size="xs" c="dimmed">
              {folder.subfolder_count} mapper, {folder.file_count} filer
            </Text>
          </div>
        </Group>
        <IconChevronRight size={20} color="gray" />
      </Group>
    </Paper>
  )
}

interface FileRowProps {
  file: ForumFile
  subgroupSlug: string
  canModify: boolean
  onDelete: () => void
  onMove: () => void
}

function FileRow({
  file,
  subgroupSlug,
  canModify,
  onDelete,
  onMove,
}: FileRowProps) {
  const [moveModalOpened, { open: openMoveModal, close: closeMoveModal }] =
    useDisclosure(false)
  const [previewOpened, { open: openPreview, close: closePreview }] =
    useDisclosure(false)

  const fileType = getFileType(file.name)
  const FileIcon = getFileIcon(file.name)
  const fileColor = getFileTypeColor(file.name)
  const isImage = fileType === "image"

  const deleteMutation = useMutation({
    mutationFn: () => forumApi.deleteFile(file.id),
    onSuccess: () => {
      notifications.show({
        title: "Fil slettet",
        message: "Filen er blevet slettet.",
        color: "green",
      })
      onDelete()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette filen. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(file.file_url, "_blank")
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm("Er du sikker på, at du vil slette denne fil?")) {
      deleteMutation.mutate()
    }
  }

  const handleOpenMoveModal = (e: React.MouseEvent) => {
    e.stopPropagation()
    openMoveModal()
  }

  const handleOpenPreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    openPreview()
  }

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <Group gap="md">
            {isImage ? (
              <ImageThumbnail file={file} size={48} onClick={openPreview} />
            ) : (
              <FileIcon
                size={24}
                color={`var(--mantine-color-${fileColor}-6)`}
              />
            )}
            <div>
              <Text
                fw={500}
                style={{ cursor: "pointer" }}
                onClick={openPreview}
                c="blue"
              >
                {file.name}
              </Text>
              <Text size="xs" c="dimmed">
                Uploadet af {file.uploaded_by.first_name}{" "}
                {file.uploaded_by.last_name} •{" "}
                {dayjs(file.uploaded_at).fromNow()}
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <ActionIcon
              variant="light"
              onClick={handleOpenPreview}
              title="Forhåndsvis"
            >
              <IconEye size={16} />
            </ActionIcon>
            <ActionIcon
              variant="light"
              onClick={handleDownload}
              title="Download"
            >
              <IconDownload size={16} />
            </ActionIcon>
            {canModify && (
              <>
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={handleOpenMoveModal}
                  title="Flyt til anden mappe"
                >
                  <IconFolderSymlink size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="light"
                  color="red"
                  onClick={handleDelete}
                  loading={deleteMutation.isPending}
                  title="Slet"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </>
            )}
          </Group>
        </Group>
      </Paper>

      <FilePreviewModal
        file={file}
        opened={previewOpened}
        onClose={closePreview}
      />

      <MoveFileModal
        opened={moveModalOpened}
        onClose={closeMoveModal}
        file={file}
        subgroupSlug={subgroupSlug}
        onSuccess={() => {
          closeMoveModal()
          onMove()
        }}
      />
    </>
  )
}

interface CreateFolderModalProps {
  opened: boolean
  onClose: () => void
  subgroupSlug: string
  parentId: number | null
  onSuccess: () => void
}

function CreateFolderModal({
  opened,
  onClose,
  subgroupSlug,
  parentId,
  onSuccess,
}: CreateFolderModalProps) {
  const [name, setName] = useState("")

  const createMutation = useMutation({
    mutationFn: () =>
      forumApi.createFolder(subgroupSlug, name, parentId ?? undefined),
    onSuccess: () => {
      notifications.show({
        title: "Mappe oprettet",
        message: "Den nye mappe er blevet oprettet.",
        color: "green",
      })
      setName("")
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette mappen. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate()
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Opret ny mappe">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Mappenavn"
            placeholder="Indtast mappenavn..."
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!name.trim()}
            >
              Opret mappe
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface UploadFileModalProps {
  opened: boolean
  onClose: () => void
  subgroupSlug: string
  folderId: number | null
  onSuccess: () => void
}

function UploadFileModal({
  opened,
  onClose,
  subgroupSlug,
  folderId,
  onSuccess,
}: UploadFileModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (folderId !== null) {
        return forumApi.uploadFile(folderId, file!, name || undefined)
      }
      return forumApi.uploadRootFile(subgroupSlug, file!, name || undefined)
    },
    onSuccess: () => {
      notifications.show({
        title: "Fil uploadet",
        message: "Filen er blevet uploadet.",
        color: "green",
      })
      setFile(null)
      setName("")
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke uploade filen. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    uploadMutation.mutate()
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Upload fil">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <FileInput
            label="Vælg fil"
            placeholder="Klik for at vælge fil..."
            value={file}
            onChange={setFile}
            required
          />
          <TextInput
            label="Filnavn (valgfrit)"
            placeholder="Lad være tom for at bruge originalt navn"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={uploadMutation.isPending}
              disabled={!file}
            >
              Upload
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface MoveFileModalProps {
  opened: boolean
  onClose: () => void
  file: ForumFile
  subgroupSlug: string
  onSuccess: () => void
}

function MoveFileModal({
  opened,
  onClose,
  file,
  subgroupSlug,
  onSuccess,
}: MoveFileModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

  // Fetch all folders for the subgroup
  const { data: folders, isLoading: foldersLoading } = useQuery({
    queryKey: ["allFolders", subgroupSlug],
    queryFn: () => forumApi.getAllFolders(subgroupSlug),
    enabled: opened,
  })

  const moveMutation = useMutation({
    mutationFn: () => {
      const folderId =
        selectedFolderId === "root" ? null : parseInt(selectedFolderId!, 10)
      return forumApi.moveFile(file.id, folderId)
    },
    onSuccess: () => {
      notifications.show({
        title: "Fil flyttet",
        message: "Filen er blevet flyttet til den valgte mappe.",
        color: "green",
      })
      setSelectedFolderId(null)
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke flytte filen. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFolderId === null) return
    moveMutation.mutate()
  }

  // Build folder options with hierarchy indication
  const folderOptions = [
    { value: "root", label: "📁 Rodmappe (ingen mappe)" },
    ...(folders?.map((folder) => ({
      value: folder.id.toString(),
      label: `📂 ${folder.name}`,
    })) ?? []),
  ]

  return (
    <Modal opened={opened} onClose={onClose} title={`Flyt "${file.name}"`}>
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Select
            label="Vælg destination"
            placeholder="Vælg en mappe..."
            data={folderOptions}
            value={selectedFolderId}
            onChange={setSelectedFolderId}
            searchable
            disabled={foldersLoading}
            required
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={moveMutation.isPending}
              disabled={selectedFolderId === null}
            >
              Flyt fil
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
