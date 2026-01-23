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
import {
  IconSend,
  IconPaperclip,
  IconFile,
  IconPhoto,
} from "@tabler/icons-react"
import { useRef, type KeyboardEvent } from "react"
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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
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
    onAttachmentsChange([...attachments, ...files])
  }

  const handleRemoveFile = (index: number) => {
    onAttachmentsChange(attachments.filter((_, i) => i !== index))
  }

  const isEmpty = !content.trim() && attachments.length === 0

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
                {isImageFile(file) ? (
                  <Image
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    w={80}
                    h={80}
                    fit="cover"
                    radius="sm"
                  />
                ) : (
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
          placeholder={placeholder}
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
