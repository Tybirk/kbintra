import { useState, useEffect, memo } from "react"

import { Badge, ActionIcon, Image } from "@mantine/core"

import { IconX } from "@tabler/icons-react"

import { getFileIcon, getFileType, getFileTypeColor } from "./FilePreview"

interface AttachmentBadgeProps {
  file: File

  onRemove: () => void
}

/**
 * Memoized attachment badge that properly manages blob URLs for image previews.
 * This prevents creating new blob URLs on every render, which causes lag on mobile.
 */

export const AttachmentBadge = memo(function AttachmentBadge({
  file,

  onRemove,
}: AttachmentBadgeProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const FileIcon = getFileIcon(file.name)

  const fileColor = getFileTypeColor(file.name)

  // Native File, not a server attachment: the preview is a local blob, and
  // Safari renders a freshly picked HEIC fine. Name-based typing is right here.
  const isImage = getFileType(file.name) === "image"

  // Create blob URL once when component mounts (for images only)

  useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(file)

      setImageUrl(url)

      // Cleanup: revoke the blob URL when component unmounts or file changes

      return () => {
        URL.revokeObjectURL(url)
      }
    }
  }, [file, isImage])

  return (
    <Badge
      variant="light"
      color={fileColor}
      size="lg"
      leftSection={
        isImage && imageUrl ? (
          <Image
            src={imageUrl}
            alt={file.name}
            w={16}
            h={16}
            fit="cover"
            radius={2}
          />
        ) : (
          <FileIcon size={14} />
        )
      }
      rightSection={
        <ActionIcon
          size="xs"
          variant="transparent"
          color={fileColor}
          onClick={onRemove}
        >
          <IconX size={12} />
        </ActionIcon>
      }
      style={{ paddingRight: 4 }}
    >
      {file.name.length > 20 ? `${file.name.slice(0, 17)}...` : file.name}
    </Badge>
  )
})
