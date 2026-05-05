import {
  useState,
  useEffect,
  useRef,
  memo,
  useCallback,
  lazy,
  Suspense,
} from "react"

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
  ActionIcon,
  Menu,
  Modal,
  Divider,
  Typography,
  Badge,
  Image,
  SimpleGrid,
  Tooltip,
  Box,
  TextInput,
  Select,
  Checkbox,
  Alert,
  Skeleton,
} from "@mantine/core"

import { useDisclosure } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconSend,
  IconLock,
  IconLockOpen,
  IconEyeOff,
  IconChartBar,
  IconMessage,
  IconDeviceMobileMessage,
  IconBell,
  IconBellOff,
  IconArrowsMove,
  IconPin,
  IconPinnedOff,
  IconX,
  IconRestore,
} from "@tabler/icons-react"

import { forumApi } from "../api/forum"

import { messagingApi } from "../api/messaging"

import { BackButton } from "../components/BackButton"

import { useAuthStore } from "../store/authStore"

import { notificationsApi } from "../api/notifications"

import { filterFilesBySize } from "../config"

import { clearDraft } from "../utils/draftStorage"

import type { RichTextEditorProps } from "../components/RichTextEditor"
import { RichTextContent } from "../components/RichTextContent"

const RichTextEditorImpl = lazy(() => import("../components/RichTextEditor"))

function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={<Skeleton h={(props.minHeight ?? 150) + 50} radius="sm" />}
    >
      <RichTextEditorImpl {...props} />
    </Suspense>
  )
}

import FileDropzone, { AttachmentArea } from "../components/FileDropzone"

import Reactions from "../components/Reactions"

import PostDate from "../components/PostDate"

import UserLink from "../components/UserLink"

import PollDisplay from "../components/PollDisplay"

import PollCreator from "../components/PollCreator"

import {
  getFileIcon,
  getFileType,
  getFileTypeColor,
} from "../components/FilePreview"

import { AttachmentCarousel } from "../components/AttachmentCarousel"

import { AttachmentBadge } from "../components/AttachmentBadge"

import type {
  Post,
  CreatePostData,
  CreatePollData,
  PostAttachment,
} from "../types"

interface CreatePostParams {
  data: CreatePostData

  files: File[]

  pollData?: CreatePollData
}

interface UpdatePostParams {
  postId: number

  data: CreatePostData

  attachments?: File[]

  removeAttachmentIds?: number[]

  threadId?: number

  newTitle?: string
}

interface ReplyFormProps {
  threadId: number

  onSubmit: (content: string, files: File[], pollData?: CreatePollData) => void

  isPending: boolean

  submitKey: number
}

