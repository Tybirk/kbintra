import {
  useState,
  useRef,
  type ReactNode,
  type DragEvent,
  type ChangeEvent,
  type CSSProperties,
} from "react"

import { Box, Group, Text } from "@mantine/core"

import { IconUpload } from "@tabler/icons-react"

function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false)

  const dragCounter = useRef(0)

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    dragCounter.current++

    if (e.dataTransfer.types.includes("Files")) setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    if (--dragCounter.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()

    e.stopPropagation()
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()

    e.stopPropagation()

    dragCounter.current = 0

    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)

    if (files.length > 0) onDrop(files)
  }

  const handleDropCapture = () => {
    dragCounter.current = 0

    setIsDragging(false)
  }

  return {
    isDragging,

    handleDragEnter,

    handleDragLeave,

    handleDragOver,

    handleDrop,

    handleDropCapture,
  }
}

interface FileDropzoneProps {
  onDrop: (files: File[]) => void

  children: ReactNode

  label?: string

  style?: CSSProperties
}

export default function FileDropzone({
  onDrop,

  children,

  label,

  style,
}: FileDropzoneProps) {
  const {
    isDragging,

    handleDragEnter,

    handleDragLeave,

    handleDragOver,

    handleDrop,

    handleDropCapture,
  } = useDragDrop(onDrop)

  return (
    <Box
      pos="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDropCapture={handleDropCapture}
      style={style}
    >
      {children}
      {isDragging && (
        <Box
          pos="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          style={{
            border: "2px dashed var(--mantine-color-blue-5)",

            borderRadius: "var(--mantine-radius-md)",

            backgroundColor: "rgba(34, 139, 230, 0.06)",

            display: "flex",

            alignItems: "center",

            justifyContent: "center",

            zIndex: 10,

            pointerEvents: "none",
          }}
        >
          <Text size="sm" fw={500} c="blue">
            {label ?? "Slip filer her for at vedhæfte"}
          </Text>
        </Box>
      )}
    </Box>
  )
}

interface AttachmentAreaProps {
  onAddFiles: (files: File[]) => void

  children?: ReactNode
}

export function AttachmentArea({ onAddFiles, children }: AttachmentAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasChildren = !!children

  const {
    isDragging,

    handleDragEnter,

    handleDragLeave,

    handleDragOver,

    handleDrop,
  } = useDragDrop(onAddFiles)

  const handleClick = () => fileInputRef.current?.click()

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      onAddFiles(Array.from(e.target.files))

      e.target.value = ""
    }
  }

  return (
    <Box
      pos="relative"
      onClick={handleClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      py="sm"
      px="md"
      style={{
        border: isDragging
          ? "2px dashed var(--mantine-color-blue-5)"
          : "1px dashed var(--mantine-color-gray-4)",

        borderRadius: "var(--mantine-radius-sm)",

        backgroundColor: isDragging ? "rgba(34, 139, 230, 0.06)" : undefined,

        cursor: "pointer",

        transition: "border-color 0.15s, background-color 0.15s",
      }}
    >
      <input
        type="file"
        multiple
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleChange}
      />
      {hasChildren ? (
        <>
          {/* Stop propagation so clicking badges doesn't open the file picker */}
          <div onClick={(e) => e.stopPropagation()}>{children}</div>
          <Text size="xs" c="dimmed" ta="center" mt="xs">
            Klik eller træk for at tilføje flere filer
          </Text>
        </>
      ) : (
        <Group gap="xs" justify="center">
          <IconUpload size={14} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c="dimmed">
            Træk filer hertil, indsæt med Ctrl+V, eller klik for at vælge
          </Text>
        </Group>
      )}
    </Box>
  )
}
