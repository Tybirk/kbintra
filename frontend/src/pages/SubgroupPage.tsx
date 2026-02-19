import { useState, useRef, useEffect } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Paper,
  Group,
  Badge,
  Box,
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
  Select,
  SimpleGrid,
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
  IconChartBar,
  IconChecks,
  IconCalendarEvent,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/da"

import { eventsApi } from "../api/events"
import { forumApi } from "../api/forum"
import { clearDraft } from "../utils/draftStorage"
import {
  filterFilesBySize,
  validateFileSize,
  MAX_UPLOAD_FILE_SIZE_MB,
} from "../config"
import { CompactEventCard } from "../components/CompactEventCard"
import RichTextEditor from "../components/RichTextEditor"
import FileDropzone, { AttachmentArea } from "../components/FileDropzone"
import PollCreator from "../components/PollCreator"
import {
  FilePreviewModal,
  ImageThumbnail,
  getFileIcon,
  getFileType,
  getFileTypeColor,
} from "../components/FilePreview"
import { AttachmentBadge } from "../components/AttachmentBadge"
import { useAuthStore } from "../store/authStore"
import type {
  Thread,
  CreateThreadData,
  CreatePollData,
  Folder,
  ForumFile,
} from "../types"

interface CreateThreadParams {
  data: CreateThreadData
  files: File[]
  pollData?: CreatePollData
}

dayjs.extend(relativeTime)
dayjs.locale("da")

export default function SubgroupPage() {
  const { slug, folderId: folderIdParam } = useParams<{
    slug: string
    folderId?: string
  }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const initialFolderId = folderIdParam ? parseInt(folderIdParam, 10) : null
  const activeTab = location.pathname.includes("/dokumenter")
    ? "documents"
    : "threads"
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

  const { data: upcomingEvents } = useQuery({
    queryKey: ["events", "subgroup", subgroup?.id],
    queryFn: () =>
      eventsApi.getEvents({
        subgroup: subgroup!.id,
        start: dayjs().toISOString(),
        end: dayjs().add(30, "day").toISOString(),
      }),
    enabled: !!subgroup,
  })

  const markReadMutation = useMutation({
    mutationFn: () => forumApi.markSubgroupRead(slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", slug] })
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      queryClient.invalidateQueries({ queryKey: ["forum", "unread-count"] })
    },
  })

  const hasUnread = threads?.some((t) => t.is_unread) ?? false

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
        <Text c="red">Gruppen blev ikke fundet.</Text>
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
        Tilbage til forum
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
        <Button
          variant="light"
          leftSection={<IconCalendarEvent size={16} />}
          onClick={() => navigate(`/kalender/opret?subgroup=${subgroup.id}`)}
        >
          Opret begivenhed
        </Button>
      </Group>

      {upcomingEvents && upcomingEvents.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} mb="md">
          {upcomingEvents.slice(0, 2).map((event) => (
            <CompactEventCard key={event.id} event={event} />
          ))}
        </SimpleGrid>
      )}

      <Tabs
        value={activeTab}
        onChange={(tab) => {
          if (tab === "documents") navigate(`/forum/${slug}/dokumenter`)
          else navigate(`/forum/${slug}`)
        }}
        mb="md"
      >
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
            {hasUnread && (
              <Button
                variant="light"
                leftSection={<IconChecks size={16} />}
                onClick={() => markReadMutation.mutate()}
                loading={markReadMutation.isPending}
              >
                Markér som læst
              </Button>
            )}
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
          <DocumentsTab
            subgroupSlug={slug!}
            initialFolderId={initialFolderId}
            onFolderChange={(folderId) => {
              if (folderId === null) navigate(`/forum/${slug}/dokumenter`)
              else navigate(`/forum/${slug}/dokumenter/${folderId}`)
            }}
          />
        </Tabs.Panel>
      </Tabs>

      <CreateThreadModal
        opened={createThreadModalOpened}
        onClose={closeCreateThreadModal}
        subgroupSlug={slug!}
        onSuccess={(thread) => {
          queryClient.invalidateQueries({ queryKey: ["threads", slug] })
          closeCreateThreadModal()
          navigate(`/forum/${slug}/${thread.id}`)
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
      <Group gap="md" wrap="nowrap">
        <Avatar src={thread.author.profile_picture} radius="xl" size="md">
          {thread.author.first_name?.[0]}
          {thread.author.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4} wrap="nowrap">
            {thread.is_unread && (
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "var(--mantine-color-blue-6)",
                  flexShrink: 0,
                }}
              />
            )}
            {thread.is_pinned && (
              <IconPin
                size={14}
                color="var(--mantine-color-blue-6)"
                style={{ flexShrink: 0 }}
              />
            )}
            {thread.is_closed && (
              <IconLock
                size={14}
                color="var(--mantine-color-orange-6)"
                style={{ flexShrink: 0 }}
              />
            )}
            <Text fw={thread.is_unread ? 700 : 500} lineClamp={1}>
              {thread.title}
            </Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {thread.author.first_name} {thread.author.last_name} •{" "}
              {dayjs(thread.last_post_at ?? thread.created_at).fromNow()}
            </Text>
            <Badge variant="light" color="gray" size="sm">
              {thread.post_count} svar
            </Badge>
          </Group>
        </div>
      </Group>
    </Paper>
  )
}

