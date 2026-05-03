import { useState, useRef, useEffect, lazy, Suspense } from "react"

import { useParams, useNavigate, useLocation } from "react-router-dom"
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query"
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
  Select,
  SimpleGrid,
  Typography,
  Checkbox,
  Tooltip,
  Menu,
  Alert,
  Switch,
  Skeleton,
} from "@mantine/core"

import { useDisclosure, useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
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
  IconLink,
  IconCopy,
  IconEyeOff,
  IconUsers,
  IconUserPlus,
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconSettings,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { eventsApi } from "../api/events"

import { forumApi } from "../api/forum"

import { BackButton } from "../components/BackButton"

import { clearDraft, loadDraft, saveDraft } from "../utils/draftStorage"

import { filterFilesBySize } from "../config"

import { CompactEventCard } from "../components/CompactEventCard"

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

import PollCreator from "../components/PollCreator"

import {
  FilePreviewModal,
  ImageThumbnail,
  getFileIcon,
  getFileType,
  getFileTypeColor,
} from "../components/FilePreview"

import { AttachmentBadge } from "../components/AttachmentBadge"

import EmojiPicker from "../components/EmojiPicker"

import UserLink from "../components/UserLink"

import UserPickerModal from "../components/UserPickerModal"

import { useAuthStore } from "../store/authStore"

import { useHideClosedThreads } from "../hooks/useHideClosedThreads"

import type {
  Thread,
  CreateThreadData,
  CreatePollData,
  Folder,
  ForumFile,
  Subgroup,
  SubgroupMember,
} from "../types"

interface CreateThreadParams {
  data: CreateThreadData

  files: File[]

  pollData?: CreatePollData
}

const THREADS_PAGE_SIZE = 50

export default function SubgroupPage() {
  const { slug, folderSlug: folderSlugParam } = useParams<{
    slug: string

    folderSlug?: string
  }>()

  const navigate = useNavigate()

  const location = useLocation()

  const queryClient = useQueryClient()

  const initialFolderSlug = folderSlugParam ?? null

  const activeTab = location.pathname.includes("/dokumenter")
    ? "documents"
    : location.pathname.includes("/info")
      ? "info"
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

  const parsePageParam = (url: string | null): number | undefined => {
    if (!url) return undefined
    try {
      const parsed = new URL(url, window.location.origin)
      const p = parsed.searchParams.get("page")
      return p ? Number(p) : undefined
    } catch {
      return undefined
    }
  }

  const { user } = useAuthStore()
  const {
    hideClosedThreads,
    setHideClosedThreads,
    isPending: isThreadPrefPending,
  } = useHideClosedThreads()

  const threadsQuery = useInfiniteQuery({
    queryKey: ["threads", slug, hideClosedThreads],
    queryFn: ({ pageParam = 1 }) =>
      forumApi.getThreads(slug!, {
        page: pageParam,
        pageSize: THREADS_PAGE_SIZE,
        ...(hideClosedThreads ? { isClosed: false } : {}),
      }),
    getNextPageParam: (lastPage) => parsePageParam(lastPage.next),
    initialPageParam: 1,
    enabled: !!slug,
    gcTime: 30_000,
  })

  const threads = (threadsQuery.data?.pages ?? []).flatMap((p) => p.results)
  const threadsLoading = threadsQuery.isLoading

  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQuery
  useEffect(() => {
    const node = loadMoreRef.current
    if (!node) return
    if (!hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: "1500px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

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

      queryClient.invalidateQueries({ queryKey: ["notifications"] })

      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
    },
  })

  const [isCopying, setIsCopying] = useState(false)

  const updateIconMutation = useMutation({
    mutationFn: (icon: string) => forumApi.updateSubgroup(slug!, { icon }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroup", slug] })

      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
    },
  })

  const isMobile = useMediaQuery("(max-width: 48em)")

  const [editGroupOpened, { open: openEditGroup, close: closeEditGroup }] =
    useDisclosure(false)

  const [editName, setEditName] = useState("")

  const [editDescriptionFull, setEditDescriptionFull] = useState("")

  const [editAllowsMembers, setEditAllowsMembers] = useState(false)

  const [
    editLinksInfoOpened,

    { open: openEditLinksInfo, close: closeEditLinksInfo },
  ] = useDisclosure(false)

  const [editLinksInfoContent, setEditLinksInfoContent] = useState("")

  const updateLinksInfoMutation = useMutation({
    mutationFn: (links_info: string) =>
      forumApi.updateSubgroup(slug!, { links_info }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroup", slug] })

      notifications.show({
        title: "Gemt",

        message: "Links og info er opdateret.",

        color: "green",
      })

      closeEditLinksInfo()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme links og info.")
    },
  })

  const updateSubgroupMutation = useMutation({
    mutationFn: (data: {
      name?: string

      description?: string

      allows_members?: boolean
    }) => forumApi.updateSubgroup(slug!, data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroup", slug] })

      queryClient.invalidateQueries({ queryKey: ["subgroups"] })

      notifications.show({
        title: "Gruppe opdateret",

        message: "Ændringerne er gemt.",

        color: "green",
      })

      closeEditGroup()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere gruppen.")
    },
  })

  const hasUnread = (subgroup?.unread_thread_count ?? 0) > 0

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

  function htmlToMarkdown(html: string): string {
    function nodeToMd(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""

      if (node.nodeType !== Node.ELEMENT_NODE) return ""

      const el = node as Element

      const inner = Array.from(el.childNodes).map(nodeToMd).join("")

      switch (el.tagName.toLowerCase()) {
        case "p":
          return inner + "\n\n"

        case "h1":
          return `# ${inner}\n\n`

        case "h2":
          return `## ${inner}\n\n`

        case "h3":
          return `### ${inner}\n\n`

        case "strong":

        case "b":
          return `**${inner}**`

        case "em":

        case "i":
          return `*${inner}*`

        case "code":
          return `\`${inner}\``

        case "pre":
          return `\`\`\`\n${inner}\n\`\`\`\n\n`

        case "ul":
          return inner + "\n"

        case "ol":
          return inner + "\n"

        case "li":
          return `- ${inner}\n`

        case "a":
          return `[${inner}](${(el as HTMLAnchorElement).href})`

        case "br":
          return "\n"

        case "blockquote":
          return (
            inner

              .trim()

              .split("\n")

              .map((l) => `> ${l}`)

              .join("\n") + "\n\n"
          )

        default:
          return inner
      }
    }

    const doc = new DOMParser().parseFromString(html, "text/html")

    return nodeToMd(doc.body).trim()
  }

  function buildLlmPreamble(threadCount: number): string {
    const s = slug!.toLowerCase()

    const isBugs =
      s.includes("bug") || s.includes("fejl") || s.includes("problem")

    const isFeatures =
      s.includes("feature") ||
      s.includes("ideer") ||
      s.includes("idea") ||
      s.includes("ønsk") ||
      s.includes("forbedr")

    const taskKind = isBugs
      ? "bug reports"
      : isFeatures
        ? "feature requests"
        : "issues/requests"

    const actionVerb = isBugs ? "fix" : isFeatures ? "implement" : "address"

    const capitalize = (str: string) =>
      str.charAt(0).toUpperCase() + str.slice(1)

    return `\
# Task: ${capitalize(actionVerb)} open ${taskKind} from the "${subgroup!.name}" forum group

Below are **${threadCount} open ${taskKind}** reported by residents. Each thread is the original post followed by replies — read the full thread for context and constraints before acting.

Some posts include **attachments** (screenshots, images, documents) listed as local file paths. Only read attachments that seem relevant to the task at hand — e.g. screenshots attached to bug reports.

For each ${taskKind.replace(/s$/, "")}:
1. Read the full thread and understand the problem/request. Ask clarifying questions if needed.
2. ${capitalize(actionVerb)} it with a focused, minimal change
3. Run the relevant checks when done

If multiple ${taskKind} are **independent**, spawn parallel subagents to handle them concurrently.
Skip any that are too vague to act on, and note why at the end. The subagents should not do the work, instead gather the
needed information, and then you as the main agent will act on it.

The process is as follows. You gather all the information from all the subagents and prepare the way you plan to address it.
Then each seperate ${capitalize(actionVerb)} is implemented one at a time where you ask me for confirmation on your understanding + approach and I commit before continuing.

---

`
  }

  async function copyThreadsAsMarkdown() {
    if (!slug || !subgroup) return
    setIsCopying(true)

    try {
      // Fetch ALL open thread pages — the visible list may be paginated but
      // the LLM prompt needs the full set.
      const nonClosedThreads: Thread[] = []
      let page = 1
      while (true) {
        const res = await forumApi.getThreads(slug, {
          page,
          isClosed: false,
          pageSize: 100,
        })
        nonClosedThreads.push(...res.results)
        if (!res.next) break
        page += 1
      }
      const parts: string[] = [buildLlmPreamble(nonClosedThreads.length)]

      for (const thread of nonClosedThreads) {
        const posts = await forumApi.getPosts(thread.id)

        const authorName = thread.author
          ? `${thread.author.first_name} ${thread.author.last_name}`
          : "Ukendt"

        parts.push(`## ${thread.title}\n\n`)

        parts.push(
          `*Oprettet af ${authorName}, ${dayjs(thread.created_at).locale("da").format("D. MMMM YYYY")} · ${posts.length} svar*\n\n`,
        )

        for (const post of posts) {
          const postAuthor = post.author
            ? `${post.author.first_name} ${post.author.last_name}`
            : "Ukendt"

          parts.push(
            `**${postAuthor}** *(${dayjs(post.created_at).locale("da").format("D. MMMM YYYY")})*:\n\n`,
          )

          parts.push(htmlToMarkdown(post.content))

          parts.push("\n\n")

          if (post.attachments.length > 0) {
            parts.push("Attachments:\n")

            for (const att of post.attachments) {
              parts.push(`- \`backend/data/media/${att.file}\` (${att.name})\n`)
            }

            parts.push("\n")
          }
        }

        parts.push("---\n\n")
      }

      const text = parts.join("")

      // navigator.clipboard.writeText can fail when the user gesture

      // has gone stale after multiple async fetches. Fall back to a

      // temporary textarea + execCommand("copy") when that happens.

      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const textarea = document.createElement("textarea")

        textarea.value = text

        textarea.style.position = "fixed"

        textarea.style.left = "-9999px"

        document.body.appendChild(textarea)

        textarea.select()

        document.execCommand("copy")

        document.body.removeChild(textarea)
      }

      notifications.show({
        title: "Kopieret!",

        message: `${nonClosedThreads.length} tråde kopieret til udklipsholderen`,

        color: "green",
      })
    } catch (error) {
      showErrorNotification(error, "Kunne ikke kopiere indhold")
    } finally {
      setIsCopying(false)
    }
  }

  // Sort is done on the backend (pinned first, then by updated_at).

  return (
    <>
      <BackButton to="/forum" label="Tilbage til alle fora" />

      <Modal
        opened={editGroupOpened}
        onClose={closeEditGroup}
        title="Rediger gruppe"
        fullScreen={isMobile}
      >
        <Stack>
          <TextInput
            label="Navn"
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
            required
          />
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Beskrivelse
            </Text>
            <RichTextEditor
              content={editDescriptionFull}
              onChange={setEditDescriptionFull}
              placeholder="Beskriv gruppen..."
              minHeight={120}
            />
          </Box>
          <Checkbox
            label="Tillad medlemskab"
            description="Relevant hvis der ønskes mulighed for private tråde."
            checked={editAllowsMembers}
            onChange={(e) => setEditAllowsMembers(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeEditGroup}>
              Annuller
            </Button>
            <Button
              loading={updateSubgroupMutation.isPending}
              disabled={!editName.trim()}
              onClick={() =>
                updateSubgroupMutation.mutate({
                  name: editName,

                  description: editDescriptionFull,

                  allows_members: editAllowsMembers,
                })
              }
            >
              Gem
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Group justify="space-between" mb="md">
        <div>
          <Group gap="xs">
            <EmojiPicker
              onSelect={(emoji) => updateIconMutation.mutate(emoji)}
              icon={subgroup.icon || "💬"}
              size="lg"
            />
            <Title order={3} style={{ flex: 1, minWidth: 0 }}>
              {subgroup.name}
            </Title>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Gruppemenu"
                >
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconSettings size={14} />}
                  onClick={() => {
                    setEditName(subgroup.name)

                    setEditDescriptionFull(subgroup.description || "")

                    setEditAllowsMembers(subgroup.allows_members)

                    openEditGroup()
                  }}
                >
                  Rediger gruppe
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
          {subgroup.description && subgroup.description !== "<p></p>" ? (
            <Typography mt="sm">
              <RichTextContent
                className="description-content"
                html={subgroup.description}
              />
            </Typography>
          ) : (
            <Text c="dimmed" size="sm" mt="sm">
              Ingen beskrivelse
            </Text>
          )}
        </div>
        <Group gap="xs">
          {user?.is_staff && (
            <Button
              variant="light"
              color="gray"
              leftSection={<IconCopy size={16} />}
              onClick={copyThreadsAsMarkdown}
              loading={isCopying}
            >
              Kopier til LLM
            </Button>
          )}
        </Group>
      </Group>

      {subgroup.allows_members && (
        <MembersSection subgroup={subgroup} currentUserId={user?.id ?? null} />
      )}

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
          else if (tab === "info") navigate(`/forum/${slug}/info`)
          else navigate(`/forum/${slug}`)
        }}
        mb="md"
      >
        <Tabs.List>
          <Tabs.Tab value="threads" leftSection={<IconMessage size={16} />}>
            <Group gap={2} wrap="nowrap">
              Tråde
              {hasUnread && (
                <Box
                  style={{
                    width: 8,

                    height: 8,

                    borderRadius: "50%",

                    backgroundColor: "var(--mantine-color-red-6)",

                    flexShrink: 0,
                  }}
                />
              )}
            </Group>
          </Tabs.Tab>
          <Tabs.Tab value="documents" leftSection={<IconFolder size={16} />}>
            Dokumenter
          </Tabs.Tab>
          <Tabs.Tab value="info" leftSection={<IconLink size={16} />}>
            Links og info
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="threads" pt="md">
          <Group justify="space-between" mb="md" wrap="wrap">
            <Switch
              label="Skjul lukkede"
              checked={hideClosedThreads}
              onChange={(e) => setHideClosedThreads(e.currentTarget.checked)}
              disabled={isThreadPrefPending}
            />
            <Group gap="xs">
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
                variant="light"
                leftSection={<IconCalendarEvent size={16} />}
                onClick={() =>
                  navigate(`/kalender/opret?subgroup=${subgroup.id}`)
                }
              >
                Opret begivenhed
              </Button>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={openCreateThreadModal}
              >
                Ny tråd
              </Button>
            </Group>
          </Group>
          <Stack gap="md">
            {threads.length === 0 && !threadsQuery.isLoading ? (
              <Paper withBorder p="xl" radius="md">
                <Center>
                  <Stack align="center" gap="xs">
                    <IconMessage size={48} color="gray" />
                    <Text c="dimmed">Ingen tråde endnu. Start samtalen!</Text>
                    <Button onClick={openCreateThreadModal} mt="sm">
                      Opret første tråd
                    </Button>
                  </Stack>
                </Center>
              </Paper>
            ) : (
              threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onClick={() =>
                    navigate(`/forum/${slug}/traad/${thread.slug}`)
                  }
                />
              ))
            )}
            {threadsQuery.hasNextPage && (
              <div ref={loadMoreRef} aria-hidden="true" />
            )}
            {threadsQuery.hasNextPage && (
              <Center mt="sm">
                <Button
                  variant="light"
                  onClick={() => threadsQuery.fetchNextPage()}
                  loading={threadsQuery.isFetchingNextPage}
                >
                  Vis flere tråde
                </Button>
              </Center>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="documents" pt="md">
          <DocumentsTab
            subgroupSlug={slug!}
            allowsMembers={subgroup?.allows_members ?? false}
            isMember={subgroup?.is_member ?? false}
            defaultMembersOnly={subgroup?.default_members_only ?? false}
            initialFolderSlug={initialFolderSlug}
            onFolderChange={(folderSlug) => {
              if (folderSlug === null) navigate(`/forum/${slug}/dokumenter`)
              else navigate(`/forum/${slug}/dokumenter/${folderSlug}`)
            }}
          />
        </Tabs.Panel>

        <Tabs.Panel value="info" pt="md">
          {(() => {
            const canEditLinksInfo =
              !!user &&
              (user.is_staff || (subgroup.allows_members && subgroup.is_member))

            return (
              <Stack>
                <Group justify="flex-end">
                  {canEditLinksInfo && (
                    <Button
                      variant="light"
                      leftSection={<IconSettings size={16} />}
                      onClick={() => {
                        setEditLinksInfoContent(subgroup.links_info || "")

                        openEditLinksInfo()
                      }}
                    >
                      Rediger
                    </Button>
                  )}
                </Group>
                {subgroup.links_info ? (
                  <Typography>
                    <RichTextContent
                      className="description-content"
                      html={subgroup.links_info}
                    />
                  </Typography>
                ) : (
                  <Paper withBorder p="xl" radius="md">
                    <Center>
                      <Text c="dimmed">Intet indhold endnu.</Text>
                    </Center>
                  </Paper>
                )}
              </Stack>
            )
          })()}
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={editLinksInfoOpened}
        onClose={closeEditLinksInfo}
        title="Rediger links og info"
        fullScreen={isMobile}
        size="lg"
      >
        <Stack>
          <RichTextEditor
            content={editLinksInfoContent}
            onChange={setEditLinksInfoContent}
            placeholder="Tilføj links og information..."
            minHeight={240}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeEditLinksInfo}>
              Annuller
            </Button>
            <Button
              loading={updateLinksInfoMutation.isPending}
              onClick={() =>
                updateLinksInfoMutation.mutate(editLinksInfoContent)
              }
            >
              Gem
            </Button>
          </Group>
        </Stack>
      </Modal>

      <CreateThreadModal
        opened={createThreadModalOpened}
        onClose={closeCreateThreadModal}
        subgroupSlug={slug!}
        subgroupName={subgroup?.name ?? ""}
        allowsMembers={subgroup?.allows_members ?? false}
        defaultMembersOnly={subgroup?.default_members_only ?? false}
        onSuccess={(thread) => {
          queryClient.invalidateQueries({ queryKey: ["threads", slug] })

          closeCreateThreadModal()

          navigate(`/forum/${slug}/traad/${thread.slug}`)
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
      style={{
        cursor: "pointer",

        position: "relative",

        ...(thread.members_only && {
          borderColor: "var(--mantine-color-grape-8)",

          borderWidth: 2,
        }),
      }}
      onClick={onClick}
    >
      {thread.members_only && (
        <Tooltip label="Kun for medlemmer">
          <Box
            style={{
              position: "absolute",

              top: -10,

              left: -10,

              width: 22,

              height: 22,

              borderRadius: "50%",

              backgroundColor: "var(--mantine-color-grape-8)",

              color: "white",

              display: "flex",

              alignItems: "center",

              justifyContent: "center",
            }}
          >
            <IconEyeOff size={14} />
          </Box>
        </Tooltip>
      )}
      <Group gap="md" wrap="nowrap">
        <Avatar src={thread.author?.profile_picture} radius="xl" size="md">
          {thread.author?.first_name?.[0]}
          {thread.author?.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4} wrap="nowrap" justify="space-between">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
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
              <Text fw={thread.is_unread ? 700 : 500} lineClamp={3}>
                {thread.title}
              </Text>
            </Group>
            <Badge
              variant="light"
              color="gray"
              size="sm"
              style={{ flexShrink: 0 }}
            >
              {thread.post_count} svar
            </Badge>
          </Group>
          <Group gap={4} wrap="nowrap" style={{ overflow: "hidden" }}>
            {thread.last_post_author ? (
              <>
                <Text
                  size="sm"
                  c="dimmed"
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  <Text component="span" visibleFrom="sm">
                    Sidste svar{" "}
                  </Text>
                  {dayjs(thread.last_post_at).fromNow()} af
                </Text>
                <Avatar
                  src={thread.last_post_author.profile_picture}
                  radius="xl"
                  size={18}
                  style={{ flexShrink: 0 }}
                >
                  {thread.last_post_author.first_name?.[0]}
                  {thread.last_post_author.last_name?.[0]}
                </Avatar>
                <UserLink
                  id={thread.last_post_author.id}
                  firstName={thread.last_post_author.first_name}
                  lastName={thread.last_post_author.last_name}
                  size="sm"
                  c="dimmed"
                  visibleFrom="sm"
                  style={{
                    overflow: "hidden",

                    textOverflow: "ellipsis",

                    whiteSpace: "nowrap",
                  }}
                />
                <Text
                  size="sm"
                  c="dimmed"
                  hiddenFrom="sm"
                  style={{
                    overflow: "hidden",

                    textOverflow: "ellipsis",

                    whiteSpace: "nowrap",
                  }}
                >
                  {thread.last_post_author.first_name}{" "}
                  {thread.last_post_author.last_name}
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                Oprettet {dayjs(thread.created_at).fromNow()}
              </Text>
            )}
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

  subgroupName: string

  allowsMembers: boolean

  defaultMembersOnly: boolean

  onSuccess: (thread: Thread) => void
}

function CreateThreadModal({
  opened,

  onClose,

  subgroupSlug,

  subgroupName,

  allowsMembers,

  defaultMembersOnly,

  onSuccess,
}: CreateThreadModalProps) {
  const isMobile = useMediaQuery("(max-width: 48em)")

  const [title, setTitle] = useState("")

  const [content, setContent] = useState("")

  const [attachments, setAttachments] = useState<File[]>([])

  const [pollData, setPollData] = useState<CreatePollData | null>(null)

  const [membersOnly, setMembersOnly] = useState(defaultMembersOnly)

  const titleDraftKey = "new-thread-title-" + subgroupSlug

  useEffect(() => {
    loadDraft(titleDraftKey).then((draft) => {
      if (draft) setTitle(draft)
    })
  }, [titleDraftKey])

  useEffect(() => {
    const t = setTimeout(() => saveDraft(titleDraftKey, title), 1500)

    return () => clearTimeout(t)
  }, [title, titleDraftKey])

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
        title: "Tråd oprettet",

        message: "Din tråd er blevet oprettet.",

        color: "green",
      })

      setTitle("")

      setContent("")

      setAttachments([])

      setPollData(null)

      setMembersOnly(false)

      clearDraft("new-thread-" + subgroupSlug)

      clearDraft("new-thread-title-" + subgroupSlug)

      onSuccess(thread)
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette tråd. Prøv igen.")
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()

    if (!title.trim() || !content.trim()) return

    if (pollData?.options.some((o) => !o.text.trim())) {
      notifications.show({
        title: "Tomme valgmuligheder",
        message: "Alle valgmuligheder i afstemningen skal have tekst.",
        color: "red",
      })
      return
    }

    createMutation.mutate({
      data: {
        title: title.trim(),

        content: content.trim(),

        ...(allowsMembers && membersOnly ? { members_only: true } : {}),
      },

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
      setAttachments((prev) => [
        ...prev,

        ...validFiles.filter((f) => !prev.some((p) => p.name === f.name)),
      ])
    }
  }

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Opret ny tråd"
      size="lg"
      fullScreen={isMobile}
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
                onSubmit={handleSubmit}
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

            {allowsMembers && (
              <Checkbox
                label="Kun for medlemmer"
                description={`Kun synlig for medlemmer af ${subgroupName}`}
                checked={membersOnly}
                onChange={(e) => setMembersOnly(e.currentTarget.checked)}
              />
            )}

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
              <Group>
                <Button variant="light" onClick={onClose}>
                  Annuller
                </Button>
                <Button
                  type="submit"
                  loading={createMutation.isPending}
                  disabled={!title.trim() || !content.trim()}
                >
                  Opret tråd
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

  slug?: string
}

