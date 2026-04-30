import { Modal, ActionIcon, Box } from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import { IconX, IconDownload } from "@tabler/icons-react"
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"

interface ImageZoomViewerProps {
  src: string
  alt?: string
  opened: boolean
  onClose: () => void
}

export function ImageZoomViewer({
  src,
  alt,
  opened,
  onClose,
}: ImageZoomViewerProps) {
  const isMobile = useMediaQuery("(max-width: 768px)")

  const handleDownload = () => {
    fetch(src)
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = blobUrl
        a.download = alt || "image"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
      })
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      transitionProps={{ transition: "fade", duration: 150 }}
      styles={{
        body: { padding: 0, height: "100vh" },
        content: { backgroundColor: "rgba(0,0,0,0.92)" },
      }}
    >
      <Box
        style={{
          position: "relative",
          width: "100%",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <TransformWrapper
          initialScale={1}
          minScale={1}
          maxScale={6}
          centerOnInit
          doubleClick={{ mode: "toggle", step: 2 }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
          panning={{ velocityDisabled: true }}
        >
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={src}
              alt={alt || ""}
              style={{
                maxWidth: "100vw",
                maxHeight: "100vh",
                objectFit: "contain",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }}
              draggable={false}
            />
          </TransformComponent>
        </TransformWrapper>

        <ActionIcon
          variant="filled"
          color="dark"
          radius="xl"
          size="lg"
          onClick={onClose}
          style={{
            position: "absolute",
            top: isMobile ? "max(env(safe-area-inset-top), 12px)" : 16,
            right: 16,
            zIndex: 10,
            opacity: 0.85,
          }}
          aria-label="Luk"
        >
          <IconX size={20} />
        </ActionIcon>

        <ActionIcon
          variant="filled"
          color="dark"
          radius="xl"
          size="lg"
          onClick={handleDownload}
          style={{
            position: "absolute",
            top: isMobile ? "max(env(safe-area-inset-top), 12px)" : 16,
            right: 64,
            zIndex: 10,
            opacity: 0.85,
          }}
          aria-label="Download"
        >
          <IconDownload size={20} />
        </ActionIcon>
      </Box>
    </Modal>
  )
}