interface CreateThreadModalProps {
  opened: boolean
  onClose: () => void
  subgroupSlug: string
  onSuccess: (thread: Thread) => void
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
  const [pollData, setPollData] = useState<CreatePollData | null>(null)

  const createMutation = useMutation({
    mutationFn: ({ data, files, pollData: pd }: CreateThreadParams) =>
      forumApi.createThread(
        subgroupSlug,
        data,
        files.length > 0 ? files : undefined,
        pd || undefined,
      ),
    onSuccess: (thread) => {
      notifications.show({
        title: "Diskussion oprettet",
        message: "Din diskussion er blevet oprettet.",
        color: "green",
      })
      setTitle("")
      setContent("")
      setAttachments([])
      setPollData(null)
      clearDraft("new-thread-" + subgroupSlug)
      onSuccess(thread)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette diskussion. Prøv igen.",
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
      pollData: pollData || undefined,
    })
  }

  const handleAddFiles = (files: File[]) => {
    const { validFiles, errors } = filterFilesBySize(files)
    if (errors.length > 0) {
      errors.forEach((error) => {
        notifications.show({
          title: "Filen er for stor",
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
    <Modal
      opened={opened}
      onClose={onClose}
      title="Opret ny diskussion"
      size="lg"
    >
      <FileDropzone onDrop={handleAddFiles}>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Titel"
              placeholder="Hvad vil du diskutere?"
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
                placeholder="Skriv dit første indlæg..."
                minHeight={200}
                onFilePaste={handleAddFiles}
                draftKey={"new-thread-" + subgroupSlug}
              />
            </div>

            {pollData && (
              <PollCreator pollData={pollData} onChange={setPollData} />
            )}

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

            <Group justify="space-between">
              <Group gap="xs">
                {!pollData && (
                  <Button
                    variant="light"
                    leftSection={<IconChartBar size={16} />}
                    onClick={() =>
                      setPollData({
                        question: "",
                        allow_multiple_votes: false,
                        is_anonymous: false,
                        options: [{ text: "" }, { text: "" }],
                      })
                    }
                  >
                    Afstemning
                  </Button>
                )}
              </Group>
              <Group>
                <Button variant="light" onClick={onClose}>
                  Annuller
                </Button>
                <Button
                  type="submit"
                  loading={createMutation.isPending}
                  disabled={!title.trim() || !content.trim()}
                >
                  Opret diskussion
                </Button>
              </Group>
            </Group>
          </Stack>
        </form>
      </FileDropzone>
    </Modal>
  )
}

// =============================================================================
// Documents Tab Components
// =============================================================================

interface FolderPathEntry {
  id: number | null
  name: string
}

interface FolderAncestor {
  id: number
  name: string
}

interface DocumentsTabProps {
  subgroupSlug: string
  initialFolderId?: number | null
  onFolderChange?: (folderId: number | null) => void
}

function DocumentsTab({
  subgroupSlug,
  initialFolderId,
  onFolderChange,
}: DocumentsTabProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(
    initialFolderId ?? null,
  )
  const [folderPath, setFolderPath] = useState<FolderPathEntry[]>([
    { id: null, name: "Dokumenter" },
  ])
  // Track which folderId we've already processed to avoid re-fetching on our own navigations
  const processedFolderIdRef = useRef<number | null | undefined>(undefined)

  useEffect(() => {
    const targetId = initialFolderId ?? null
    if (processedFolderIdRef.current === targetId) return
    processedFolderIdRef.current = targetId

    if (targetId === null) {
      setCurrentFolderId(null)
      setFolderPath([{ id: null, name: "Dokumenter" }])
      return
    }

    // Reconstruct breadcrumb path by walking up through ancestors
    const buildPath = async () => {
      const ancestors: FolderAncestor[] = []
      let currentId: number | null = targetId
      while (currentId !== null) {
        const folder = await forumApi.getFolder(currentId)
        ancestors.unshift({ id: folder.id, name: folder.name })
        currentId = folder.parent
      }
      setCurrentFolderId(targetId)
      setFolderPath([{ id: null, name: "Dokumenter" }, ...ancestors])
    }

    buildPath()
  }, [initialFolderId])

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
    // Mark as processed so the effect doesn't re-fetch for this navigation
    processedFolderIdRef.current = folderId
    if (folderId === null) {
      setCurrentFolderId(null)
      setFolderPath([{ id: null, name: "Dokumenter" }])
    } else {
      setCurrentFolderId(folderId)
      const existingIndex = folderPath.findIndex((f) => f.id === folderId)
      if (existingIndex >= 0) {
        setFolderPath(folderPath.slice(0, existingIndex + 1))
      } else {
        setFolderPath([...folderPath, { id: folderId, name: folderName }])
      }
    }
    onFolderChange?.(folderId)
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
            description={`Max ${MAX_UPLOAD_FILE_SIZE_MB}MB`}
            value={file}
            onChange={(newFile) => {
              if (newFile) {
                const error = validateFileSize(newFile)
                if (error) {
                  notifications.show({
                    title: "Filen er for stor",
                    message: error,
                    color: "red",
                  })
                  return
                }
              }
              setFile(newFile)
            }}
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
