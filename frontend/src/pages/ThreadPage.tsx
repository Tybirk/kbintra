import { useState, useRef } from "react"
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
  ActionIcon,
  Menu,
  Modal,
  Divider,
  TypographyStylesProvider,
  FileButton,
  Badge,
  Image,
  SimpleGrid,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconSend,
  IconPaperclip,
  IconX,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

import { forumApi } from "../api/forum"
import RichTextEditor from "../components/RichTextEditor"
import Reactions from "../components/Reactions"
import {
  getFileIcon,
  getFileType,
  getFileTypeColor,
} from "../components/FilePreview"
import { AttachmentCarousel } from "../components/AttachmentCarousel"
import type { Post, CreatePostData, PostAttachment } from "../types"

interface CreatePostParams {
  data: CreatePostData
  files: File[]
}

interface UpdatePostParams {
  postId: number
  data: CreatePostData
}

dayjs.extend(relativeTime)

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const threadId = parseInt(id!, 10)

  const [newPostContent, setNewPostContent] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const resetRef = useRef<() => void>(null)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [editContent, setEditContent] = useState("")
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
    queryKey: ["thread", threadId],
    queryFn: () => forumApi.getThread(threadId),
    enabled: !isNaN(threadId),
  })

  const createPostMutation = useMutation({
    mutationFn: ({ data, files }: CreatePostParams) =>
      forumApi.createPost(threadId, data, files.length > 0 ? files : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      setNewPostContent("")
      setAttachments([])
      resetRef.current?.()
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
    mutationFn: ({ postId, data }: UpdatePostParams) =>
      forumApi.updatePost(postId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      setEditingPost(null)
      setEditContent("")
      notifications.show({
        title: "Post updated",
        message: "Your post has been updated.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to update post. Please try again.",
        color: "red",
      })
    },
  })

  const deletePostMutation = useMutation({
    mutationFn: forumApi.deletePost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
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

  const handleSubmitPost = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPostContent.trim()) return
    createPostMutation.mutate({
      data: { content: newPostContent.trim() },
      files: attachments,
    })
  }

  const handleAddFiles = (files: File[]) => {
    setAttachments((prev) => [...prev, ...files])
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleStartEdit = (post: Post) => {
    setEditingPost(post)
    setEditContent(post.content)
  }

  const handleSaveEdit = () => {
    if (!editingPost || !editContent.trim()) return
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
        onClick={() => navigate(-1)}
        mb="md"
      >
        Back
      </Button>

      <Paper withBorder p="lg" radius="md" mb="lg">
        <Group justify="space-between" mb="md">
          <div>
            <Text size="sm" c="dimmed" mb={4}>
              {thread.subgroup_name}
            </Text>
            <Title order={2}>{thread.title}</Title>
          </div>
          {thread.is_own && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => deleteThreadMutation.mutate(threadId)}
                >
                  Delete Thread
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>

        <Group gap="sm">
          <Avatar src={thread.author.profile_picture} radius="xl" size="sm">
            {thread.author.first_name?.[0]}
            {thread.author.last_name?.[0]}
          </Avatar>
          <Text size="sm">
            {thread.author.first_name} {thread.author.last_name}
          </Text>
          <Text size="sm" c="dimmed">
            {dayjs(thread.created_at).format("MMM D, YYYY [at] h:mm A")}
          </Text>
        </Group>
      </Paper>

      <Title order={4} mb="md">
        {thread.posts.length} {thread.posts.length === 1 ? "Reply" : "Replies"}
      </Title>

      <Stack gap="md" mb="xl">
        {thread.posts.map((post, index) => (
          <PostCard
            key={post.id}
            post={post}
            threadId={threadId}
            isFirst={index === 0}
            isEditing={editingPost?.id === post.id}
            editContent={editContent}
            onEditContentChange={setEditContent}
            onStartEdit={() => handleStartEdit(post)}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={() => {
              setEditingPost(null)
              setEditContent("")
            }}
            onDelete={() => handleDeleteClick(post.id)}
            isSaving={updatePostMutation.isPending}
          />
        ))}
      </Stack>

      <Divider my="lg" />

      <Paper withBorder p="lg" radius="md">
        <form onSubmit={handleSubmitPost}>
          <Stack gap="md">
            <Text fw={500}>Add a Reply</Text>
            <RichTextEditor
              content={newPostContent}
              onChange={setNewPostContent}
              placeholder="Write your reply..."
              minHeight={150}
            />

            {attachments.length > 0 && (
              <Group gap="xs">
                {attachments.map((file, index) => {
                  const FileIcon = getFileIcon(file.name)
                  const fileColor = getFileTypeColor(file.name)
                  const isImage = getFileType(file.name) === "image"
                  return (
                    <Badge
                      key={index}
                      variant="light"
                      color={fileColor}
                      size="lg"
                      leftSection={
                        isImage ? (
                          <Image
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            w={16}
                            h={16}
                            fit="cover"
                            radius={2}
                          />
                        ) : (
                          <FileIcon size={14} />
                        )
                      }
                      rightSection={
                        <ActionIcon
                          size="xs"
                          variant="transparent"
                          color={fileColor}
                          onClick={() => handleRemoveFile(index)}
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      }
                      style={{ paddingRight: 4 }}
                    >
                      {file.name.length > 20
                        ? `${file.name.slice(0, 17)}...`
                        : file.name}
                    </Badge>
                  )
                })}
              </Group>
            )}

            <Group justify="space-between">
              <FileButton
                resetRef={resetRef}
                onChange={handleAddFiles}
                multiple
              >
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
              <Button
                type="submit"
                leftSection={<IconSend size={16} />}
                loading={createPostMutation.isPending}
                disabled={
                  !newPostContent.trim() || newPostContent === "<p></p>"
                }
              >
                Post Reply
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

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
  threadId: number
  isFirst: boolean
  isEditing: boolean
  editContent: string
  onEditContentChange: (content: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  isSaving: boolean
}

function PostCard({
  post,
  threadId,
  isFirst,
  isEditing,
  editContent,
  onEditContentChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  isSaving,
}: PostCardProps) {
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

  return (
    <>
      <Paper withBorder p="md" radius="md" bg={isFirst ? "blue.0" : undefined}>
        <Group justify="space-between" mb="sm">
          <Group gap="sm">
            <Avatar src={post.author.profile_picture} radius="xl" size="md">
              {post.author.first_name?.[0]}
              {post.author.last_name?.[0]}
            </Avatar>
            <div>
              <Text size="sm" fw={500}>
                {post.author.first_name} {post.author.last_name}
                {isFirst && (
                  <Text span c="blue" size="xs" ml="xs">
                    (Original Post)
                  </Text>
                )}
              </Text>
              <Text size="xs" c="dimmed">
                {dayjs(post.created_at).format("MMM D, YYYY [at] h:mm A")}
                {post.updated_at !== post.created_at && " (edited)"}
              </Text>
            </div>
          </Group>

          {post.is_own && !isEditing && (
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
              placeholder="Edit your post..."
              minHeight={150}
            />
            <Group justify="flex-end">
              <Button variant="light" size="sm" onClick={onCancelEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSaveEdit} loading={isSaving}>
                Save
              </Button>
            </Group>
          </Stack>
        ) : (
          <>
            <TypographyStylesProvider>
              <div dangerouslySetInnerHTML={{ __html: post.content }} />
            </TypographyStylesProvider>

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

            <Divider my="sm" />
            <Reactions
              postId={post.id}
              threadId={threadId}
              reactions={post.reactions || []}
            />
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
