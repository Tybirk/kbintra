import {
  Textarea,
  ActionIcon,
  Group,
  Box,
  FileButton,
  Image,
  CloseButton,
  Text,
  Stack,
  ScrollArea,
  Anchor,
  Popover,
  UnstyledButton,
  Avatar,
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconSend,
  IconPaperclip,
  IconFile,
  IconPhoto,
  IconChevronRight,
} from "@tabler/icons-react"
import {
  useRef,
  useEffect,
  useState,
  lazy,
  Suspense,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react"
import { filterFilesBySize } from "../config"
const EmojiPicker = lazy(() => import("./EmojiPicker"))
import { saveDraft, loadDraft, clearDraft } from "../utils/draftStorage"
import { usersApi } from "../api/users"
import type { MentionUser } from "../types"
import { filterEmojis, prefetchEmojis, type EmojiItem } from "./emojiData"
import GiphyPicker, { type GiphyAnchor } from "./GiphyPicker"

interface ChatGiphyState {
  query: string
  anchor: GiphyAnchor
}

interface ChatRichTextEditorProps {
  content: string
  onChange: (content: string) => void
  onSend: () => void
  placeholder?: string
  disabled?: boolean
  attachments: File[]
  onAttachmentsChange: (files: File[]) => void
  /** Called whenever the set of mentioned user IDs changes. */
  onMentionedUsersChange?: (userIds: number[]) => void
  /** Restrict mention suggestions to this list (e.g. conversation participants). */
  mentionableUsers?: MentionUser[]
  /** Unique key for persisting a draft across refreshes. */
  draftKey?: string
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/")
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ChatRichTextEditor({
  content,
  onChange,
  onSend,
  placeholder = "Skriv en besked...",
  disabled = false,
  attachments,
  onAttachmentsChange,
  onMentionedUsersChange,
  mentionableUsers,
  draftKey,
}: ChatRichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isMobile = useMediaQuery("(max-width: 768px)")
  const [attachExpanded, setAttachExpanded] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const loadedForKeyRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mention state
  const [allUsers, setAllUsers] = useState<MentionUser[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionUser[]>(
    [],
  )
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  // Map from user ID → "@FirstName LastName" so we can detect when mention text is deleted
  const mentionedIdsRef = useRef<Map<number, string>>(new Map())
  const mentionPopoverOpen =
    mentionQuery !== null && mentionSuggestions.length > 0

  // Emoji suggestion state
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiSuggestions, setEmojiSuggestions] = useState<EmojiItem[]>([])
  const [selectedEmojiIndex, setSelectedEmojiIndex] = useState(0)
  const emojiPopoverOpen = emojiQuery !== null && emojiSuggestions.length > 0

  // Giphy state
  const [giphyState, setGiphyState] = useState<ChatGiphyState | null>(null)

  // Kick off emoji data load in the background so it's ready when needed.
  useEffect(() => {
    prefetchEmojis()
  }, [])

  // Populate the user pool for mention filtering.
  // When mentionableUsers is provided, use it directly (e.g. conversation participants).
  // Otherwise fall back to fetching all users from the API.
  useEffect(() => {
    if (mentionableUsers) {
      setAllUsers(mentionableUsers)
      return
    }
    usersApi
      .mentionSearch("")
      .then(setAllUsers)
      .catch(() => {})
  }, [mentionableUsers])

  // Returns the IDs of mentions whose text is still present in the content
  const getActiveMentionIds = (text: string): number[] => {
    const ids: number[] = []
    for (const [id, name] of mentionedIdsRef.current) {
      if (text.includes(name)) ids.push(id)
    }
    return ids
  }

  // Clear mention/giphy state when content is reset to empty (after send)
  useEffect(() => {
    if (!content) {
      mentionedIdsRef.current = new Map()
      setMentionQuery(null)
      setMentionSuggestions([])
      setGiphyState(null)
    }
  }, [content])

  // Track object URLs to revoke them when files are removed or component unmounts
  const [previewUrls, setPreviewUrls] = useState<Map<File, string>>(new Map())

  // Create object URLs for new files and revoke URLs for removed files
  useEffect(() => {
    const newUrls = new Map<File, string>()
    const urlsToRevoke: string[] = []

    // Create URLs for current attachments
    for (const file of attachments) {
      if (previewUrls.has(file)) {
        // Keep existing URL
        newUrls.set(file, previewUrls.get(file)!)
      } else if (isImageFile(file)) {
        // Create new URL for image files
        newUrls.set(file, URL.createObjectURL(file))
      }
    }

    // Find URLs to revoke (files that were removed)
    for (const [file, url] of previewUrls) {
      if (!attachments.includes(file)) {
        urlsToRevoke.push(url)
      }
    }

    // Revoke old URLs
    for (const url of urlsToRevoke) {
      URL.revokeObjectURL(url)
    }

    setPreviewUrls(newUrls)

    // Cleanup all URLs on unmount
    return () => {
      for (const url of newUrls.values()) {
        URL.revokeObjectURL(url)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments])

  // Load draft on mount or when draftKey changes
  useEffect(() => {
    if (!draftKey || loadedForKeyRef.current === draftKey) return
    loadedForKeyRef.current = draftKey

    loadDraft(draftKey).then((draft) => {
      if (draft && !content) {
        onChange(draft)
        setDraftRestored(true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Save draft with debounce whenever content changes
  useEffect(() => {
    if (!draftKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveDraft(draftKey, content)
    }, 1500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [draftKey, content])

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      handleFilesSelected(files)
    }
  }

  // Extract @query before the cursor
  const getMentionQuery = (text: string, cursorPos: number): string | null => {
    const beforeCursor = text.slice(0, cursorPos)
    const match = beforeCursor.match(/@(\S*)$/)
    return match ? match[1] : null
  }

  // Extract :query before the cursor (>=1 char, only after space or line start, no closing colon)
  const getEmojiQuery = (text: string, cursorPos: number): string | null => {
    const beforeCursor = text.slice(0, cursorPos)
    const match = beforeCursor.match(/(?:^|(?<=\s)):([^\s:]{1,})$/)
    return match ? match[1] : null
  }

  const handleContentChange = (newContent: string) => {
    onChange(newContent)
    // Re-derive active mentions so deleted mention text is no longer tracked
    onMentionedUsersChange?.(getActiveMentionIds(newContent))
    const textarea = textareaRef.current
    if (!textarea) {
      setMentionQuery(null)
      setMentionSuggestions([])
      setEmojiQuery(null)
      setEmojiSuggestions([])
      return
    }
    const cursor = textarea.selectionStart ?? newContent.length
    const beforeCursor = newContent.slice(0, cursor)
    const afterCursor = newContent.slice(cursor)

    const mentionQ = getMentionQuery(newContent, cursor)
    if (mentionQ !== null) {
      setMentionQuery(mentionQ)
      const lq = mentionQ.toLowerCase()
      const filtered = allUsers.filter(
        (u) =>
          u.first_name.toLowerCase().includes(lq) ||
          u.last_name.toLowerCase().includes(lq),
      )
      setMentionSuggestions(filtered.slice(0, 8))
      setSelectedMentionIndex(0)
      setEmojiQuery(null)
      setEmojiSuggestions([])
    } else {
      setMentionQuery(null)
      setMentionSuggestions([])

      // Auto-apply closed :emoji: shortcode (e.g. :tada: → 🎉)
      const closedMatch = beforeCursor.match(/(?:^|(?<=\s)):([^\s:]{1,}):$/)
      if (closedMatch) {
        filterEmojis(closedMatch[1]).then((results) => {
          const exactEmoji = results.find(
            (e) => e.id === closedMatch[1].toLowerCase(),
          )
          if (exactEmoji) {
            const replaced = beforeCursor.replace(
              /:[^\s:]{1,}:$/,
              exactEmoji.native,
            )
            onChange(replaced + afterCursor)
            setEmojiQuery(null)
            setEmojiSuggestions([])
            requestAnimationFrame(() => {
              textarea.focus()
              textarea.setSelectionRange(replaced.length, replaced.length)
            })
          }
        })
        return
      }

      const emojiQ = getEmojiQuery(newContent, cursor)
      if (emojiQ !== null) {
        setEmojiQuery(emojiQ)
        filterEmojis(emojiQ).then((suggestions) => {
          setEmojiSuggestions(suggestions)
          setSelectedEmojiIndex(0)
        })
      } else {
        setEmojiQuery(null)
        setEmojiSuggestions([])
      }
    }

    // Giphy detection — independent of mention/emoji triggers
    const giphyMatch = beforeCursor.match(/\/giphy\s+(\S+)$/)
    if (giphyMatch) {
      const rect = textarea.getBoundingClientRect()
      setGiphyState({
        query: giphyMatch[1],
        anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
      })
    } else {
      setGiphyState(null)
    }
  }

  const applyEmoji = (emoji: EmojiItem) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart ?? content.length
    const beforeCursor = content.slice(0, cursor)
    const afterCursor = content.slice(cursor)
    const replaced = beforeCursor.replace(/:[^\s:]{1,}$/, emoji.native)
    const newContent = replaced + afterCursor
    onChange(newContent)
    setEmojiQuery(null)
    setEmojiSuggestions([])
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const applyMention = (user: MentionUser) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart ?? content.length
    const beforeCursor = content.slice(0, cursor)
    const afterCursor = content.slice(cursor)
    // Replace the @query with @FirstName LastName
    const replaced = beforeCursor.replace(
      /@(\S*)$/,
      `@${user.first_name} ${user.last_name} `,
    )
    const newContent = replaced + afterCursor
    onChange(newContent)
    setMentionQuery(null)
    setMentionSuggestions([])
    // Track mention by user ID so we can detect if the user later deletes it
    mentionedIdsRef.current.set(
      user.id,
      `@${user.first_name} ${user.last_name}`,
    )
    onMentionedUsersChange?.(getActiveMentionIds(newContent))
    // Restore focus and move cursor after the mention
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const handleGiphyInsert = (url: string) => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? content.length
    const beforeCursor = content.slice(0, cursor)
    const afterCursor = content.slice(cursor)
    const replaced = beforeCursor.replace(/\/giphy\s+\S+$/, url)
    const newContent = replaced + afterCursor
    onChange(newContent)
    setGiphyState(null)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const handleGiphyCancel = () => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? content.length
    const beforeCursor = content.slice(0, cursor)
    const afterCursor = content.slice(cursor)
    const replaced = beforeCursor.replace(/\/giphy\s+\S+$/, "")
    onChange(replaced + afterCursor)
    setGiphyState(null)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle giphy picker dismiss
    if (giphyState && event.key === "Escape") {
      handleGiphyCancel()
      return
    }
    // Handle emoji popup navigation
    if (emojiPopoverOpen) {
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedEmojiIndex(
          (i) => (i + emojiSuggestions.length - 1) % emojiSuggestions.length,
        )
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedEmojiIndex((i) => (i + 1) % emojiSuggestions.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        applyEmoji(emojiSuggestions[selectedEmojiIndex])
        return
      }
      if (event.key === "Escape") {
        setEmojiQuery(null)
        setEmojiSuggestions([])
        return
      }
    }
    // Handle mention popup navigation
    if (mentionPopoverOpen) {
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedMentionIndex(
          (i) =>
            (i + mentionSuggestions.length - 1) % mentionSuggestions.length,
        )
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedMentionIndex((i) => (i + 1) % mentionSuggestions.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        applyMention(mentionSuggestions[selectedMentionIndex])
        return
      }
      if (event.key === "Escape") {
        setMentionQuery(null)
        setMentionSuggestions([])
        return
      }
    }
    // Cmd+Enter (Mac) / Ctrl+Enter always sends, even on mobile
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (content.trim() || attachments.length > 0) {
        onSend()
      }
      return
    }
    // On mobile, Enter creates a newline (more natural for touch keyboards)
    // On desktop, Enter submits (Shift+Enter for newline)
    if (event.key === "Enter" && !event.shiftKey && !isMobile) {
      event.preventDefault()
      if (content.trim() || attachments.length > 0) {
        onSend()
      }
    }
  }

  const handleEmojiSelect = (emoji: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(content + emoji)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newContent = content.slice(0, start) + emoji + content.slice(end)
    onChange(newContent)

    requestAnimationFrame(() => {
      textarea.focus()
      const newPosition = start + emoji.length
      textarea.setSelectionRange(newPosition, newPosition)
    })
  }

  const handleFilesSelected = (files: File[]) => {
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
      onAttachmentsChange([...attachments, ...validFiles])
    }
  }

  const handleRemoveFile = (index: number) => {
    onAttachmentsChange(attachments.filter((_, i) => i !== index))
  }

  const handleClearDraft = () => {
    if (draftKey) clearDraft(draftKey)
    setDraftRestored(false)
    onChange("")
  }

  const isEmpty = !content.trim() && attachments.length === 0

  // Add hint about Shift+Enter on desktop
  const actualPlaceholder = isMobile
    ? placeholder
    : `${placeholder} (Shift+Enter for ny linje)`

  return (
    <Stack gap="xs">
      {giphyState && (
        <GiphyPicker
          query={giphyState.query}
          anchor={giphyState.anchor}
          onInsert={handleGiphyInsert}
          onCancel={handleGiphyCancel}
        />
      )}
      {draftRestored && (
        <Group gap={4}>
          <Text size="xs" c="dimmed" fs="italic">
            Kladde gendannet automatisk
          </Text>
          <Anchor size="xs" onClick={handleClearDraft}>
            (ryd)
          </Anchor>
        </Group>
      )}
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
                {isImageFile(file) && previewUrls.get(file) ? (
                  <Image
                    src={previewUrls.get(file)}
                    alt={file.name}
                    w={80}
                    h={80}
                    fit="cover"
                    radius="sm"
                  />
                ) : isImageFile(file) ? null : (
                  <Box
                    w={80}
                    h={80}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "var(--mantine-color-default-hover)",
                      borderRadius: "var(--mantine-radius-sm)",
                    }}
                  >
                    <IconFile size={24} color="gray" />
                    <Text size="xs" c="dimmed" truncate w={70} ta="center">
                      {file.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatFileSize(file.size)}
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
                    backgroundColor: "var(--mantine-color-default-hover)",
                    borderRadius: "50%",
                  }}
                />
              </Box>
            ))}
          </Group>
        </ScrollArea>
      )}
      <Group
        gap={isMobile ? 4 : "xs"}
        align="flex-end"
        wrap="nowrap"
        style={{ minWidth: 0 }}
      >
        {isMobile ? (
          /* Mobile: chevron to reveal attachment buttons, or the buttons themselves */
          attachExpanded ? (
            <Group gap={2} wrap="nowrap" mb={1}>
              <FileButton
                onChange={handleFilesSelected}
                multiple
                accept="image/*"
              >
                {(props) => (
                  <ActionIcon
                    {...props}
                    variant="subtle"
                    color="gray"
                    size="md"
                    disabled={disabled}
                    title="Vælg billeder"
                  >
                    <IconPhoto size={18} />
                  </ActionIcon>
                )}
              </FileButton>
              <FileButton onChange={handleFilesSelected} multiple>
                {(props) => (
                  <ActionIcon
                    {...props}
                    variant="subtle"
                    color="gray"
                    size="md"
                    disabled={disabled}
                    title="Vedhæft fil"
                  >
                    <IconPaperclip size={18} />
                  </ActionIcon>
                )}
              </FileButton>
            </Group>
          ) : (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              mb={1}
              onClick={() => setAttachExpanded(true)}
              title="Vis vedhæftninger"
            >
              <IconChevronRight size={18} />
            </ActionIcon>
          )
        ) : (
          /* Desktop: always show all action icons */
          <Group gap={4} wrap="nowrap" mb={1}>
            <FileButton
              onChange={handleFilesSelected}
              multiple
              accept="image/*"
            >
              {(props) => (
                <ActionIcon
                  {...props}
                  variant="subtle"
                  color="gray"
                  size="lg"
                  disabled={disabled}
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
                  disabled={disabled}
                  title="Vedhæft fil"
                >
                  <IconPaperclip size={20} />
                </ActionIcon>
              )}
            </FileButton>
            <Suspense fallback={null}>
              <EmojiPicker onSelect={handleEmojiSelect} disabled={disabled} />
            </Suspense>
          </Group>
        )}

        {/* Message input with mention/emoji popover */}
        <Popover
          opened={mentionPopoverOpen || emojiPopoverOpen}
          position="top-start"
          withArrow={false}
          shadow="md"
          withinPortal
        >
          <Popover.Target>
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => {
                if (isMobile) setAttachExpanded(false)
              }}
              placeholder={actualPlaceholder}
              disabled={disabled}
              autosize
              minRows={1}
              maxRows={6}
              style={{ flex: 1 }}
              styles={{
                input: {
                  borderRadius: "var(--mantine-radius-md)",
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 10,
                  paddingRight: 10,
                },
              }}
            />
          </Popover.Target>
          <Popover.Dropdown p={4}>
            <Stack gap={0}>
              {emojiPopoverOpen
                ? emojiSuggestions.map((emoji, index) => (
                    <UnstyledButton
                      key={emoji.id}
                      onClick={() => applyEmoji(emoji)}
                      py={4}
                      px={8}
                      style={{
                        backgroundColor:
                          index === selectedEmojiIndex
                            ? "var(--mantine-color-blue-light)"
                            : undefined,
                        borderRadius: "var(--mantine-radius-sm)",
                      }}
                    >
                      <Text size="sm">
                        {emoji.native} :{emoji.id}:
                      </Text>
                    </UnstyledButton>
                  ))
                : mentionSuggestions.map((user, index) => (
                    <UnstyledButton
                      key={user.id}
                      onClick={() => applyMention(user)}
                      py={6}
                      px={8}
                      style={{
                        backgroundColor:
                          index === selectedMentionIndex
                            ? "var(--mantine-color-blue-light)"
                            : undefined,
                        borderRadius: "var(--mantine-radius-sm)",
                      }}
                    >
                      <Group gap={8}>
                        <Avatar
                          src={user.profile_picture}
                          size={24}
                          radius="xl"
                        >
                          {user.first_name[0]}
                        </Avatar>
                        <Text size="sm">
                          {user.first_name} {user.last_name}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
            </Stack>
          </Popover.Dropdown>
        </Popover>

        {/* Emoji picker — always visible on mobile, part of desktop action group above */}
        {isMobile && (
          <Box mb={1}>
            <Suspense fallback={null}>
              <EmojiPicker
                onSelect={handleEmojiSelect}
                disabled={disabled}
                size="md"
                iconSize={18}
              />
            </Suspense>
          </Box>
        )}

        {/* Send button */}
        <ActionIcon
          size={isMobile ? "md" : "lg"}
          radius="md"
          variant="filled"
          onClick={onSend}
          disabled={disabled || isEmpty}
          mb={1}
          mr={isMobile ? 2 : undefined}
        >
          <IconSend size={isMobile ? 16 : 18} />
        </ActionIcon>
      </Group>
    </Stack>
  )
}
