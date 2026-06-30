import { useState, useEffect, lazy, Suspense, type ReactNode } from "react"

import { useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

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
  type ButtonProps,
} from "@mantine/core"

import {
  IconDownload,
  IconExternalLink,
  IconPhoto,
  IconFileTypePdf,
  IconFileTypeDoc,
  IconFileTypePpt,
  IconFileText,
  IconFile,
} from "@tabler/icons-react"

import type { ForumFile } from "../types"

import { ErrorBoundary } from "./ErrorBoundary"

// pdf.js is heavy — only load it when a PDF is actually opened.
const PdfViewer = lazy(() => import("./PdfViewer"))

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

  // Apple formats — not browser-renderable, but the backend generates a
  // web-viewable JPEG `preview`; we classify them as images so the UI shows
  // that preview instead of a generic "cannot preview" tile.
  "heic",

  "heif",
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

interface PreviewableFile {
  name: string

  file_url: string
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a")

  a.href = url

  a.download = filename

  document.body.appendChild(a)

  a.click()

  document.body.removeChild(a)
}

/**
 * Shared blob/share/download logic for file previews. Used by both
 * FilePreviewModal and AttachmentCarousel so they behave identically.
 *
 * Document-like types are fetched to an (authenticated) blob so we can render
 * a PDF inline, hand the file to the OS share sheet / default viewer ("Åbn"),
 * and save it ("Gem") — all without navigating away or hitting the media 401.
 */
