import { useState, useEffect } from "react"
import {
  Modal,
  Image,
  Box,
  Group,
  Text,
  Button,
  Stack,
  Loader,
  Center,
  Code,
  ScrollArea,
} from "@mantine/core"
import { Carousel } from "@mantine/carousel"
import { useMediaQuery } from "@mantine/hooks"
import {
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
  IconFileTypePdf,
  IconFileTypeDoc,
  IconFileTypePpt,
} from "@tabler/icons-react"
import { getFileType, getFileIcon, getFileTypeColor } from "./FilePreview"

interface Attachment {
  id: number
  name: string
  file_url: string
  preview_html?: string
}

interface AttachmentCarouselProps {
  attachments: Attachment[]
  opened: boolean
  onClose: () => void
  initialIndex?: number
}

export function AttachmentCarousel({
  attachments,
  opened,
  onClose,
  initialIndex = 0,
}: AttachmentCarouselProps) {
  const isMobile = useMediaQuery("(max-width: 768px)")

  // Separate images and other files, images come first
  const imageAttachments = attachments.filter(
    (att) => getFileType(att.name) === "image",
  )
  const otherAttachments = attachments.filter(
    (att) => getFileType(att.name) !== "image",
  )
  const orderedAttachments = [...imageAttachments, ...otherAttachments]

  // Recalculate initialIndex based on the original attachment's position in ordered list
  const originalAttachment = attachments[initialIndex]
  const adjustedInitialIndex = originalAttachment
    ? orderedAttachments.findIndex((att) => att.id === originalAttachment.id)
    : 0

  if (orderedAttachments.length === 0) return null

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={isMobile}
      size={isMobile ? undefined : "xxl"}
      centered
      title={
        <Text size="sm" c="dimmed">
          {orderedAttachments.length > 1
            ? `${orderedAttachments.length} vedhæftede filer`
            : orderedAttachments[0]?.name}
        </Text>
      }
      styles={{
        body: {
          padding: isMobile ? 0 : undefined,
          height: isMobile ? "calc(100vh - 60px)" : "75vh",
        },
        content: {
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {orderedAttachments.length === 1 ? (
        <SlideContent
          attachment={orderedAttachments[0]}
          isMobile={isMobile}
          opened={opened}
        />
      ) : (
        <Carousel
          initialSlide={adjustedInitialIndex >= 0 ? adjustedInitialIndex : 0}
          withIndicators
          withControls
          controlSize={40}
          height="100%"
          nextControlIcon={<IconChevronRight size={24} />}
          previousControlIcon={<IconChevronLeft size={24} />}
          emblaOptions={{ loop: true }}
          styles={{
            root: { height: "100%" },
            viewport: { height: "100%" },
            container: { height: "100%" },
            slide: { height: "100%" },
            control: {
              backgroundColor: "var(--mantine-color-white)",
              border: "1px solid var(--mantine-color-gray-3)",
              boxShadow: "var(--mantine-shadow-sm)",
              "&[data-inactive]": {
                opacity: 0,
                cursor: "default",
              },
            },
            indicators: {
              bottom: 10,
            },
            indicator: {
              width: 10,
              height: 10,
              backgroundColor: "var(--mantine-color-gray-4)",
              "&[data-active]": {
                backgroundColor: "var(--mantine-color-blue-6)",
              },
            },
          }}
        >
          {orderedAttachments.map((attachment) => (
            <Carousel.Slide key={attachment.id}>
              <SlideContent
                attachment={attachment}
                isMobile={isMobile}
                opened={opened}
              />
            </Carousel.Slide>
          ))}
        </Carousel>
      )}
    </Modal>
  )
}

interface SlideContentProps {
  attachment: Attachment
  isMobile: boolean | undefined
  opened: boolean
}

function SlideContent({ attachment, isMobile, opened }: SlideContentProps) {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileType = getFileType(attachment.name)

  // Fetch content for text and PDF files
  useEffect(() => {
    if (!opened) {
      setTextContent(null)
      setError(null)
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl)
        setPdfBlobUrl(null)
      }
      return
    }

    if (fileType === "text") {
      setLoading(true)
      setError(null)

      fetch(attachment.file_url)
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

      fetch(attachment.file_url)
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
  }, [attachment.file_url, fileType, opened])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl)
      }
    }
  }, [pdfBlobUrl])

  const handleDownload = () => {
    window.open(attachment.file_url, "_blank")
  }

  // Image preview
  if (fileType === "image") {
    return (
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: isMobile ? 0 : "1rem",
        }}
      >
        <Image
          src={attachment.file_url}
          alt={attachment.name}
          fit="contain"
          style={{
            maxHeight: isMobile ? "calc(100vh - 140px)" : "65vh",
            maxWidth: "100%",
          }}
        />
        <Group justify="center" mt="md">
          <Button
            variant="light"
            size="sm"
            leftSection={<IconDownload size={16} />}
            onClick={handleDownload}
          >
            Download
          </Button>
        </Group>
      </Box>
    )
  }

  // PDF preview
  if (fileType === "pdf") {
    if (loading) {
      return (
        <Center h="100%">
          <Loader />
        </Center>
      )
    }
    if (error) {
      return (
        <Stack
          align="center"
          justify="center"
          gap="lg"
          style={{ height: "100%" }}
          p="xl"
        >
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
        <Center h="100%">
          <Loader />
        </Center>
      )
    }
    return (
      <Stack gap="md" style={{ height: "100%" }} p={isMobile ? "xs" : "md"}>
        <Box style={{ flex: 1, minHeight: 0 }}>
          <iframe
            src={pdfBlobUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              borderRadius: "8px",
            }}
            title={attachment.name}
          />
        </Box>
        <Group justify="center">
          <Button
            variant="light"
            size="sm"
            leftSection={<IconDownload size={16} />}
            onClick={handleDownload}
          >
            Download fil
          </Button>
        </Group>
      </Stack>
    )
  }

  // Text file preview
  if (fileType === "text") {
    if (loading) {
      return (
        <Center h="100%">
          <Loader />
        </Center>
      )
    }
    if (error) {
      return (
        <Center h="100%">
          <Text c="red">{error}</Text>
        </Center>
      )
    }
    return (
      <Stack gap="md" style={{ height: "100%" }} p={isMobile ? "xs" : "md"}>
        <ScrollArea style={{ flex: 1 }}>
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
            size="sm"
            leftSection={<IconDownload size={16} />}
            onClick={handleDownload}
          >
            Download fil
          </Button>
        </Group>
      </Stack>
    )
  }

  // Word document
  if (fileType === "word") {
    if (attachment.preview_html) {
      return (
        <Stack gap="md" style={{ height: "100%" }} p={isMobile ? "xs" : "md"}>
          <ScrollArea style={{ flex: 1 }}>
            <Box
              p="md"
              style={{
                backgroundColor: "var(--mantine-color-gray-0)",
                borderRadius: "var(--mantine-radius-md)",
              }}
              dangerouslySetInnerHTML={{ __html: attachment.preview_html }}
            />
          </ScrollArea>
          <Group justify="center">
            <Button
              variant="light"
              size="sm"
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
      <Stack
        align="center"
        justify="center"
        gap="lg"
        style={{ height: "100%" }}
        p="xl"
      >
        <IconFileTypeDoc size={80} color="var(--mantine-color-blue-6)" />
        <Text size="lg" fw={500} ta="center">
          {attachment.name}
        </Text>
        <Text c="dimmed" ta="center">
          Word-dokumenter kan ikke vises direkte i browseren.
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

  // PowerPoint presentation
  if (fileType === "powerpoint") {
    return (
      <Stack
        align="center"
        justify="center"
        gap="lg"
        style={{ height: "100%" }}
        p="xl"
      >
        <IconFileTypePpt size={80} color="var(--mantine-color-orange-6)" />
        <Text size="lg" fw={500} ta="center">
          {attachment.name}
        </Text>
        <Text c="dimmed" ta="center">
          PowerPoint-præsentationer kan ikke vises direkte i browseren.
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

  // Other/unknown file types
  const FileIcon = getFileIcon(attachment.name)
  const iconColor = getFileTypeColor(attachment.name)

  return (
    <Stack
      align="center"
      justify="center"
      gap="lg"
      style={{ height: "100%" }}
      p="xl"
    >
      <FileIcon size={80} color={`var(--mantine-color-${iconColor}-6)`} />
      <Text size="lg" fw={500} ta="center">
        {attachment.name}
      </Text>
      <Text c="dimmed" ta="center">
        Denne filtype kan ikke forhåndsvises.
        <br />
        Download filen for at åbne den.
      </Text>
      <Button leftSection={<IconDownload size={16} />} onClick={handleDownload}>
        Download fil
      </Button>
    </Stack>
  )
}
