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
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconSend,
  IconLock,
  IconLockOpen,
  IconChartBar,
  IconMessage,
  IconDeviceMobileMessage,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { forumApi } from "../api/forum"
import { messagingApi } from "../api/messaging"
import { useAuthStore } from "../store/authStore"
import { notificationsApi } from "../api/notifications"
import { filterFilesBySize } from "../config"
import { clearDraft } from "../utils/draftStorage"
import RichTextEditor from "../components/RichTextEditor"
import FileDropzone, { AttachmentArea } from "../components/FileDropzone"
import Reactions from "../components/Reactions"
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
}

dayjs.extend(relativeTime)

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

  const [newPostContent, setNewPostContent] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [pollData, setPollData] = useState<CreatePollData | null>(null)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editPollData, setEditPollData] = useState<CreatePollData | null>(null)
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)
  const [postToDelete, setPostToDelete] = useState<number | null>(null)

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

  // Redirect to event page if this thread is an event discussion thread
  useEffect(() => {
    if (thread?.event_id) {
      navigate(`/kalender/${thread.event_id}${location.hash}`, {
        replace: true,
      })
    }
  }, [thread?.event_id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!thread || !location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (!el) return
    // Clear the hash immediately so re-renders and navigation away don't re-trigger the highlight
    navigate(location.pathname, { replace: true })
    // Small delay to ensure layout is settled
    const timer = setTimeout(() => {
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
      setNewPostContent("")
      setAttachments([])
      setPollData(null)
      clearDraft("reply-" + thread!.id)
      notifications.show({
        title: "Reply posted",
        message: "Your reply has been added.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to post reply. Please try again.",
        color: "red",
      })
    },
  })

  const updatePostMutation = useMutation({
    mutationFn: async ({ postId, data }: UpdatePostParams) => {
      await forumApi.updatePost(postId, data)
      if (editPollData && editingPost?.poll) {
        await forumApi.updatePoll(editingPost.poll.id, editPollData)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })
      setEditingPost(null)
      setEditContent("")
      setEditPollData(null)
      notifications.show({
        title: "Indlæg opdateret",
        message: "Dit indlæg er blevet opdateret.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere indlægget. Prøv igen.",
        color: "red",
      })
    },
  })

  const deletePostMutation = useMutation({
    mutationFn: forumApi.deletePost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })
      closeDeleteModal()
      setPostToDelete(null)
      notifications.show({
        title: "Post deleted",
        message: "Your post has been deleted.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to delete post. Please try again.",
        color: "red",
      })
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: forumApi.deleteThread,
    onSuccess: () => {
      notifications.show({
        title: "Thread deleted",
        message: "The thread has been deleted.",
        color: "blue",
      })
      navigate("/forum")
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to delete thread. Please try again.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere trådens status. Prøv igen.",
        color: "red",
      })
    },
  })

  const isPostEmpty =
    (!newPostContent.trim() || newPostContent === "<p></p>") &&
    attachments.length === 0 &&
    !pollData

  const handleSubmitPost = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPostEmpty) return
    createPostMutation.mutate({
      data: { content: newPostContent.trim() },
      files: attachments,
      pollData: pollData || undefined,
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
      setAttachments((prev) => [
        ...prev,
        ...validFiles.filter((f) => !prev.some((p) => p.name === f.name)),
      ])
    }
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleStartEdit = (post: Post) => {
    setEditingPost(post)
    setEditContent(post.content)
    if (post.poll) {
      setEditPollData({
        question: post.poll.question,
        allow_multiple_votes: post.poll.allow_multiple_votes,
        is_anonymous: post.poll.is_anonymous,
        options: post.poll.options.map((o) => ({ id: o.id, text: o.text })),
      })
    } else {
      setEditPollData(null)
    }
  }

  const handleSaveEdit = () => {
    if (!editingPost) return
    updatePostMutation.mutate({
      postId: editingPost.id,
      data: { content: editContent.trim() },
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
        <Text c="red">Thread not found.</Text>
      </Center>
    )
  }

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate(`/forum/${thread.subgroup_slug}`)}
        mb="md"
      >
        Tilbage
      </Button>

      {thread.posts[0] && (
        <PostCard
          key={thread.posts[0].id}
          post={thread.posts[0]}
          threadQueryKey={threadQueryKey}
          threadHeader={
            <Group justify="space-between">
              <div>
                <Text size="sm" c="dimmed" mb={4}>
                  {thread.subgroup_name}
                </Text>
                <Group gap="sm">
                  <Title order={2}>{thread.title}</Title>
                  {thread.is_closed && (
                    <Badge color="orange" leftSection={<IconLock size={12} />}>
                      Lukket
                    </Badge>
                  )}
                </Group>
              </div>
              {(thread.can_edit || thread.can_close) && (
                <Menu shadow="md" width={200}>
                  <Menu.Target>
                    <ActionIcon variant="subtle">
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
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
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => deleteThreadMutation.mutate(thread.id)}
                      >
                        Slet tråd
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          }
          isEditing={editingPost?.id === thread.posts[0].id}
          editContent={editContent}
          onEditContentChange={setEditContent}
          editPollData={
            editingPost?.id === thread.posts[0].id ? editPollData : null
          }
          onEditPollDataChange={setEditPollData}
          onStartEdit={() => handleStartEdit(thread.posts[0])}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => {
            setEditingPost(null)
            setEditContent("")
            setEditPollData(null)
          }}
          onDelete={() => handleDeleteClick(thread.posts[0].id)}
          isSaving={updatePostMutation.isPending}
        />
      )}

      {thread.posts.length > 1 && (
        <>
          <Title order={4} mt="xl" mb="md">
            {thread.posts.length - 1}{" "}
            {thread.posts.length - 1 === 1 ? "svar" : "svar"}
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
                onStartEdit={() => handleStartEdit(post)}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={() => {
                  setEditingPost(null)
                  setEditContent("")
                  setEditPollData(null)
                }}
                onDelete={() => handleDeleteClick(post.id)}
                isSaving={updatePostMutation.isPending}
              />
            ))}
          </Stack>
        </>
      )}

      <Divider my="lg" />

      {thread.is_closed ? (
        <Paper
          withBorder
          p="lg"
          radius="md"
          bg="var(--mantine-color-default-hover)"
        >
          <Group justify="center" gap="xs">
            <IconLock size={20} color="var(--mantine-color-gray-6)" />
            <Text c="dimmed">
              Denne tråd er lukket og accepterer ikke længere nye svar.
            </Text>
          </Group>
        </Paper>
      ) : (
        <Paper withBorder p="lg" radius="md">
          <FileDropzone onDrop={handleAddFiles}>
            <form onSubmit={handleSubmitPost}>
              <Stack gap="md">
                <Text fw={500}>Add a Reply</Text>
                <RichTextEditor
                  content={newPostContent}
                  onChange={setNewPostContent}
                  placeholder="Write your reply..."
                  minHeight={150}
                  onFilePaste={handleAddFiles}
                  draftKey={"reply-" + thread.id}
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
                  <Button
                    type="submit"
                    leftSection={<IconSend size={16} />}
                    loading={createPostMutation.isPending}
                    disabled={isPostEmpty}
                  >
                    Post Reply
                  </Button>
                </Group>
              </Stack>
            </form>
          </FileDropzone>
        </Paper>
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Delete Post"
        centered
      >
        <Text mb="lg">
          Are you sure you want to delete this post? This action cannot be
          undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deletePostMutation.isPending}
          >
            Delete
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
  editPollData: CreatePollData | null
  onEditPollDataChange: (data: CreatePollData) => void
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
  editPollData,
  onEditPollDataChange,
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
      messagingApi.createConversation({ participant_ids: [post.author.id] }),
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
        <Group justify="space-between" mb="sm">
          <Group gap="sm">
            <Avatar src={post.author.profile_picture} radius="xl" size="md">
              {post.author.first_name?.[0]}
              {post.author.last_name?.[0]}
            </Avatar>
            <div>
              <Text size="sm" fw={500}>
                <UserLink
                  id={post.author.id}
                  firstName={post.author.first_name}
                  lastName={post.author.last_name}
                  fw={500}
                />
              </Text>
              <Text size="xs" c="dimmed">
                {dayjs(post.created_at).format("MMM D, YYYY [at] h:mm A")}
                {post.updated_at !== post.created_at && " (edited)"}
              </Text>
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
                  onClick={onStartEdit}
                >
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

        {isEditing ? (
          <Stack gap="sm">
            <RichTextEditor
              content={editContent}
              onChange={onEditContentChange}
              placeholder="Rediger dit indlæg..."
              minHeight={150}
            />
            {editPollData && (
              <PollCreator
                pollData={editPollData}
                onChange={onEditPollDataChange}
              />
            )}
            <Group justify="flex-end">
              <Button variant="light" size="sm" onClick={onCancelEdit}>
                Annuller
              </Button>
              <Button size="sm" onClick={onSaveEdit} loading={isSaving}>
                Gem
              </Button>
            </Group>
          </Stack>
        ) : (
          <>
            <Typography>
              <div dangerouslySetInnerHTML={{ __html: post.content }} />
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
              {post.author.id !== currentUser?.id && (
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
                      Svar i privat besked
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
    </>
  )
}