interface FolderAncestor {
  id: number

  name: string

  slug?: string
}

interface DocumentsTabProps {
  subgroupSlug: string

  allowsMembers: boolean

  isMember: boolean

  defaultMembersOnly: boolean

  initialFolderSlug?: string | null

  onFolderChange?: (folderSlug: string | null) => void
}

function DocumentsTab({
  subgroupSlug,

  allowsMembers,

  isMember,

  defaultMembersOnly,

  initialFolderSlug,

  onFolderChange,
}: DocumentsTabProps) {
  const [uploadMembersOnly, setUploadMembersOnly] = useState(defaultMembersOnly)

  const queryClient = useQueryClient()

  const { user } = useAuthStore()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)

  const [folderPath, setFolderPath] = useState<FolderPathEntry[]>([
    { id: null, name: "Dokumenter" },
  ])

  // Track which folderSlug we've already processed to avoid re-fetching on our own navigations

  const processedFolderSlugRef = useRef<string | null | undefined>(undefined)

  const [resolvingSlug, setResolvingSlug] = useState(!!initialFolderSlug)

  const [uploading, setUploading] = useState(false)

  const [uploadProgress, setUploadProgress] = useState("")

  useEffect(() => {
    const targetSlug = initialFolderSlug ?? null

    if (processedFolderSlugRef.current === targetSlug) return

    processedFolderSlugRef.current = targetSlug

    if (targetSlug === null) {
      setCurrentFolderId(null)

      setFolderPath([{ id: null, name: "Dokumenter" }])

      setResolvingSlug(false)

      return
    }

    // Resolve folder slug to folder, then reconstruct breadcrumb path

    setResolvingSlug(true)

    const buildPath = async () => {
      const targetFolder = await forumApi.getFolderBySlug(
        subgroupSlug,

        targetSlug,
      )

      const ancestors: FolderAncestor[] = []

      let currentId: number | null = targetFolder.parent

      while (currentId !== null) {
        const folder = await forumApi.getFolder(currentId)

        ancestors.unshift({
          id: folder.id,

          name: folder.name,

          slug: folder.slug,
        })

        currentId = folder.parent
      }

      ancestors.push({
        id: targetFolder.id,

        name: targetFolder.name,

        slug: targetFolder.slug,
      })

      setCurrentFolderId(targetFolder.id)

      setFolderPath([{ id: null, name: "Dokumenter" }, ...ancestors])

      setResolvingSlug(false)
    }

    buildPath().catch(() => {
      // Folder not found — fall back to root

      setCurrentFolderId(null)

      setFolderPath([{ id: null, name: "Dokumenter" }])

      setResolvingSlug(false)

      onFolderChange?.(null)
    })
  }, [initialFolderSlug, subgroupSlug])

  const [
    createFolderModalOpened,

    { open: openCreateFolderModal, close: closeCreateFolderModal },
  ] = useDisclosure(false)

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

  const handleUploadFiles = async (
    droppedFiles: File[],

    targetFolderId?: number,
  ) => {
    const folderId = targetFolderId ?? currentFolderId

    const { validFiles, errors } = filterFilesBySize(droppedFiles)

    for (const error of errors) {
      notifications.show({
        title: "Filen er for stor",

        message: error,

        color: "red",
      })
    }

    if (validFiles.length === 0) return

    // Check for duplicate filenames in the target location

    let existingFiles: ForumFile[] = []

    try {
      existingFiles =
        folderId !== null
          ? await forumApi.getFiles(folderId)
          : await forumApi.getRootFiles(subgroupSlug)
    } catch {
      // If we can't fetch, just proceed without the check
    }

    const existingNames = new Set(existingFiles.map((f) => f.name))

    const duplicates = validFiles.filter((f) => existingNames.has(f.name))

    let filesToUpload = validFiles

    if (duplicates.length > 0) {
      const names = duplicates.map((f) => f.name).join(", ")

      const proceed = window.confirm(
        `Følgende filer findes allerede: ${names}\n\nVil du uploade dem alligevel?`,
      )

      if (!proceed) {
        filesToUpload = validFiles.filter((f) => !existingNames.has(f.name))

        if (filesToUpload.length === 0) return
      }
    }

    setUploading(true)

    let successCount = 0

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i]

      setUploadProgress(`${i + 1} / ${filesToUpload.length}`)

      try {
        if (folderId !== null) {
          await forumApi.uploadFile(
            folderId,

            file,

            undefined,

            allowsMembers && uploadMembersOnly,
          )
        } else {
          await forumApi.uploadRootFile(
            subgroupSlug,

            file,

            undefined,

            allowsMembers && uploadMembersOnly,
          )
        }

        successCount++
      } catch (error) {
        showErrorNotification(
          error,

          `Kunne ikke uploade "${file.name}". Prøv igen.`,
        )
      }
    }

    setUploading(false)

    setUploadProgress("")

    if (successCount > 0) {
      // Invalidate both current view and the target folder if different

      invalidateFiles()

      if (targetFolderId !== undefined && targetFolderId !== currentFolderId) {
        queryClient.invalidateQueries({
          queryKey: ["files", targetFolderId],
        })

        // Also refresh folder counts

        queryClient.invalidateQueries({
          queryKey: ["folders", subgroupSlug],
        })
      }

      notifications.show({
        title: "Upload fuldført",

        message:
          successCount === 1
            ? "1 fil uploadet."
            : `${successCount} filer uploadet.`,

        color: "green",
      })
    }
  }

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

  const navigateToFolder = (
    folderId: number | null,

    folderName: string,

    folderSlug?: string,
  ) => {
    // Mark as processed so the effect doesn't re-fetch for this navigation

    processedFolderSlugRef.current = folderSlug ?? null

    if (folderId === null) {
      setCurrentFolderId(null)

      setFolderPath([{ id: null, name: "Dokumenter" }])
    } else {
      setCurrentFolderId(folderId)

      const existingIndex = folderPath.findIndex((f) => f.id === folderId)

      if (existingIndex >= 0) {
        setFolderPath(folderPath.slice(0, existingIndex + 1))
      } else {
        setFolderPath([
          ...folderPath,

          { id: folderId, name: folderName, slug: folderSlug },
        ])
      }
    }

    onFolderChange?.(folderSlug ?? null)
  }

  const [
    deleteFolderConfirmOpened,
    { open: openDeleteFolderConfirmRaw, close: closeDeleteFolderConfirm },
  ] = useDisclosure(false)

  const canDeleteCurrentFolder =
    currentFolderId !== null && (!allowsMembers || isMember)

  const currentFolderName =
    folderPath[folderPath.length - 1]?.name ?? "denne mappe"

  const [deleteConfirmName, setDeleteConfirmName] = useState("")

  const openDeleteFolderConfirm = () => {
    setDeleteConfirmName("")
    openDeleteFolderConfirmRaw()
  }

  const {
    data: deletePreview,
    isFetching: deletePreviewFetching,
    isError: deletePreviewError,
  } = useQuery({
    queryKey: ["folder-delete-preview", currentFolderId],
    queryFn: () =>
      currentFolderId !== null
        ? forumApi.getFolderDeletePreview(currentFolderId)
        : Promise.resolve(null),
    enabled: deleteFolderConfirmOpened && currentFolderId !== null,
    staleTime: 0,
  })

  const deleteFolderMutation = useMutation({
    mutationFn: () => {
      if (currentFolderId === null) return Promise.resolve()
      return forumApi.deleteFolder(currentFolderId)
    },
    onSuccess: () => {
      notifications.show({
        title: "Mappe slettet",
        message: `Mappen "${currentFolderName}" og dens indhold er slettet.`,
        color: "green",
      })
      const parent =
        folderPath.length >= 2 ? folderPath[folderPath.length - 2] : null
      navigateToFolder(
        parent?.id ?? null,
        parent?.name ?? "Dokumenter",
        parent?.slug,
      )
      queryClient.invalidateQueries({ queryKey: ["folders", subgroupSlug] })
    },
    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette mappen. Prøv igen.")
    },
  })

  const isLoading = resolvingSlug || foldersLoading || filesLoading

  const hasContent =
    (folders && folders.length > 0) || (files && files.length > 0)

  return (
    <FileDropzone onDrop={handleUploadFiles} label="Slip for at uploade">
      {/* Hidden file input for button click */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            handleUploadFiles(Array.from(e.target.files))

            e.target.value = ""
          }
        }}
      />

      {/* Breadcrumbs */}
      <Group justify="space-between" mb="md">
        <Breadcrumbs>
          {folderPath.map((item, index) => (
            <Anchor
              key={item.id ?? "root"}
              onClick={() => navigateToFolder(item.id, item.name, item.slug)}
              style={{ cursor: "pointer" }}
              fw={index === folderPath.length - 1 ? 500 : undefined}
            >
              {item.name}
            </Anchor>
          ))}
        </Breadcrumbs>
        <Group gap="xs">
          {allowsMembers && (
            <Tooltip label="Næste upload markeres som kun synlig for medlemmer">
              <Checkbox
                label="Upload som privat"
                checked={uploadMembersOnly}
                onChange={(e) => setUploadMembersOnly(e.currentTarget.checked)}
                size="sm"
              />
            </Tooltip>
          )}
          {canDeleteCurrentFolder && (
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={openDeleteFolderConfirm}
              size="sm"
            >
              Slet mappe
            </Button>
          )}
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
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            loading={uploading}
          >
            {uploading ? `Uploader ${uploadProgress}` : "Upload filer"}
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
              subgroupSlug={subgroupSlug}
              onClick={() =>
                navigateToFolder(folder.id, folder.name, folder.slug)
              }
              onDropFiles={(files) => handleUploadFiles(files, folder.id)}
            />
          ))}

          {/* Files */}
          {files?.map((file: ForumFile) => {
            const canModify = file.is_own || user?.is_staff === true

            return (
              <FileRow
                key={file.id}
                file={file}
                subgroupSlug={subgroupSlug}
                canModify={canModify}
                allowsMembers={allowsMembers}
                onDelete={invalidateFiles}
                onMove={invalidateFiles}
                onUpdate={invalidateFiles}
              />
            )
          })}

          {/* Drop zone hint / empty state */}
          <Paper
            withBorder
            p={hasContent ? "md" : "xl"}
            radius="md"
            style={{
              borderStyle: "dashed",

              cursor: "pointer",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Center>
              <Stack align="center" gap="xs">
                {!hasContent && <IconFolder size={48} color="gray" />}
                {!hasContent && (
                  <Text c="dimmed">
                    {currentFolderId === null
                      ? "Ingen dokumenter endnu."
                      : "Denne mappe er tom."}
                  </Text>
                )}
                <Group gap="xs">
                  <IconUpload size={16} color="var(--mantine-color-dimmed)" />
                  <Text size="sm" c="dimmed">
                    Træk filer hertil eller klik for at uploade
                  </Text>
                </Group>
                {!hasContent && (
                  <Button
                    variant="light"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()

                      openCreateFolderModal()
                    }}
                    mt="xs"
                  >
                    Opret mappe
                  </Button>
                )}
              </Stack>
            </Center>
          </Paper>
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

      <Modal
        opened={deleteFolderConfirmOpened}
        onClose={closeDeleteFolderConfirm}
        title="Slet mappe"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light">
            <Stack gap="xs">
              <Text>
                Er du sikker på, at du vil slette mappen "{currentFolderName}"
                og alt dens indhold? Denne handling kan ikke fortrydes.
              </Text>
              {deletePreview ? (
                <Text size="sm">
                  Dette vil slette {deletePreview.subfolder_count}{" "}
                  {deletePreview.subfolder_count === 1
                    ? "undermappe"
                    : "undermapper"}{" "}
                  og {deletePreview.file_count}{" "}
                  {deletePreview.file_count === 1 ? "fil" : "filer"}.
                </Text>
              ) : deletePreviewError ? (
                <Text size="sm">Kunne ikke hente antal filer/mapper.</Text>
              ) : (
                <Text size="sm" c="dimmed">
                  {deletePreviewFetching
                    ? "Henter antal filer og mapper..."
                    : ""}
                </Text>
              )}
            </Stack>
          </Alert>
          <TextInput
            label={`Skriv "${currentFolderName}" for at bekræfte`}
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={closeDeleteFolderConfirm}>
              Annuller
            </Button>
            <Button
              color="red"
              disabled={deleteConfirmName !== currentFolderName}
              onClick={() => {
                closeDeleteFolderConfirm()
                deleteFolderMutation.mutate()
              }}
              loading={deleteFolderMutation.isPending}
            >
              Slet
            </Button>
          </Group>
        </Stack>
      </Modal>
    </FileDropzone>
  )
}