const ReplyForm = memo(function ReplyForm({
  threadId,

  onSubmit,

  isPending,

  submitKey,
}: ReplyFormProps) {
  const [content, setContent] = useState("")

  const [attachments, setAttachments] = useState<File[]>([])

  const [pollData, setPollData] = useState<CreatePollData | null>(null)

  useEffect(() => {
    if (submitKey > 0) {
      setContent("")

      setAttachments([])

      setPollData(null)
    }
  }, [submitKey])

  const isEmpty =
    (!content.trim() || content === "<p></p>") &&
    !content.includes("<img") &&
    attachments.length === 0 &&
    !pollData

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()

    if (isEmpty) return

    if (pollData?.options.some((o) => !o.text.trim())) {
      notifications.show({
        title: "Tomme valgmuligheder",
        message: "Alle valgmuligheder i afstemningen skal have tekst.",
        color: "red",
      })
      return
    }

    onSubmit(content.trim(), attachments, pollData || undefined)
  }

  const handleAddFiles = (files: File[]) => {
    const { validFiles, errors } = filterFilesBySize(files)

    if (errors.length > 0) {
      errors.forEach((error) => {
        notifications.show({
          title: "Fil for stor",

          message: error,

          color: "red",
        })
      })
    }

    if (validFiles.length > 0) {
      setAttachments((prev) => [
        ...prev,

        ...validFiles.filter((f) => !prev.some((p) => p.name === f.name)),
      ])
    }
  }

  return (
    <Paper withBorder p="lg" radius="md">
      <FileDropzone onDrop={handleAddFiles}>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Text fw={500}>Skriv et svar</Text>
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Skriv dit svar..."
              minHeight={150}
              onFilePaste={handleAddFiles}
              onSubmit={handleSubmit}
              draftKey={"reply-" + threadId}
            />
            {pollData && (
              <PollCreator
                pollData={pollData}
                onChange={setPollData}
                onClose={() => setPollData(null)}
              />
            )}
            <AttachmentArea onAddFiles={handleAddFiles}>
              {attachments.length > 0 && (
                <Group gap="xs">
                  {attachments.map((file, index) => (
                    <AttachmentBadge
                      key={`${file.name}-${file.size}-${index}`}
                      file={file}
                      onRemove={() =>
                        setAttachments((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
                      }
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

                        allow_others_to_add_options: false,

                        options: [{ text: "" }, { text: "" }],
                      })
                    }
                  >
                    Afstemning
                  </Button>
                )}
              </Group>
              <Button
                type="submit"
                leftSection={<IconSend size={16} />}
                loading={isPending}
                disabled={isEmpty}
              >
                Send svar
              </Button>
            </Group>
          </Stack>
        </form>
      </FileDropzone>
    </Paper>
  )
})

export default function ThreadPage() {
  const {
    id,

    threadSlug,

    slug: subgroupSlug,
  } = useParams<{
    id?: string

    threadSlug?: string

    slug?: string
  }>()

  const navigate = useNavigate()

  const location = useLocation()

  const queryClient = useQueryClient()

  const isSlugRoute = !!threadSlug

  const numericId = parseInt(id || "0", 10)

  const threadQueryKey: (string | number)[] = isSlugRoute
    ? ["thread", subgroupSlug!, threadSlug!]
    : ["thread", numericId]

  const [replySubmitKey, setReplySubmitKey] = useState(0)

  const [editingPost, setEditingPost] = useState<Post | null>(null)

  const [editContent, setEditContent] = useState("")

  const [editTitle, setEditTitle] = useState("")

  const [editPollData, setEditPollData] = useState<CreatePollData | null>(null)

  const [editAttachments, setEditAttachments] = useState<File[]>([])

  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<number[]>([])

  const [
    deleteModalOpened,

    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)

  const [postToDelete, setPostToDelete] = useState<number | null>(null)

  const [moveModalOpened, { open: openMoveModal, close: closeMoveModal }] =
    useDisclosure(false)

  const [targetSubgroupSlug, setTargetSubgroupSlug] = useState<string | null>(
    null,
  )

  const highlightedHashRef = useRef("")

  const {
    data: thread,

    isLoading,

    error,
  } = useQuery({
    queryKey: isSlugRoute
      ? ["thread", subgroupSlug, threadSlug]
      : ["thread", numericId],

    queryFn: () =>
      isSlugRoute
        ? forumApi.getThreadBySlug(subgroupSlug!, threadSlug!)
        : forumApi.getThread(numericId),

    enabled: isSlugRoute || !isNaN(numericId),
  })

  const { data: subgroups } = useQuery({
    queryKey: ["subgroups"],

    queryFn: forumApi.getSubgroups,
  })

  // Redirect to event page if this thread is an event discussion thread

  useEffect(() => {
    if (thread?.event_slug) {
      navigate(`/kalender/${thread.event_slug}${location.hash}`, {
        replace: true,
      })
    }
  }, [thread?.event_slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // If thread was moved to a different subgroup, update the URL to reflect the new location

  useEffect(() => {
    if (isSlugRoute && thread && thread.subgroup_slug !== subgroupSlug) {
      navigate(
        `/forum/${thread.subgroup_slug}/traad/${thread.slug}${location.hash}`,

        {
          replace: true,
        },
      )
    }
  }, [thread?.subgroup_slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // After thread loads (backend marks it as read), invalidate unread counts

  // and auto-mark any notification pointing to this thread as read

  useEffect(() => {
    if (thread) {
      queryClient.invalidateQueries({ queryKey: ["forum", "unread-count"] })

      queryClient.invalidateQueries({ queryKey: ["subgroups"] })

      queryClient.invalidateQueries({ queryKey: ["threads"] })

      void notificationsApi.markReadByLink(location.pathname).then(() => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] })

        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
      })
    }
  }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to and highlight a specific post when navigating from a notification

  useEffect(() => {
    if (
      !thread ||
      !location.hash ||
      highlightedHashRef.current === location.hash
    )
      return

    const el = document.getElementById(location.hash.slice(1))

    if (!el) return

    const hash = location.hash

    window.history.replaceState(null, "", location.pathname)

    // Small delay to ensure layout is settled. The ref is set inside the timer

    // so strict mode's cleanup+re-run cycle doesn't prevent the highlight from firing.

    const timer = setTimeout(() => {
      if (highlightedHashRef.current === hash) return

      highlightedHashRef.current = hash

      el.scrollIntoView({ behavior: "smooth", block: "center" })

      el.style.transition = "box-shadow 0.3s ease"

      el.style.boxShadow = "0 0 0 3px var(--mantine-color-blue-4)"

      setTimeout(() => {
        el.style.boxShadow = ""
      }, 2000)
    }, 100)

    return () => clearTimeout(timer)
  }, [thread, location.hash]) // eslint-disable-line react-hooks/exhaustive-deps

  const createPostMutation = useMutation({
    mutationFn: ({ data, files, pollData: pd }: CreatePostParams) =>
      forumApi.createPost(
        thread!.id,

        data,

        files.length > 0 ? files : undefined,

        pd || undefined,
      ),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      // Invalidate the subgroup thread list so the lock icon clears when
      // a reply auto-reopens a closed thread.
      queryClient.invalidateQueries({ queryKey: ["threads"] })

      clearDraft("reply-" + thread!.id)

      setReplySubmitKey((k) => k + 1)

      notifications.show({
        title: "Svar oprettet",

        message: "Dit svar er blevet tilføjet.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette svar. Prøv igen.")
    },
  })

  const updatePostMutation = useMutation({
    mutationFn: async ({
      postId,

      data,

      attachments,

      removeAttachmentIds: removeIds,

      threadId,

      newTitle,
    }: UpdatePostParams) => {
      await forumApi.updatePost(postId, data, attachments, removeIds)

      // Read current values from state at call time (not closure time)

      const currentEditPollData = editPollData

      const currentEditingPost = editingPost

      if (currentEditPollData && currentEditingPost?.poll) {
        await forumApi.updatePoll(
          currentEditingPost.poll.id,

          currentEditPollData,
        )
      }

      if (threadId !== undefined && newTitle !== undefined) {
        await forumApi.updateThread(threadId, { title: newTitle })
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      setEditingPost(null)

      setEditContent("")

      setEditTitle("")

      setEditPollData(null)

      setEditAttachments([])

      setRemovedAttachmentIds([])

      notifications.show({
        title: "Indlæg opdateret",

        message: "Dit indlæg er blevet opdateret.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere indlægget. Prøv igen.")
    },
  })

  const deletePostMutation = useMutation({
    mutationFn: forumApi.deletePost,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      closeDeleteModal()

      setPostToDelete(null)

      notifications.show({
        title: "Indlæg slettet",

        message: "Dit indlæg er blevet slettet.",

        color: "blue",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette indlægget. Prøv igen.")
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: forumApi.deleteThread,

    onSuccess: () => {
      notifications.show({
        title: "Tråd slettet",

        message: "Tråden er blevet slettet.",

        color: "blue",
      })

      navigate("/forum")
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette tråden. Prøv igen.")
    },
  })

  const muteThreadMutation = useMutation({
    mutationFn: () => forumApi.muteThread(thread!.id),

    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      notifications.show({
        title: data.is_muted
          ? "Notifikationer slået fra"
          : "Notifikationer slået til",

        message: data.is_muted
          ? "Du modtager ikke længere notifikationer fra denne tråd."
          : "Du modtager igen notifikationer fra denne tråd.",

        color: data.is_muted ? "gray" : "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke opdatere notifikationsindstillingen. Prøv igen.",
      )
    },
  })

  const closeThreadMutation = useMutation({
    mutationFn: (isClosed: boolean) =>
      forumApi.closeThread(thread!.id, isClosed),

    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      notifications.show({
        title: data.is_closed ? "Tråd lukket" : "Tråd genåbnet",

        message: data.is_closed
          ? "Denne tråd accepterer ikke længere nye svar."
          : "Denne tråd er nu åben for nye svar.",

        color: data.is_closed ? "orange" : "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke opdatere trådens status. Prøv igen.",
      )
    },
  })

  const pinThreadMutation = useMutation({
    mutationFn: (isPinned: boolean) => forumApi.pinThread(thread!.id, isPinned),

    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      notifications.show({
        title: data.is_pinned ? "Tråd fastgjort" : "Tråd løsnet",

        message: data.is_pinned
          ? "Tråden vises nu øverst i listen."
          : "Tråden er ikke længere fastgjort.",

        color: data.is_pinned ? "blue" : "gray",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke opdatere trådens status. Prøv igen.",
      )
    },
  })

  const togglePrivacyMutation = useMutation({
    mutationFn: (membersOnly: boolean) =>
      forumApi.updateThread(thread!.id, { members_only: membersOnly }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      notifications.show({
        title: "Tråd opdateret",

        message: "Trådens synlighed er blevet ændret.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke ændre trådens synlighed. Prøv igen.",
      )
    },
  })

  const moveThreadMutation = useMutation({
    mutationFn: (subgroupSlug: string) =>
      forumApi.moveThread(thread!.id, subgroupSlug),

    onSuccess: (data) => {
      closeMoveModal()

      setTargetSubgroupSlug(null)

      notifications.show({
        title: "Tråd flyttet",

        message: "Tråden er blevet flyttet til den valgte gruppe.",

        color: "green",
      })

      navigate(`/forum/${data.subgroup_slug}/traad/${data.thread_slug}`)
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke flytte tråden. Prøv igen.")
    },
  })

  const handleReplySubmit = useCallback(
    (content: string, files: File[], pollData?: CreatePollData) => {
      createPostMutation.mutate({ data: { content }, files, pollData })
    },

    // eslint-disable-next-line react-hooks/exhaustive-deps

    [createPostMutation.mutate],
  )

  const handleStartEdit = (post: Post) => {
    setEditingPost(post)

    setEditContent(post.content)

    if (thread && post.id === thread.posts[0]?.id) {
      setEditTitle(thread.title)
    } else {
      setEditTitle("")
    }

    if (post.poll) {
      setEditPollData({
        question: post.poll.question,

        allow_multiple_votes: post.poll.allow_multiple_votes,

        is_anonymous: post.poll.is_anonymous,

        allow_others_to_add_options: post.poll.allow_others_to_add_options,

        options: post.poll.options.map((o) => ({ id: o.id, text: o.text })),
      })
    } else {
      setEditPollData(null)
    }
  }

  const handleSaveEdit = () => {
    if (!editingPost) return

    const isFirstPost = thread && editingPost.id === thread.posts[0]?.id

    if (isFirstPost && !editTitle.trim()) return

    if (editPollData?.options.some((o) => !o.text.trim())) {
      notifications.show({
        title: "Tomme valgmuligheder",
        message: "Alle valgmuligheder i afstemningen skal have tekst.",
        color: "red",
      })
      return
    }

    updatePostMutation.mutate({
      postId: editingPost.id,

      data: { content: editContent.trim() },

      attachments: editAttachments.length > 0 ? editAttachments : undefined,

      removeAttachmentIds:
        removedAttachmentIds.length > 0 ? removedAttachmentIds : undefined,

      ...(isFirstPost && thread
        ? { threadId: thread.id, newTitle: editTitle.trim() }
        : {}),
    })
  }

  const handleDeleteClick = (postId: number) => {
    setPostToDelete(postId)

    openDeleteModal()
  }

  const handleConfirmDelete = () => {
    if (postToDelete) {
      deletePostMutation.mutate(postToDelete)
    }
  }

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !thread) {
    return (
      <Center h={200}>
        <Text c="red">Tråden blev ikke fundet.</Text>
      </Center>
    )
  }

  return (
    <>
      <BackButton
        to={`/forum/${thread.subgroup_slug}`}
        label={`Tilbage til ${thread.subgroup_name}`}
      />

      {thread.posts[0] && (
        <PostCard
          key={thread.posts[0].id}
          post={thread.posts[0]}
          threadQueryKey={threadQueryKey}
          threadHeader={
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" c="dimmed" mb={4}>
                  {thread.subgroup_name}
                </Text>
                <Group gap="sm" wrap="wrap">
                  <Title order={2} style={{ wordBreak: "break-word" }}>
                    {thread.title}
                  </Title>
                  {thread.is_pinned && (
                    <Badge color="blue" leftSection={<IconPin size={12} />}>
                      Fastgjort
                    </Badge>
                  )}
                  {thread.is_closed && (
                    <Badge color="orange" leftSection={<IconLock size={12} />}>
                      Lukket
                    </Badge>
                  )}
                  {thread.members_only && (
                    <Badge color="grape" leftSection={<IconEyeOff size={12} />}>
                      Kun for medlemmer af {thread.subgroup_name}
                    </Badge>
                  )}
                </Group>
              </div>
              <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                <Tooltip
                  label={
                    thread.is_muted
                      ? "Slå notifikationer til"
                      : "Slå notifikationer fra"
                  }
                >
                  <ActionIcon
                    variant="subtle"
                    color={thread.is_muted ? "gray" : undefined}
                    onClick={() => muteThreadMutation.mutate()}
                    loading={muteThreadMutation.isPending}
                  >
                    {thread.is_muted ? (
                      <IconBellOff size={16} />
                    ) : (
                      <IconBell size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
                <Menu shadow="md" width={200}>
                  <Menu.Target>
                    <ActionIcon variant="subtle">
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={
                        thread.is_pinned ? (
                          <IconPinnedOff size={14} />
                        ) : (
                          <IconPin size={14} />
                        )
                      }
                      onClick={() =>
                        pinThreadMutation.mutate(!thread.is_pinned)
                      }
                    >
                      {thread.is_pinned ? "Løsn tråd" : "Fastgør tråd"}
                    </Menu.Item>
                    {thread.can_close && (
                      <Menu.Item
                        leftSection={
                          thread.is_closed ? (
                            <IconLockOpen size={14} />
                          ) : (
                            <IconLock size={14} />
                          )
                        }
                        onClick={() =>
                          closeThreadMutation.mutate(!thread.is_closed)
                        }
                      >
                        {thread.is_closed ? "Genåbn tråd" : "Luk tråd"}
                      </Menu.Item>
                    )}
                    {thread.can_edit && (
                      <Menu.Item
                        leftSection={<IconArrowsMove size={14} />}
                        onClick={openMoveModal}
                      >
                        Flyt tråd
                      </Menu.Item>
                    )}
                    {thread.can_toggle_privacy && (
                      <Menu.Item
                        leftSection={<IconEyeOff size={14} />}
                        onClick={() => {
                          const next = !thread.members_only

                          const confirmMsg = next
                            ? "Gør denne tråd privat? Den vil kun være synlig for medlemmer af gruppen (og forfatteren)."
                            : "Gør denne tråd offentlig? Den vil blive synlig for alle."

                          if (window.confirm(confirmMsg)) {
                            togglePrivacyMutation.mutate(next)
                          }
                        }}
                      >
                        {thread.members_only ? "Gør offentlig" : "Gør privat"}
                      </Menu.Item>
                    )}
                    {thread.can_edit && (
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => deleteThreadMutation.mutate(thread.id)}
                      >
                        Slet tråd
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          }
          isEditing={editingPost?.id === thread.posts[0].id}
          editContent={editContent}
          onEditContentChange={setEditContent}
          editTitle={
            editingPost?.id === thread.posts[0].id ? editTitle : undefined
          }
          onEditTitleChange={setEditTitle}
          editPollData={
            editingPost?.id === thread.posts[0].id ? editPollData : null
          }
          onEditPollDataChange={setEditPollData}
          editAttachments={editAttachments}
          onEditAttachmentsChange={setEditAttachments}
          removedAttachmentIds={removedAttachmentIds}
          onRemoveExistingAttachment={(id) =>
            setRemovedAttachmentIds((prev) => [...prev, id])
          }
          onRestoreExistingAttachment={(id) =>
            setRemovedAttachmentIds((prev) => prev.filter((x) => x !== id))
          }
          onStartEdit={() => handleStartEdit(thread.posts[0])}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => {
            setEditingPost(null)

            setEditContent("")

            setEditTitle("")

            setEditPollData(null)

            setEditAttachments([])

            setRemovedAttachmentIds([])
          }}
          onDelete={() => handleDeleteClick(thread.posts[0].id)}
          isSaving={updatePostMutation.isPending}
        />
      )}

      {thread.posts.length > 1 && (
        <>
          <Title order={4} mt="xl" mb="md">
            {thread.posts.length - 1} svar
          </Title>
          <Stack gap="md" mb="xl">
            {thread.posts.slice(1).map((post) => (
              <PostCard
                key={post.id}
                post={post}
                threadQueryKey={threadQueryKey}
                isEditing={editingPost?.id === post.id}
                editContent={editContent}
                onEditContentChange={setEditContent}
                editPollData={editingPost?.id === post.id ? editPollData : null}
                onEditPollDataChange={setEditPollData}
                editAttachments={editAttachments}
                onEditAttachmentsChange={setEditAttachments}
                removedAttachmentIds={removedAttachmentIds}
                onRemoveExistingAttachment={(id) =>
                  setRemovedAttachmentIds((prev) => [...prev, id])
                }
                onRestoreExistingAttachment={(id) =>
                  setRemovedAttachmentIds((prev) =>
                    prev.filter((x) => x !== id),
                  )
                }
                onStartEdit={() => handleStartEdit(post)}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={() => {
                  setEditingPost(null)

                  setEditContent("")

                  setEditTitle("")

                  setEditPollData(null)

                  setEditAttachments([])

                  setRemovedAttachmentIds([])
                }}
                onDelete={() => handleDeleteClick(post.id)}
                isSaving={updatePostMutation.isPending}
              />
            ))}
          </Stack>
        </>
      )}

      <Divider my="lg" />

      {thread.is_closed && (
        <Paper
          withBorder
          p="sm"
          radius="md"
          bg="var(--mantine-color-default-hover)"
          mb="md"
        >
          <Group justify="center" gap="xs">
            <IconLock size={16} color="var(--mantine-color-gray-6)" />
            <Text size="sm" c="dimmed">
              Tråden er lukket — et nyt svar genåbner den.
            </Text>
          </Group>
        </Paper>
      )}
      <ReplyForm
        threadId={thread.id}
        onSubmit={handleReplySubmit}
        isPending={createPostMutation.isPending}
        submitKey={replySubmitKey}
      />

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Slet indlæg"
        centered
      >
        <Text mb="lg">
          Er du sikker på, at du vil slette dette indlæg? Handlingen kan ikke
          fortrydes.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deletePostMutation.isPending}
          >
            Slet
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={moveModalOpened}
        onClose={closeMoveModal}
        title="Flyt tråd"
      >
        <Text mb="md">Vælg den gruppe du vil flytte tråden til.</Text>
        <Select
          label="Gruppe"
          placeholder="Vælg gruppe"
          data={
            subgroups

              ?.filter((sg) => sg.slug !== thread.subgroup_slug)

              .map((sg) => ({ value: sg.slug, label: sg.name })) ?? []
          }
          value={targetSubgroupSlug}
          onChange={setTargetSubgroupSlug}
          mb="lg"
          searchable
        />
        <Group justify="flex-end">
          <Button variant="light" onClick={closeMoveModal}>
            Annuller
          </Button>
          <Button
            onClick={() => {
              if (targetSubgroupSlug) {
                moveThreadMutation.mutate(targetSubgroupSlug)
              }
            }}
            loading={moveThreadMutation.isPending}
            disabled={!targetSubgroupSlug}
          >
            Flyt
          </Button>
        </Group>
      </Modal>
    </>
  )
}

interface PostCardProps {
  post: Post

  threadQueryKey: (string | number)[]

  threadHeader?: React.ReactNode

  isEditing: boolean

  editContent: string

  onEditContentChange: (content: string) => void

  editTitle?: string

  onEditTitleChange?: (title: string) => void

  editPollData: CreatePollData | null

  onEditPollDataChange: (data: CreatePollData) => void

  editAttachments: File[]

  onEditAttachmentsChange: (files: File[]) => void

  removedAttachmentIds: number[]

  onRemoveExistingAttachment: (id: number) => void

  onRestoreExistingAttachment: (id: number) => void

  onStartEdit: () => void

  onSaveEdit: () => void

  onCancelEdit: () => void

  onDelete: () => void

  isSaving: boolean
}

function PostCard({
  post,

  threadQueryKey,

  threadHeader,

  isEditing,

  editContent,

  onEditContentChange,

  editTitle,

  onEditTitleChange,

  editPollData,

  onEditPollDataChange,

  editAttachments,

  onEditAttachmentsChange,

  removedAttachmentIds,

  onRemoveExistingAttachment,

  onRestoreExistingAttachment,

  onStartEdit,

  onSaveEdit,

  onCancelEdit,

  onDelete,

  isSaving,
}: PostCardProps) {
  const navigate = useNavigate()

  const { user: currentUser } = useAuthStore()

  const [carouselOpened, setCarouselOpened] = useState(false)

  const [carouselInitialIndex, setCarouselInitialIndex] = useState(0)

  const [consentModalOpened, setConsentModalOpened] = useState(false)

  const [consentChecked, setConsentChecked] = useState(false)

  const isAdminEditingOther =
    currentUser?.is_staff && post.author?.id !== currentUser.id

  const handleEditClick = () => {
    if (isAdminEditingOther) {
      setConsentChecked(false)

      setConsentModalOpened(true)
    } else {
      onStartEdit()
    }
  }

  // Sort attachments: images first, then other files

  const imageAttachments =
    post.attachments?.filter((att) => getFileType(att.name) === "image") || []

  const otherAttachments =
    post.attachments?.filter((att) => getFileType(att.name) !== "image") || []

  const allAttachments = [...imageAttachments, ...otherAttachments]

  const handleAttachmentClick = (attachment: PostAttachment) => {
    const index = allAttachments.findIndex((att) => att.id === attachment.id)

    setCarouselInitialIndex(index >= 0 ? index : 0)

    setCarouselOpened(true)
  }

  const dmMutation = useMutation({
    mutationFn: () =>
      messagingApi.createConversation({ participant_ids: [post.author!.id] }),

    onSuccess: (conversation) => {
      navigate(`/beskeder/${conversation.id}`)
    },
  })

  return (
    <>
      <Paper id={`post-${post.id}`} withBorder p="md" radius="md">
        {threadHeader && (
          <>
            {threadHeader}
            <Divider my="md" />
          </>
        )}
        <Group justify="space-between" wrap="nowrap" align="flex-start" mb="sm">
          <Group
            gap="sm"
            wrap="nowrap"
            align="flex-start"
            style={{ flex: 1, minWidth: 0 }}
          >
            <Avatar src={post.author?.profile_picture} radius="xl" size="md">
              {post.author?.first_name?.[0]}
              {post.author?.last_name?.[0]}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={500}>
                {post.author ? (
                  <UserLink
                    id={post.author.id}
                    firstName={post.author.first_name}
                    lastName={post.author.last_name}
                    fw={500}
                  />
                ) : (
                  <Text component="span" size="sm" c="dimmed" fw={500}>
                    Slettet bruger
                  </Text>
                )}
              </Text>
              <PostDate
                createdAt={post.created_at}
                updatedAt={post.updated_at}
                editedBy={post.edited_by}
              />
            </div>
          </Group>

          {post.can_edit && !isEditing && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconEdit size={14} />}
                  onClick={handleEditClick}
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

        {isEditing ? (
          <FileDropzone
            onDrop={(files) => {
              const { validFiles, errors } = filterFilesBySize(files)

              if (errors.length > 0) {
                errors.forEach((error) => {
                  notifications.show({
                    title: "Fil for stor",

                    message: error,

                    color: "red",
                  })
                })
              }

              if (validFiles.length > 0) {
                onEditAttachmentsChange([
                  ...editAttachments,

                  ...validFiles.filter(
                    (f) => !editAttachments.some((p) => p.name === f.name),
                  ),
                ])
              }
            }}
          >
            <Stack gap="sm">
              {editTitle !== undefined && onEditTitleChange && (
                <TextInput
                  label="Titel"
                  value={editTitle}
                  onChange={(e) => onEditTitleChange(e.currentTarget.value)}
                  required
                />
              )}
              <RichTextEditor
                content={editContent}
                onChange={onEditContentChange}
                placeholder="Rediger dit indlæg..."
                minHeight={150}
                onSubmit={onSaveEdit}
                onFilePaste={(files) => {
                  const { validFiles, errors } = filterFilesBySize(files)

                  if (errors.length > 0) {
                    errors.forEach((error) => {
                      notifications.show({
                        title: "Fil for stor",

                        message: error,

                        color: "red",
                      })
                    })
                  }

                  if (validFiles.length > 0) {
                    onEditAttachmentsChange([
                      ...editAttachments,

                      ...validFiles.filter(
                        (f) => !editAttachments.some((p) => p.name === f.name),
                      ),
                    ])
                  }
                }}
              />
              {editPollData && (
                <PollCreator
                  pollData={editPollData}
                  onChange={onEditPollDataChange}
                />
              )}
              <AttachmentArea
                onAddFiles={(files) => {
                  const { validFiles, errors } = filterFilesBySize(files)

                  if (errors.length > 0) {
                    errors.forEach((error) => {
                      notifications.show({
                        title: "Fil for stor",

                        message: error,

                        color: "red",
                      })
                    })
                  }

                  if (validFiles.length > 0) {
                    onEditAttachmentsChange([
                      ...editAttachments,

                      ...validFiles.filter(
                        (f) => !editAttachments.some((p) => p.name === f.name),
                      ),
                    ])
                  }
                }}
              >
                {(post.attachments?.length > 0 ||
                  editAttachments.length > 0) && (
                  <Group gap="xs">
                    {post.attachments?.map((att) => {
                      const isRemoved = removedAttachmentIds.includes(att.id)

                      const FileIcon = getFileIcon(att.name)

                      const fileColor = getFileTypeColor(att.name)

                      return (
                        <Badge
                          key={`existing-${att.id}`}
                          variant="light"
                          color={isRemoved ? "gray" : fileColor}
                          size="lg"
                          leftSection={<FileIcon size={14} />}
                          rightSection={
                            <ActionIcon
                              size="xs"
                              variant="transparent"
                              color={isRemoved ? "blue" : fileColor}
                              onClick={() =>
                                isRemoved
                                  ? onRestoreExistingAttachment(att.id)
                                  : onRemoveExistingAttachment(att.id)
                              }
                            >
                              {isRemoved ? (
                                <IconRestore size={12} />
                              ) : (
                                <IconX size={12} />
                              )}
                            </ActionIcon>
                          }
                          style={{
                            paddingRight: 4,

                            textDecoration: isRemoved
                              ? "line-through"
                              : undefined,

                            opacity: isRemoved ? 0.5 : 1,
                          }}
                        >
                          {att.name.length > 20
                            ? `${att.name.slice(0, 17)}...`
                            : att.name}
                        </Badge>
                      )
                    })}
                    {editAttachments.map((file, index) => (
                      <AttachmentBadge
                        key={`${file.name}-${file.size}-${index}`}
                        file={file}
                        onRemove={() =>
                          onEditAttachmentsChange(
                            editAttachments.filter((_, i) => i !== index),
                          )
                        }
                      />
                    ))}
                  </Group>
                )}
              </AttachmentArea>
              <Group justify="flex-end">
                <Button variant="light" size="sm" onClick={onCancelEdit}>
                  Annuller
                </Button>
                <Button
                  size="sm"
                  onClick={onSaveEdit}
                  loading={isSaving}
                  disabled={editTitle !== undefined && !editTitle.trim()}
                >
                  Gem
                </Button>
              </Group>
            </Stack>
          </FileDropzone>
        ) : (
          <>
            <Typography>
              <RichTextContent html={post.content} />
            </Typography>

            {imageAttachments.length > 0 && (
              <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} mt="md" spacing="sm">
                {imageAttachments.map((att) => (
                  <Image
                    key={att.id}
                    src={att.file_url}
                    alt={att.name}
                    radius="md"
                    fit="cover"
                    h={120}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleAttachmentClick(att)}
                  />
                ))}
              </SimpleGrid>
            )}

            {otherAttachments.length > 0 && (
              <Group gap="xs" mt="md">
                {otherAttachments.map((att) => {
                  const FileIcon = getFileIcon(att.name)

                  const fileColor = getFileTypeColor(att.name)

                  return (
                    <Badge
                      key={att.id}
                      variant="light"
                      color={fileColor}
                      size="lg"
                      leftSection={<FileIcon size={14} />}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleAttachmentClick(att)}
                    >
                      {att.name.length > 25
                        ? `${att.name.slice(0, 22)}...`
                        : att.name}
                    </Badge>
                  )
                })}
              </Group>
            )}

            {post.poll && (
              <PollDisplay poll={post.poll} threadQueryKey={threadQueryKey} />
            )}

            <Divider my="sm" />
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Reactions
                postId={post.id}
                threadQueryKey={threadQueryKey}
                reactions={post.reactions || []}
              />
              {post.author && post.author.id !== currentUser?.id && (
                <Group gap="xs">
                  <Tooltip label="Svar i privat besked">
                    <Button
                      variant="subtle"
                      color="blue"
                      size="xs"
                      leftSection={<IconMessage size={14} />}
                      onClick={() => dmMutation.mutate()}
                      loading={dmMutation.isPending}
                    >
                      Svar privat
                    </Button>
                  </Tooltip>
                  {post.author.phone_number && (
                    <>
                      <Box hiddenFrom="sm">
                        <Button
                          variant="subtle"
                          color="gray"
                          size="xs"
                          leftSection={<IconDeviceMobileMessage size={14} />}
                          component="a"
                          href={`sms:${post.author.phone_number}`}
                        >
                          SMS
                        </Button>
                      </Box>
                      <Box visibleFrom="sm">
                        <Text size="sm" c="dimmed">
                          {post.author.phone_number}
                        </Text>
                      </Box>
                    </>
                  )}
                </Group>
              )}
            </Group>
          </>
        )}
      </Paper>

      <AttachmentCarousel
        attachments={allAttachments}
        opened={carouselOpened}
        onClose={() => setCarouselOpened(false)}
        initialIndex={carouselInitialIndex}
      />

      <Modal
        opened={consentModalOpened}
        onClose={() => setConsentModalOpened(false)}
        title="Rediger en anden brugers indhold"
        centered
        fullScreen={false}
      >
        <Stack>
          <Alert color="orange" variant="light">
            <Text size="sm">
              Indholdet tilhører en anden bruger. Ændringer må kun foretages med
              forudgående samtykke fra forfatteren.
            </Text>
          </Alert>
          <Checkbox
            label="Samtykke fra forfatteren er indhentet forud for denne ændring"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setConsentModalOpened(false)}
            >
              Annuller
            </Button>
            <Button
              disabled={!consentChecked}
              onClick={() => {
                setConsentModalOpened(false)

                onStartEdit()
              }}
            >
              Fortsæt
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
