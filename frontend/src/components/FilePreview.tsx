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

import { unsignedMediaUrl } from "../utils/mediaUrl"

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

  // Apple formats — not browser-renderable on their own. Classified as images
  // so surfaces with a server-generated JPEG `preview` show it; where no preview
  // exists, getRenderableFileType() demotes them to a file tile.
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

/** True for Apple's HEIC/HEIF, which no browser but Safari can decode. */
export function isHeic(filename: string): boolean {
  const ext = getFileExtension(filename)

  return ext === "heic" || ext === "heif"
}

/**
 * The type to *render* a file as, which isn't always what its name says.
 *
 * HEIC counts as an image only when the backend really produced a JPEG for it.
 * There are two ways it might not have:
 *
 *  - the surface has no `preview` column at all (forum documents, search), so
 *    `preview_url` is absent; or
 *  - conversion failed — an HEVC 10-bit still that libheif won't decode, say —
 *    and the serializer fell back to handing out the original .heic under both
 *    names. An identical URL is exactly as much "no preview" as a missing one,
 *    and only comparing them catches this case.
 *
 * Either way, putting the raw .heic in an <img> shows a broken image in
 * everything but Safari; the generic file tile keeps it openable via Del/Gem.
 */
export function getRenderableFileType(file: PreviewableFile): FileType {
  const type = getFileType(file.name)

  if (type !== "image" || !isHeic(file.name)) return type

  if (!file.preview_url) return "other"

  // Compare without the signature: both URLs are signed at the same instant, but
  // the token is incidental to whether they point at the same file.
  if (unsignedMediaUrl(file.preview_url) === unsignedMediaUrl(file.file_url)) {
    return "other"
  }

  return type
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

  /** Server-generated JPEG for formats browsers can't decode (HEIC/HEIF). */
  preview_url?: string | null
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
  const fileType = file ? getRenderableFileType(file) : "other"

  // Images are in here for sharing, not for rendering: they display straight
  // from `src`, but navigator.canShare() needs a real File before it will say
  // whether the browser accepts the type — and sharing a photo is precisely what
  // Chrome/Android does allow. Without a blob, canShare is permanently false and
  // the Del button never appears. The fetch hits the same URL the <img> already
  // loaded, so it comes from the HTTP cache.
  const needsBlob =
    fileType === "pdf" ||
    fileType === "word" ||
    fileType === "powerpoint" ||
    fileType === "image" ||
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

  // Whether the browser will actually accept this file in the share sheet.
  // Chrome/Android permits only a fixed set of types (PDF, images, audio, video,
  // plain text) and rejects Office documents, while iOS Safari accepts them — so
  // asking the browser is the only reliable test. False until the blob is
  // prefetched, since canShare needs the real File.
  const canShare =
    shareFile !== null &&
    (navigator.canShare?.({ files: [shareFile] }) ?? false)

  // "Åbn" — hand the file to the OS share sheet (iOS/Android) so the user can
  // open it in the default viewer (Word/Pages/Quick Look) or save it. Called
  // synchronously with the prefetched File so the user gesture isn't lost.
  // Where file-sharing isn't supported (desktop): PDFs open in a new tab,
  // everything else downloads with its proper filename (window.open on a
  // non-renderable blob would save it under a random UUID name).
  const handleOpen = () => {
    if (canShare && shareFile) {
      navigator.share({ files: [shareFile], title: filename }).catch(() => {})

      return
    }

    if (blobUrl && fileType === "pdf") {
      window.open(blobUrl, "_blank", "noopener,noreferrer")

      return
    }

    // Neither sharing nor an inline tab is possible (e.g. a PDF whose blob
    // failed to load) — fall back to a download, but tell the user so the
    // button never silently appears to do nothing.
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

    canShare,

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

  // PDFs always get the button: it shares on mobile and opens a tab on desktop.
  // Anything else only gets it on a touch device whose browser confirms it can
  // share that file type — Chrome/Android refuses Office documents, and a "Del"
  // that silently degrades to the download "Gem" already does is worse than no
  // button at all.
  // useMediaQuery is undefined on first render (falsy) → safe desktop default.
  const showOpen = actions.fileType === "pdf" || (!!isTouch && actions.canShare)

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
                src={file.preview_url ?? file.file_url}
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
  const fileType = getRenderableFileType(file)

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
      src={file.preview_url ?? file.file_url}
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