interface FolderRowProps {
  folder: Folder

  subgroupSlug: string

  onClick: () => void

  onDropFiles: (files: File[]) => void
}

function FolderRow({
  folder,

  subgroupSlug,

  onClick,

  onDropFiles,
}: FolderRowProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const dragCounter = useRef(0)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    dragCounter.current++

    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    if (--dragCounter.current === 0) setIsDragOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()

    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    dragCounter.current = 0

    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)

    if (files.length > 0) onDropFiles(files)
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{
        cursor: "pointer",

        backgroundColor: isDragOver
          ? "var(--mantine-color-blue-light)"
          : undefined,

        borderColor: isDragOver ? "var(--mantine-color-blue-5)" : undefined,

        transition: "background-color 0.15s, border-color 0.15s",
      }}
      onClick={onClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Group justify="space-between">
        <Group gap="md">
          <IconFolder size={24} color="var(--mantine-color-blue-6)" />
          <div>
            <Text fw={500}>{folder.name}</Text>
            <Text size="xs" c="dimmed">
              {isDragOver
                ? "Slip for at uploade hertil"
                : `${folder.subfolder_count} mapper, ${folder.file_count} filer`}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            title="Kopiér link"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()

              const url = `${window.location.origin}/forum/${subgroupSlug}/dokumenter/${folder.slug}`

              navigator.clipboard.writeText(url).then(
                () =>
                  notifications.show({
                    message: "Link kopieret",

                    color: "green",
                  }),

                () =>
                  notifications.show({
                    message: "Kunne ikke kopiere link",

                    color: "red",
                  }),
              )
            }}
          >
            <IconLink size={16} />
          </ActionIcon>
          {folder.file_count > 0 && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              title="Download mappe som zip"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()

                forumApi

                  .downloadFolder(folder.id, folder.name)

                  .catch((error: unknown) => {
                    showErrorNotification(error, "Kunne ikke downloade mappen.")
                  })
              }}
            >
              <IconDownload size={16} />
            </ActionIcon>
          )}
          <IconChevronRight size={20} color="gray" />
        </Group>
      </Group>
    </Paper>
  )
}

