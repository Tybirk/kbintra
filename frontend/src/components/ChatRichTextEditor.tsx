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
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconSend,
  IconPaperclip,
  IconFile,
  IconPhoto,
} from "@tabler/icons-react"
import {
  useRef,
  useEffect,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react"
import { filterFilesBySize } from "../config"
import EmojiPicker from "./EmojiPicker"

interface ChatRichTextEditorProps {
  content: string
  onChange: (content: string) => void
  onSend: () => void
  placeholder?: string
  disabled?: boolean
  attachments: File[]
  onAttachmentsChange: (files: File[]) => void
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
}: ChatRichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isMobile = useMediaQuery("(max-width: 768px)")

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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const isEmpty = !content.trim() && attachments.length === 0

  // Add hint about Shift+Enter on desktop
  const actualPlaceholder = isMobile
    ? placeholder
    : `${placeholder} (Shift+Enter for ny linje)`

  return (
    <Stack gap="xs">
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
                      backgroundColor: "var(--mantine-color-gray-1)",
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
                    backgroundColor: "var(--mantine-color-gray-0)",
                    borderRadius: "50%",
                  }}
                />
              </Box>
            ))}
          </Group>
        </ScrollArea>
      )}
      <Group gap="xs" align="flex-end" wrap="nowrap">
        {/* Action icons group */}
        <Group gap={4} wrap="nowrap" mb={1}>
          {/* Image picker - opens photo gallery on mobile */}
          <FileButton onChange={handleFilesSelected} multiple accept="image/*">
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
          {/* General file picker */}
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
          {/* Emoji picker */}
          <EmojiPicker onSelect={handleEmojiSelect} disabled={disabled} />
        </Group>

        {/* Message input */}
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={actualPlaceholder}
          disabled={disabled}
          autosize
          minRows={1}
          maxRows={6}
          style={{ flex: 1 }}
          styles={{
            input: {
              borderRadius: "var(--mantine-radius-xl)",
            },
          }}
        />

        {/* Send button */}
        <ActionIcon
          size="lg"
          radius="xl"
          variant="filled"
          onClick={onSend}
          disabled={disabled || isEmpty}
          mb={1}
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Stack>
  )
}
