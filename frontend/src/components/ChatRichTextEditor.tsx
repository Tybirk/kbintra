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
  rem,
} from "@mantine/core"

import { useElementSize, useMediaQuery } from "@mantine/hooks"

import { buttonColumns, buttonsWidth } from "../utils/composerButtons"

import { notifications } from "@mantine/notifications"

import {
  IconSend,
  IconPaperclip,
  IconFile,
  IconPhoto,
  IconChevronRight,
  IconChartBar,
} from "@tabler/icons-react"

import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  lazy,
  Suspense,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react"

import { filterFilesBySize } from "../config"

/** Between the buttons beside the input, lying or standing. */
const BUTTON_GAP = 2

const SEND_HINT = " (Ctrl+Enter for at sende)"

const SIZING_STYLES = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "borderTopWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderStyle",
  "tabSize",
  "textIndent",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "wordSpacing",
  "overflowWrap",
] as const

let measuringTextarea: HTMLTextAreaElement | null = null

/** How tall `textarea` would be with its text in a box `width` px wide. */
function textHeightAt(textarea: HTMLTextAreaElement, width: number): number {
  if (!measuringTextarea) {
    measuringTextarea = document.createElement("textarea")

    measuringTextarea.setAttribute("aria-hidden", "true")

    measuringTextarea.tabIndex = -1

    Object.assign(measuringTextarea.style, {
      position: "absolute",
      top: "0",
      left: "-10000px",
      visibility: "hidden",
      overflow: "hidden",
      height: "0",
      minHeight: "0",
      maxHeight: "none",
    })

    document.body.appendChild(measuringTextarea)
  }

  const style = getComputedStyle(textarea)

  for (const key of SIZING_STYLES) measuringTextarea.style[key] = style[key]

  measuringTextarea.style.width = `${width}px`

  measuringTextarea.value = textarea.value

  const border =
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)

  return measuringTextarea.scrollHeight + border
}

let measuringCanvas: HTMLCanvasElement | null = null

