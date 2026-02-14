import { useState, useEffect } from "react"
import {
  Modal,
  Image,
  Text,
  Group,
  Stack,
  Button,
  Loader,
  Center,
  Code,
  ScrollArea,
  Box,
} from "@mantine/core"
import {
  IconDownload,
  IconPhoto,
  IconFileTypePdf,
  IconFileTypeDoc,
  IconFileTypePpt,
  IconFileText,
  IconFile,
} from "@tabler/icons-react"
import type { ForumFile } from "../types"

// File type detection utilities
const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]
const PDF_EXTENSIONS = ["pdf"]
const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "json",
  "xml",
  "csv",
  "log",
  "ini",
  "yaml",
  "yml",
]
const WORD_EXTENSIONS = ["doc", "docx", "odt", "rtf"]
const POWERPOINT_EXTENSIONS = ["ppt", "pptx", "odp"]

type FileType = "image" | "pdf" | "text" | "word" | "powerpoint" | "other"

export function getFileExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".")
  return parts.length > 1 ? parts[parts.length - 1] : ""
}

export function getFileType(filename: string): FileType {
  const ext = getFileExtension(filename)

  if (IMAGE_EXTENSIONS.includes(ext)) return "image"
  if (PDF_EXTENSIONS.includes(ext)) return "pdf"
  if (TEXT_EXTENSIONS.includes(ext)) return "text"
  if (WORD_EXTENSIONS.includes(ext)) return "word"
  if (POWERPOINT_EXTENSIONS.includes(ext)) return "powerpoint"
  return "other"
}

export function getFileIcon(filename: string) {
  const type = getFileType(filename)

  switch (type) {
    case "image":
      return IconPhoto
    case "pdf":
      return IconFileTypePdf
    case "text":
      return IconFileText
    case "word":
      return IconFileTypeDoc
    case "powerpoint":
      return IconFileTypePpt
    default:
      return IconFile
  }
}

export function getFileTypeColor(filename: string): string {
  const type = getFileType(filename)

  switch (type) {
    case "image":
      return "green"
    case "pdf":
      return "red"
    case "text":
      return "gray"
    case "word":
      return "blue"
    case "powerpoint":
      return "orange"
    default:
      return "gray"
  }
}

interface FilePreviewModalProps {
  file: ForumFile | null
  opened: boolean
  onClose: () => void
}