interface FileRowProps {
  file: ForumFile

  subgroupSlug: string

  canModify: boolean

  allowsMembers?: boolean

  onDelete: () => void

  onMove: () => void

  onUpdate?: () => void
}

function FileRow({
  file,

  subgroupSlug,

  canModify,

  onDelete,

  onMove,

  onUpdate,
}: FileRowProps) {
  const togglePrivacyMutation = useMutation({
    mutationFn: (membersOnly: boolean) =>
      forumApi.updateFile(file.id, { members_only: membersOnly }),

    onSuccess: () => {
      notifications.show({
        title: "Fil opdateret",

        message: "Filens synlighed er blevet ændret.",

        color: "green",
      })

      onUpdate?.()
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke ændre filens synlighed. Prøv igen.",
      )
    },
  })

  const [moveModalOpened, { open: openMoveModal, close: closeMoveModal }] =
    useDisclosure(false)

  const [previewOpened, { open: openPreview, close: closePreview }] =
    useDisclosure(false)

  const [
    deleteConfirmOpened,

    { open: openDeleteConfirm, close: closeDeleteConfirm },
  ] = useDisclosure(false)

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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette filen. Prøv igen.")
    },
  })

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()

    fetch(file.file_url)

      .then((res) => res.blob())

      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob)

        const a = document.createElement("a")

        a.href = blobUrl

        a.download = file.name

        document.body.appendChild(a)

        a.click()

        document.body.removeChild(a)

        URL.revokeObjectURL(blobUrl)
      })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()

    openDeleteConfirm()
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
      <Paper
        withBorder
        p="md"
        radius="md"
        style={{
          position: "relative",

          ...(file.members_only && {
            borderColor: "var(--mantine-color-grape-8)",

            borderWidth: 2,
          }),
        }}
      >
        {file.members_only && (
          <Tooltip label="Kun for medlemmer">
            <Box
              style={{
                position: "absolute",

                top: -10,

                left: -10,

                width: 22,

                height: 22,

                borderRadius: "50%",

                backgroundColor: "var(--mantine-color-grape-8)",

                color: "white",

                display: "flex",

                alignItems: "center",

                justifyContent: "center",
              }}
            >
              <IconEyeOff size={14} />
            </Box>
          </Tooltip>
        )}
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
              <Group gap={6} wrap="nowrap">
                <Text
                  fw={500}
                  style={{ cursor: "pointer" }}
                  onClick={openPreview}
                  c="blue"
                >
                  {file.name}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Uploadet af{" "}
                {file.uploaded_by
                  ? `${file.uploaded_by.first_name} ${file.uploaded_by.last_name}`
                  : "slettet bruger"}{" "}
                • {dayjs(file.uploaded_at).fromNow()}
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <ActionIcon
              variant="light"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()

                const url = `${window.location.origin}${file.file_url}`

                navigator.clipboard.writeText(url).then(
                  () =>
                    notifications.show({
                      message: "Link kopieret",

                      color: "green",
                    }),

                  () =>
                    notifications.show({
                      message: "Kunne ikke kopiere link",

                      color: "red",
                    }),
                )
              }}
              title="Kopiér link"
            >
              <IconLink size={16} />
            </ActionIcon>
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
              title="Hent fil"
            >
              <IconDownload size={16} />
            </ActionIcon>
            {file.can_toggle_privacy && (
              <ActionIcon
                variant="light"
                onClick={(e) => {
                  e.stopPropagation()

                  const next = !file.members_only

                  const confirmMsg = next
                    ? "Gør denne fil privat? Den vil kun være synlig for medlemmer af gruppen."
                    : "Gør denne fil offentlig? Den vil blive synlig for alle."

                  if (window.confirm(confirmMsg)) {
                    togglePrivacyMutation.mutate(next)
                  }
                }}
                loading={togglePrivacyMutation.isPending}
                title={file.members_only ? "Gør offentlig" : "Gør privat"}
              >
                <IconEyeOff size={16} />
              </ActionIcon>
            )}
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

      <Modal
        opened={deleteConfirmOpened}
        onClose={closeDeleteConfirm}
        title="Slet fil"
        centered
        size="sm"
      >
        <Text mb="lg">Er du sikker på, at du vil slette denne fil?</Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteConfirm}>
            Annuller
          </Button>
          <Button
            color="red"
            onClick={() => {
              closeDeleteConfirm()

              deleteMutation.mutate()
            }}
            loading={deleteMutation.isPending}
          >
            Slet
          </Button>
        </Group>
      </Modal>
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette mappen. Prøv igen.")
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

