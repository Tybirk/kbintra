import { useState, useEffect, useRef, useMemo } from "react"

import { Link } from "react-router-dom"

import { useInfiniteQuery } from "@tanstack/react-query"

import {
  Stack,
  SimpleGrid,
  Box,
  Text,
  Anchor,
  Alert,
  Center,
  Loader,
  Paper,
  ThemeIcon,
  Tooltip,
} from "@mantine/core"

import { IconInfoCircle, IconPhoto, IconEyeOff } from "@tabler/icons-react"

import { forumApi } from "../api/forum"

import { AttachmentCarousel } from "./AttachmentCarousel"

import { BlurredThumbnail } from "./BlurredThumbnail"

import { getFileType, getFileIcon, getFileTypeColor } from "./FilePreview"

import type { GalleryItem } from "../types"

const PAGE_SIZE = 60

interface GalleryTabProps {
  subgroupSlug: string
}

export default function GalleryTab({ subgroupSlug }: GalleryTabProps) {
  const {
    data,
    isLoading,
    isError,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["subgroup-gallery", subgroupSlug],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      forumApi.getSubgroupGallery(subgroupSlug, {
        page: pageParam as number,
        pageSize: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.next ? allPages.length + 1 : undefined,
  })

  const items: GalleryItem[] = useMemo(
    () => data?.pages.flatMap((page) => page.results) ?? [],
    [data],
  )

  // Infinite scroll: load more when sentinel enters view.
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage()
        }
      },
      { rootMargin: "400px" },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Carousel state: which image to open, drawn from the gallery item list.
  const [carouselOpen, setCarouselOpen] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)

  const imageItems = useMemo(
    () => items.filter((item) => getFileType(item.name) === "image"),
    [items],
  )

  const handleImageClick = (item: GalleryItem) => {
    const idx = imageItems.findIndex((i) => i.id === item.id)
    setCarouselIndex(idx >= 0 ? idx : 0)
    setCarouselOpen(true)
  }

  const handleDocClick = (item: GalleryItem) => {
    window.open(item.file_url, "_blank", "noopener,noreferrer")
  }

  const carouselAttachments = useMemo(
    () =>
      imageItems.map((item) => ({
        id: item.id,
        name: item.name,
        file_url: item.file_url,
        preview_html: item.preview_html,
        thread_subgroup_slug: item.subgroup_slug,
        thread_slug: item.thread_slug,
        thread_title: item.thread_title,
        post_id: item.post_id,
      })),
    [imageItems],
  )

  return (
    <Stack gap="md">
      <Alert
        icon={<IconInfoCircle size={16} />}
        color="gray"
        variant="light"
        radius="md"
      >
        Vil du tilføje medie til galleriet? Vedhæft filer, billeder eller
        dokumenter i en tråd — de dukker automatisk op her.
      </Alert>

      {isLoading && (
        <Center h={120}>
          <Loader />
        </Center>
      )}

      {isError && (
        <Text c="red">Kunne ikke indlæse galleriet. Prøv igen senere.</Text>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <Paper withBorder p="xl" radius="md">
          <Stack align="center" gap="xs">
            <IconPhoto size={32} color="var(--mantine-color-gray-5)" />
            <Text c="dimmed">Ingen medier endnu.</Text>
            <Text c="dimmed" size="sm" ta="center">
              Vedhæft et billede eller en fil i en tråd for at få det vist her.
            </Text>
          </Stack>
        </Paper>
      )}

      {items.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
          {items.map((item) => (
            <GalleryTile
              key={item.id}
              item={item}
              onOpenImage={handleImageClick}
              onOpenDoc={handleDocClick}
            />
          ))}
        </SimpleGrid>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {isFetchingNextPage && (
        <Center>
          <Loader size="sm" />
        </Center>
      )}

      <AttachmentCarousel
        attachments={carouselAttachments}
        opened={carouselOpen}
        onClose={() => setCarouselOpen(false)}
        initialIndex={carouselIndex}
      />
    </Stack>
  )
}

interface GalleryTileProps {
  item: GalleryItem

  onOpenImage: (item: GalleryItem) => void

  onOpenDoc: (item: GalleryItem) => void
}

function GalleryTile({ item, onOpenImage, onOpenDoc }: GalleryTileProps) {
  const fileType = getFileType(item.name)
  const isImage = fileType === "image"

  const FileIcon = getFileIcon(item.name)
  const iconColor = getFileTypeColor(item.name)

  const isPrivate = item.thread_members_only

  return (
    <Stack gap={4} style={{ position: "relative" }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={() => (isImage ? onOpenImage(item) : onOpenDoc(item))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            isImage ? onOpenImage(item) : onOpenDoc(item)
          }
        }}
        style={{
          aspectRatio: "1",
          width: "100%",
          overflow: "hidden",
          borderRadius: "var(--mantine-radius-sm)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: isImage
            ? undefined
            : "1px solid var(--mantine-color-default-border)",
        }}
      >
        {isImage ? (
          <BlurredThumbnail
            src={item.thumbnail_url}
            alt={item.name}
            radius="sm"
          />
        ) : (
          <Stack align="center" gap={4} p="xs">
            <ThemeIcon variant="light" color={iconColor} size="xl" radius="md">
              <FileIcon size={28} />
            </ThemeIcon>
            <Text
              size="xs"
              ta="center"
              lineClamp={2}
              style={{ wordBreak: "break-word" }}
            >
              {item.name}
            </Text>
          </Stack>
        )}
      </Box>

      {isPrivate && (
        <Tooltip label="Kun for medlemmer">
          <Box
            style={{
              position: "absolute",
              top: -8,
              left: -8,
              width: 22,
              height: 22,
              borderRadius: "50%",
              backgroundColor: "var(--mantine-color-grape-8)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <IconEyeOff size={14} />
          </Box>
        </Tooltip>
      )}

      <Anchor
        component={Link}
        to={`/forum/${item.subgroup_slug}/traad/${item.thread_slug}#post-${item.post_id}`}
        size="xs"
        c="dimmed"
        title={item.thread_title}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.thread_title}
      </Anchor>
    </Stack>
  )
}