export function useFileActions(file: PreviewableFile | null, enabled: boolean) {
  const fileType = file ? getFileType(file.name) : "other"

  const needsBlob =
    fileType === "pdf" ||
    fileType === "word" ||
    fileType === "powerpoint" ||
    fileType === "other"

  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  const [shareFile, setShareFile] = useState<File | null>(null)

  const [blobError, setBlobError] = useState(false)

  const fileUrl = file?.file_url ?? null

  const filename = file?.name ?? ""

  // Fetch document-like files to an authenticated blob (used for inline PDF
  // render, "Åbn" via the share sheet, and "Gem"). Revoked on close / change.
  useEffect(() => {
    if (!fileUrl || !enabled || !needsBlob) {
      setBlobUrl(null)

      setShareFile(null)

      setBlobError(false)

      return
    }

    let objectUrl: string | null = null

    let cancelled = false

    setBlobError(false)

    fetch(fileUrl)

      .then((res) => {
        if (!res.ok) throw new Error("Failed to load file")

        return res.blob()
      })

      .then((blob) => {
        if (cancelled) return

        objectUrl = URL.createObjectURL(blob)

        setBlobUrl(objectUrl)

        setShareFile(new File([blob], filename, { type: blob.type }))
      })

      .catch(() => {
        if (!cancelled) setBlobError(true)
      })

    return () => {
      cancelled = true

      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileUrl, filename, enabled, needsBlob])

  // "Gem" — save the file. Blob-backed types reuse the prefetched blob (their
  // buttons are disabled until it's ready); image/text fetch on demand.
  const handleDownload = () => {
    if (!fileUrl) return

    if (blobUrl) {
      triggerDownload(blobUrl, filename)

      return
    }

    fetch(fileUrl)

      .then((res) => {
        if (!res.ok) throw new Error("Failed to load file")

        return res.blob()
      })

      .then((blob) => {
        const url = URL.createObjectURL(blob)

        triggerDownload(url, filename)

        // Delayed revoke — Safari can abort the download if revoked immediately.
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
      })

      .catch(() => {
        notifications.show({
          title: "Fejl",

          message: "Filen kunne ikke hentes.",

          color: "red",
        })
      })
  }

  // "Åbn" — hand the file to the OS share sheet (iOS/Android) so the user can
  // open it in the default viewer (Word/Pages/Quick Look) or save it. Called
  // synchronously with the prefetched File so the user gesture isn't lost.
  // Where file-sharing isn't supported (desktop): PDFs open in a new tab,
  // everything else downloads with its proper filename (window.open on a
  // non-renderable blob would save it under a random UUID name).
  const handleOpen = () => {
    if (shareFile && navigator.canShare?.({ files: [shareFile] })) {
      navigator.share({ files: [shareFile], title: filename }).catch(() => {})

      return
    }

    if (blobUrl && fileType === "pdf") {
      window.open(blobUrl, "_blank", "noopener,noreferrer")

      return
    }

    // No share sheet available (typically a non-PDF file on a device whose
    // browser can't share files) — fall back to a download, but tell the user
    // so "Åbn"/"Del" never silently appears to do nothing.
    notifications.show({
      title: "Filen downloades",

      message:
        "Din enhed kan ikke åbne filen direkte. Den downloades, så du kan åbne den i din foretrukne app.",
    })

    handleDownload()
  }

  return {
    fileType,

    blobUrl,

    blobError,

    // Åbn/Gem stay disabled until the blob is ready so the share sheet / blob
    // is always available synchronously in the click handler. On error they
    // re-enable as a retry path through the on-demand fetch.
    actionsDisabled: needsBlob && !blobUrl && !blobError,

    handleOpen,

    handleDownload,
  }
}

export type FileActions = ReturnType<typeof useFileActions>

interface FileActionButtonsProps {
  actions: FileActions

  size?: ButtonProps["size"]

  /** Extra buttons rendered before Åbn/Gem (e.g. "Gå til tråd"). */
  extra?: ReactNode
}

export function FileActionButtons({
  actions,

  size,

  extra,
}: FileActionButtonsProps) {
  const isTouch = useMediaQuery("(pointer: coarse)")

  // On desktop, "Åbn" only adds value for PDFs (opens in a new tab). For
  // word/powerpoint/other it just duplicates "Gem", and can silently no-op via
  // navigator.share — so hide it there. Always show it on touch devices.
  // useMediaQuery is undefined on first render (falsy) → safe desktop default.
  const showOpen = isTouch || actions.fileType === "pdf"

  // On touch devices "Åbn" hands the file to the OS share sheet (the user picks
  // an app), which Terkild noted is the better behaviour — so call it "Del"
  // there. On desktop it opens a PDF in a new tab, where "Åbn" is accurate.
  const openLabel = isTouch ? "Del" : "Åbn"

  return (
    <Group justify="center" gap="xs">
      {extra}
      {showOpen && (
        <Button
          size={size}
          leftSection={<IconExternalLink size={16} />}
          onClick={actions.handleOpen}
          disabled={actions.actionsDisabled}
        >
          {openLabel}
        </Button>
      )}
      <Button
        size={size}
        variant="light"
        leftSection={<IconDownload size={16} />}
        onClick={actions.handleDownload}
        disabled={actions.actionsDisabled}
      >
        Gem
      </Button>
    </Group>
  )
}

interface PdfPreviewProps {
  blobUrl: string
}

/** Lazy-loaded inline PDF renderer with a loading fallback. */
export function PdfPreview({ blobUrl }: PdfPreviewProps) {
  return (
    <Suspense
      fallback={
        <Center h={200}>
          <Loader />
        </Center>
      }
    >
      <PdfViewer blobUrl={blobUrl} />
    </Suspense>
  )
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

  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const isMobile = useMediaQuery("(max-width: 768px)")

  const actions = useFileActions(file, opened)

  const { fileType, blobUrl, blobError, handleDownload } = actions

  // Fetch file content when needed

  useEffect(() => {
    if (!file || !opened) {
      setTextContent(null)

      setError(null)

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
  }, [file, opened, fileType])

  if (!file) return null

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
        if (blobError) {
          return (
            <Stack align="center" gap="lg" py="xl">
              <IconFileTypePdf size={80} color="var(--mantine-color-red-6)" />
              <Text c="red" ta="center">
                Kunne ikke indlæse PDF&apos;en.
              </Text>
              <FileActionButtons actions={actions} />
            </Stack>
          )
        }

        if (!blobUrl) {
          return (
            <Center h={300}>
              <Loader />
            </Center>
          )
        }

        return (
          <Stack gap="md">
            <ScrollArea h={isMobile ? "78vh" : "70vh"}>
              {/* pdf.js (pdfjs-dist 5.x) calls Promise.withResolvers, which
                  iOS/Safari < 17.4 lacks, so inline rendering throws there.
                  Catch it and fall back to the Åbn/Gem buttons below rather
                  than crashing. resetKeys retries when a new PDF is opened. */}
              <ErrorBoundary
                resetKeys={[blobUrl]}
                fallback={
                  <Center h={200}>
                    <Stack align="center" gap="sm" px="md">
                      <IconFileTypePdf
                        size={64}
                        color="var(--mantine-color-red-6)"
                      />
                      <Text c="dimmed" ta="center">
                        PDF&apos;en kan ikke vises her. Brug Åbn eller Gem
                        nedenfor.
                      </Text>
                    </Stack>
                  </Center>
                }
              >
                <PdfPreview blobUrl={blobUrl} />
              </ErrorBoundary>
            </ScrollArea>
            <FileActionButtons actions={actions} />
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
                    backgroundColor: "#ffffff",

                    color: "#000000",

                    borderRadius: "var(--mantine-radius-md)",

                    overflowWrap: "break-word",
                  }}
                  dangerouslySetInnerHTML={{ __html: file.preview_html }}
                />
              </ScrollArea>
              <FileActionButtons actions={actions} />
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
              Word-dokumenter kan ikke vises direkte i appen.
              <br />
              Åbn dokumentet i din standard-app, eller gem det.
            </Text>
            <FileActionButtons actions={actions} />
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
              PowerPoint-præsentationer kan ikke vises direkte i appen.
              <br />
              Åbn præsentationen i din standard-app, eller gem den.
            </Text>
            <FileActionButtons actions={actions} />
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
              Åbn filen i din standard-app, eller gem den.
            </Text>
            <FileActionButtons actions={actions} />
          </Stack>
        )
    }
  }

  const modalSize = () => {
    switch (fileType) {
      case "pdf":
        return "90%"

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
      fullScreen={isMobile}
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