interface FolderOption {
  value: string
  label: string
}

function buildFolderOptions(folders: Folder[] | undefined): FolderOption[] {
  const root: FolderOption = {
    value: "root",
    label: "📁 Rodmappe (ingen mappe)",
  }
  if (!folders || folders.length === 0) {
    return [root]
  }

  const byParent = new Map<number | null, Folder[]>()
  for (const f of folders) {
    const arr = byParent.get(f.parent) ?? []
    arr.push(f)
    byParent.set(f.parent, arr)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, "da"))
  }

  const out: FolderOption[] = [root]
  const walk = (parentId: number | null, depth: number) => {
    const children = byParent.get(parentId) ?? []
    for (const f of children) {
      const indent = "    ".repeat(depth)
      out.push({ value: f.id.toString(), label: `${indent}📂 ${f.name}` })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke flytte filen. Prøv igen.")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (selectedFolderId === null) return

    moveMutation.mutate()
  }

  const folderOptions = buildFolderOptions(folders)

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

interface MembersSectionProps {
  subgroup: Subgroup

  currentUserId: number | null
}

const ROLE_FALLBACK = ["Medlem"]

function MembersSection({ subgroup, currentUserId }: MembersSectionProps) {
  const queryClient = useQueryClient()

  const { user } = useAuthStore()

  const { data: roleOptions } = useQuery({
    queryKey: ["forum-role-options"],
    queryFn: forumApi.getRoleOptions,
    staleTime: 5 * 60 * 1000,
  })

  const roleSuggestions =
    roleOptions && roleOptions.length > 0 ? roleOptions : ROLE_FALLBACK

  const [expanded, setExpanded] = useState(false)

  const [pickerOpened, { open: openPicker, close: closePicker }] =
    useDisclosure(false)

  const [removeTarget, setRemoveTarget] = useState<SubgroupMember | null>(null)

  const [leaveOpened, { open: openLeave, close: closeLeave }] =
    useDisclosure(false)

  const canManage = subgroup.is_member || !!user?.is_staff

  const sortedMembers = [...subgroup.members].sort((a, b) => {
    const an = `${a.user.first_name} ${a.user.last_name}`.toLowerCase()

    const bn = `${b.user.first_name} ${b.user.last_name}`.toLowerCase()

    return an.localeCompare(bn, "da")
  })

  const invalidateSubgroup = () => {
    queryClient.invalidateQueries({ queryKey: ["subgroup", subgroup.slug] })
  }

  const addMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      forumApi.addMembers(subgroup.slug, userIds),

    onSuccess: () => {
      notifications.show({
        title: "Medlemmer tilføjet",

        message: "Medlemmerne er blevet tilføjet.",

        color: "green",
      })

      invalidateSubgroup()

      closePicker()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke tilføje medlemmer.")
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      forumApi.removeMember(subgroup.slug, userId),

    onSuccess: () => {
      notifications.show({
        title: "Medlem fjernet",

        message: "Medlemmet er blevet fjernet fra gruppen.",

        color: "green",
      })

      invalidateSubgroup()

      setRemoveTarget(null)
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke fjerne medlem.")
    },
  })

  interface mutationFnEntry {
    userId: number

    role: string
  }

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: mutationFnEntry) =>
      forumApi.updateMemberRole(subgroup.slug, userId, role),

    onSuccess: () => {
      invalidateSubgroup()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere rolle.")
    },
  })

  const leaveMutation = useMutation({
    mutationFn: () => forumApi.leaveSubgroup(subgroup.slug),

    onSuccess: () => {
      notifications.show({
        title: "Du har forladt gruppen",

        message: `Du er ikke længere medlem af ${subgroup.name}.`,

        color: "green",
      })

      invalidateSubgroup()

      closeLeave()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke forlade gruppen.")
    },
  })

  return (
    <Paper withBorder p={{ base: "xs", sm: "md" }} radius="md" mb="md">
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded((e) => !e)}
      >
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <IconUsers size={20} />
          <Text fw={600}>Medlemmer</Text>
          <Badge variant="light">{subgroup.members.length}</Badge>
        </Group>
        <ActionIcon variant="subtle" color="gray" aria-label="Vis medlemmer">
          {expanded ? (
            <IconChevronUp size={18} />
          ) : (
            <IconChevronDown size={18} />
          )}
        </ActionIcon>
      </Group>

      {expanded && (
        <Stack gap="xs" mt="sm">
          {sortedMembers.length === 0 && (
            <Text c="dimmed" size="sm">
              Ingen medlemmer endnu. Tilføj det første medlem for at komme i
              gang.
            </Text>
          )}
          {sortedMembers.map((m) => (
            <Group key={m.id} justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Anchor
                  href={`/profil/${m.user.id}`}
                  style={{ display: "flex", flexShrink: 0 }}
                >
                  <Avatar src={m.user.profile_picture} radius="xl" size="sm">
                    {m.user.first_name?.[0]}
                    {m.user.last_name?.[0]}
                  </Avatar>
                </Anchor>
                <Text truncate size="sm" style={{ minWidth: 0 }}>
                  {m.user.first_name} {m.user.last_name}
                </Text>
              </Group>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {canManage ? (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <Badge
                        variant="light"
                        color="gray"
                        size="sm"
                        style={{ cursor: "pointer" }}
                      >
                        {m.role || "Medlem"}
                      </Badge>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {roleSuggestions.map((role) => (
                        <Menu.Item
                          key={role}
                          onClick={() => {
                            if (role !== m.role) {
                              roleMutation.mutate({
                                userId: m.user.id,

                                role,
                              })
                            }
                          }}
                          fw={(m.role || "Medlem") === role ? 700 : undefined}
                        >
                          {role}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                ) : (
                  <Badge variant="light" color="gray" size="sm">
                    {m.role || "Medlem"}
                  </Badge>
                )}
                {canManage && (
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="sm"
                    onClick={() => setRemoveTarget(m)}
                    aria-label={`Fjern ${m.user.first_name}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
          ))}
          <Group justify="space-between" mt="xs">
            {canManage ? (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconUserPlus size={14} />}
                onClick={openPicker}
              >
                Tilføj medlem
              </Button>
            ) : (
              <span />
            )}
            {subgroup.is_member && currentUserId !== null && (
              <Button size="xs" variant="light" color="red" onClick={openLeave}>
                Forlad gruppe
              </Button>
            )}
          </Group>
        </Stack>
      )}

      <UserPickerModal
        opened={pickerOpened}
        onClose={closePicker}
        onConfirm={(userIds) => addMutation.mutate(userIds)}
        title={`Tilføj medlem til ${subgroup.name}`}
        confirmLabel="Tilføj"
        excludeUserIds={subgroup.members.map((m) => m.user.id)}
        loading={addMutation.isPending}
      />

      <Modal
        opened={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Fjern medlem"
        size="sm"
      >
        <Stack gap="md">
          <Text>
            Er du sikker på, at du vil fjerne{" "}
            <strong>
              {removeTarget?.user.first_name} {removeTarget?.user.last_name}
            </strong>{" "}
            fra gruppen?
          </Text>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setRemoveTarget(null)}>
              Annuller
            </Button>
            <Button
              color="red"
              loading={removeMutation.isPending}
              onClick={() => {
                if (removeTarget) removeMutation.mutate(removeTarget.user.id)
              }}
            >
              Fjern
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={leaveOpened}
        onClose={closeLeave}
        title="Forlad gruppe"
        size="sm"
      >
        <Stack gap="md">
          <Text>
            Er du sikker på, at du vil forlade <strong>{subgroup.name}</strong>?
            Dit abonnement bevares — du kan stadig følge med i gruppen.
          </Text>
          <Group justify="flex-end">
            <Button variant="light" onClick={closeLeave}>
              Annuller
            </Button>
            <Button
              color="red"
              loading={leaveMutation.isPending}
              onClick={() => leaveMutation.mutate()}
            >
              Forlad
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  )
}