/** How wide `text` is in `element`'s font, in px. */
function textWidth(text: string, element: HTMLElement): number {
  const style = getComputedStyle(element)

  measuringCanvas ??= document.createElement("canvas")

  const context = measuringCanvas.getContext("2d")

  if (!context) return 0

  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`

  return context.measureText(text).width
}

const EmojiPicker = lazy(() => import("./EmojiPicker"))

import {
  DRAFT_SAVE_DELAY_MS,
  saveDraft,
  loadDraft,
  clearDraft,
} from "../utils/draftStorage"

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

  onSend: (contentOverride?: string) => void

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

  /**
   * Called when the reader clears a restored draft with "(ryd)", so the page can
   * clear what it saved beside it — a title, the recipients.
   */

  onClearDraft?: () => void

  /** Shows a poll button beside the attachment buttons when given. */
  onCreatePoll?: () => void
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
  onClearDraft,
  onCreatePoll,
}: ChatRichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isMobile = useMediaQuery("(max-width: 768px)")

  // A phone or tablet tells a picture from a file: the photo button opens the
  // photo library or camera, the paperclip the files. A computer opens the
  // same file dialog for both, so there the paperclip alone takes pictures too.
  // By the pointer, not the width: a narrow window on a computer has no camera
  // roll, and a tablet on its side still has one.
  const offersPhotoPicker = useMediaQuery("(pointer: coarse)", undefined, {
    getInitialValueInEffect: false,
  })

  const attachTitle = offersPhotoPicker
    ? "Vedhæft fil"
    : "Vedhæft fil eller billede"

  // The buttons sit in one row at the foot of the input, which starts one line
  // high and grows as the message does. A phone keeps them small and folds them
  // away while typing; a computer has room to keep them out, the emoji picker
  // too (a phone keyboard has its own).
  const buttonSize = isMobile ? "md" : "lg"

  const buttonIconSize = isMobile ? 18 : 20

  const buttonCount =
    (offersPhotoPicker ? 1 : 0) +
    1 +
    (onCreatePoll ? 1 : 0) +
    (isMobile ? 0 : 1)

  const buttonsRef = useRef<HTMLDivElement>(null)

  // Fewer columns as the message grows (see buttonColumns); null while they
  // all lie in one row.
  const [columns, setColumns] = useState<number | null>(null)

  const buttonColumnCount = columns ?? buttonCount

  const buttonRows = Math.ceil(buttonCount / buttonColumnCount)

  // Two rows of three leave a place empty: the first one, so the buttons
  // gather at the foot of the box.
  const emptyPlaces = buttonRows * buttonColumnCount - buttonCount

  // The composer's own width, which a two-pane page can leave small on a big
  // screen; the checks below run again when it changes.
  const { ref: composerRef, width: composerWidth } = useElementSize()

  // On a computer the placeholder also tells how to send, when that fits on
  // one line: autosize sizes an empty box by its placeholder.
  const [sendHintFits, setSendHintFits] = useState(true)

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
    }, DRAFT_SAVE_DELAY_MS)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [draftKey, content])

  // A taller message stands the buttons up in fewer columns, giving the text
  // their width (see buttonColumns). A phone folds them away while typing.
  useLayoutEffect(() => {
    const textarea = textareaRef.current

    const block = buttonsRef.current

    // A button, not FileButton's hidden input that comes first.
    const button = block?.querySelector("button")

    // An empty box lies them down whatever its placeholder takes. Without
    // autosize (tests) there is no height to go by.
    if (
      isMobile ||
      !content ||
      !textarea ||
      !block ||
      !button ||
      !textarea.style.height
    ) {
      setColumns(null)

      return
    }

    const side = button.offsetWidth

    const line = parseFloat(getComputedStyle(textarea).lineHeight)

    // The box takes whatever width the buttons leave.
    const textHeight = (candidate: number) =>
      textHeightAt(
        textarea,
        textarea.offsetWidth +
          block.offsetWidth -
          buttonsWidth(candidate, side, BUTTON_GAP),
      )

    const best = buttonColumns(buttonCount, side, BUTTON_GAP, line, textHeight)

    setColumns(best === buttonCount ? null : best)
  }, [content, isMobile, buttonCount, composerWidth])

  useLayoutEffect(() => {
    const textarea = textareaRef.current

    // Only while it shows, in the box as it stands then (buttons lying down).
    if (isMobile || content || columns !== null || !textarea) return

    const style = getComputedStyle(textarea)

    const room =
      textarea.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)

    setSendHintFits(textWidth(`${placeholder}${SEND_HINT}`, textarea) <= room)
  }, [content, isMobile, columns, composerWidth, placeholder])

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

    // Giphy detection — only triggers when /giphy <query> is the entire message
    const giphyMatch = newContent.match(/^\/giphy\s+(.+)/)
    const giphyQuery = giphyMatch ? giphyMatch[1].trim() : ""

    if (giphyQuery) {
      const rect = textarea.getBoundingClientRect()

      setGiphyState({
        query: giphyQuery,

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
    setGiphyState(null)

    onSend(url)
  }

  const handleGiphyCancel = () => {
    onChange("")

    setGiphyState(null)

    requestAnimationFrame(() => {
      textareaRef.current?.focus()
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

      if (!giphyState && (content.trim() || attachments.length > 0)) {
        onSend()
      }

      return
    }

    // Plain Enter always creates a newline; only Ctrl/Cmd+Enter sends (handled above)
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
          title: "Filen er for stor",

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

    onClearDraft?.()
  }

  const isEmpty = !content.trim() && attachments.length === 0

  // Add hint about Ctrl/Cmd+Enter on desktop

  const actualPlaceholder =
    isMobile || !sendHintFits ? placeholder : `${placeholder}${SEND_HINT}`

  return (
    <Stack gap="xs">
      {giphyState && (
        <GiphyPicker
          query={giphyState.query}
          anchor={giphyState.anchor}
          onSend={handleGiphyInsert}
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
        ref={composerRef}
        gap={isMobile ? 4 : "xs"}
        align="flex-end"
        wrap="nowrap"
        style={{ minWidth: 0 }}
      >
        {isMobile && attachExpanded ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            mb={1}
            onClick={() => setAttachExpanded(false)}
            title="Vis vedhæftninger"
          >
            <IconChevronRight size={18} />
          </ActionIcon>
        ) : (
          <Box
            ref={buttonsRef}
            mb={1}
            style={{
              display: "grid",

              gridTemplateColumns: `repeat(${buttonColumnCount}, auto)`,

              gap: BUTTON_GAP,
            }}
          >
            {Array.from({ length: emptyPlaces }, (_, place) => (
              <span key={place} aria-hidden />
            ))}
            {offersPhotoPicker && (
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
                    size={buttonSize}
                    disabled={disabled}
                    title="Vælg billeder"
                  >
                    <IconPhoto size={buttonIconSize} />
                  </ActionIcon>
                )}
              </FileButton>
            )}
            <FileButton onChange={handleFilesSelected} multiple>
              {(props) => (
                <ActionIcon
                  {...props}
                  variant="subtle"
                  color="gray"
                  size={buttonSize}
                  disabled={disabled}
                  title={attachTitle}
                >
                  <IconPaperclip size={buttonIconSize} />
                </ActionIcon>
              )}
            </FileButton>
            {onCreatePoll && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size={buttonSize}
                disabled={disabled}
                onClick={onCreatePoll}
                title="Opret afstemning"
              >
                <IconChartBar size={buttonIconSize} />
              </ActionIcon>
            )}
            {!isMobile && (
              <Suspense fallback={null}>
                <EmojiPicker onSelect={handleEmojiSelect} disabled={disabled} />
              </Suspense>
            )}
          </Box>
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
                if (isMobile) setAttachExpanded(true)
              }}
              onBlur={() => {
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

                  // Standing, the buttons are as tall as the box at least.
                  minHeight:
                    buttonRows > 1
                      ? `calc(${buttonRows} * ${rem(34)} + ${(buttonRows - 1) * BUTTON_GAP}px)`
                      : undefined,
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

        {/* Send button */}
        <ActionIcon
          size={isMobile ? "md" : "lg"}
          radius="md"
          variant="filled"
          onClick={() => onSend()}
          disabled={disabled || isEmpty}
          aria-label="Send"
          mb={1}
          mr={isMobile ? 2 : undefined}
        >
          <IconSend size={isMobile ? 16 : 18} />
        </ActionIcon>
      </Group>
    </Stack>
  )
}