export function FilePreviewModal({
  file,
  opened,
  onClose,
}: FilePreviewModalProps) {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileType = file ? getFileType(file.name) : "other"

  // Fetch file content when needed
  useEffect(() => {
    if (!file || !opened) {
      setTextContent(null)
      setError(null)
      // Clean up blob URL when closing
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl)
        setPdfBlobUrl(null)
      }
      return
    }

    if (fileType === "text") {
      setLoading(true)
      setError(null)

      fetch(file.file_url)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load file")
          return res.text()
        })
        .then((text) => {
          setTextContent(text)
          setLoading(false)
        })
        .catch(() => {
          setError("Kunne ikke indlæse filindholdet")
          setLoading(false)
        })
    }

    if (fileType === "pdf") {
      setLoading(true)
      setError(null)

      fetch(file.file_url)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load file")
          return res.blob()
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          setPdfBlobUrl(url)
          setLoading(false)
        })
        .catch(() => {
          setError("Kunne ikke indlæse PDF-filen")
          setLoading(false)
        })
    }
  }, [file, opened, fileType])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl)
      }
    }
  }, [pdfBlobUrl])

  if (!file) return null

  const handleDownload = () => {
    window.open(file.file_url, "_blank")
  }

  const renderPreviewContent = () => {
    switch (fileType) {
      case "image":
        return (
          <Stack gap="md">
            <Center>
              <Image
                src={file.file_url}
                alt={file.name}
                radius="md"
                maw="100%"
                mah="70vh"
                w="auto"
                h="auto"
              />
            </Center>
            <Group justify="center">
              <Button
                variant="light"
                leftSection={<IconDownload size={16} />}
                onClick={handleDownload}
              >
                Download fil
              </Button>
            </Group>
          </Stack>
        )

      case "pdf":
        if (loading) {
          return (
            <Center h={300}>
              <Loader />
            </Center>
          )
        }
        if (error) {
          return (
            <Stack align="center" gap="lg" py="xl">
              <IconFileTypePdf size={80} color="var(--mantine-color-red-6)" />
              <Text c="red">{error}</Text>
              <Button
                leftSection={<IconDownload size={16} />}
                onClick={handleDownload}
              >
                Download fil
              </Button>
            </Stack>
          )
        }
        if (!pdfBlobUrl) {
          return (
            <Center h={300}>
              <Loader />
            </Center>
          )
        }
        return (
          <Stack gap="md">
            <Box style={{ width: "100%", height: "65vh" }}>
              <iframe
                src={pdfBlobUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  borderRadius: "8px",
                }}
                title={file.name}
              />
            </Box>
            <Group justify="center">
              <Button
                variant="light"
                leftSection={<IconDownload size={16} />}
                onClick={handleDownload}
              >
                Download fil
              </Button>
            </Group>
          </Stack>
        )

      case "text":
        if (loading) {
          return (
            <Center h={200}>
              <Loader />
            </Center>
          )
        }
        if (error) {
          return (
            <Center h={200}>
              <Text c="red">{error}</Text>
            </Center>
          )
        }
        return (
          <Stack gap="md">
            <ScrollArea h="60vh">
              <Code
                block
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {textContent}
              </Code>
            </ScrollArea>
            <Group justify="center">
              <Button
                variant="light"
                leftSection={<IconDownload size={16} />}
                onClick={handleDownload}
              >
                Download fil
              </Button>
            </Group>
          </Stack>
        )

      case "word":
        if (file.preview_html) {
          return (
            <Stack gap="md">
              <ScrollArea h="60vh">
                <Box
                  p="md"
                  style={{
                    backgroundColor: "var(--mantine-color-gray-0)",
                    borderRadius: "var(--mantine-radius-md)",
                  }}
                  dangerouslySetInnerHTML={{ __html: file.preview_html }}
                />
              </ScrollArea>
              <Group justify="center">
                <Button
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                  onClick={handleDownload}
                >
                  Download fil
                </Button>
              </Group>
            </Stack>
          )
        }
        return (
          <Stack align="center" gap="lg" py="xl">
            <IconFileTypeDoc size={80} color="var(--mantine-color-blue-6)" />
            <Text size="lg" fw={500}>
              {file.name}
            </Text>
            <Text c="dimmed" ta="center">
              Word-dokumenter kan ikke vises direkte i browseren.
              <br />
              Download filen for at åbne den i Microsoft Word eller en
              kompatibel applikation.
            </Text>
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={handleDownload}
            >
              Download fil
            </Button>
          </Stack>
        )

      case "powerpoint":
        return (
          <Stack align="center" gap="lg" py="xl">
            <IconFileTypePpt size={80} color="var(--mantine-color-orange-6)" />
            <Text size="lg" fw={500}>
              {file.name}
            </Text>
            <Text c="dimmed" ta="center">
              PowerPoint-præsentationer kan ikke vises direkte i browseren.
              <br />
              Download filen for at åbne den i Microsoft PowerPoint eller en
              kompatibel applikation.
            </Text>
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={handleDownload}
            >
              Download fil
            </Button>
          </Stack>
        )

      default:
        return (
          <Stack align="center" gap="lg" py="xl">
            <IconFile size={80} color="var(--mantine-color-gray-6)" />
            <Text size="lg" fw={500}>
              {file.name}
            </Text>
            <Text c="dimmed" ta="center">
              Denne filtype kan ikke forhåndsvises.
              <br />
              Download filen for at åbne den.
            </Text>
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={handleDownload}
            >
              Download fil
            </Button>
          </Stack>
        )
    }
  }

  const modalSize = () => {
    switch (fileType) {
      case "pdf":
        return "80%"
      case "text":
        return "xl"
      case "word":
        return file?.preview_html ? "xl" : "md"
      case "image":
        return "auto"
      default:
        return "md"
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={file.name}
      size={modalSize()}
      centered
    >
      {renderPreviewContent()}
    </Modal>
  )
}

interface ImageThumbnailProps {
  file: ForumFile
  size?: number
  onClick?: () => void
}

export function ImageThumbnail({
  file,
  size = 48,
  onClick,
}: ImageThumbnailProps) {
  const fileType = getFileType(file.name)

  if (fileType !== "image") {
    const Icon = getFileIcon(file.name)
    return (
      <Icon
        size={size}
        color={`var(--mantine-color-${getFileTypeColor(file.name)}-6)`}
      />
    )
  }

  return (
    <Image
      src={file.file_url}
      alt={file.name}
      w={size}
      h={size}
      fit="cover"
      radius="sm"
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    />
  )
}
