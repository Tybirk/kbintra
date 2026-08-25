import { useState } from "react"

import { Badge, Box, Image, SimpleGrid } from "@mantine/core"

import { IconAlertTriangle, IconBulb, IconTool } from "@tabler/icons-react"

import { ImageZoomViewer } from "../../components/ImageZoomViewer"

import type { ReportKind, ReportPhoto, ReportStatus } from "../../types"

interface StatusMeta {
  label: string
  color: string
}

/** Colours follow the old reporting app so the udvalg reads the queue the same way. */
export const STATUS_META: Record<ReportStatus, StatusMeta> = {
  new: { label: "Ny", color: "blue" },
  in_progress: { label: "I gang", color: "orange" },
  awaiting_meeting: { label: "Afventer udvalgsmøde", color: "grape" },
  awaiting_other: { label: "Afventer andet", color: "violet" },
  done: { label: "Afsluttet", color: "green" },
  rejected: { label: "Afvist", color: "red" },
}

export const STATUS_ORDER: ReportStatus[] = [
  "new",
  "in_progress",
  "awaiting_meeting",
  "awaiting_other",
  "done",
  "rejected",
]

interface KindMeta {
  label: string
  short: string
  color: string
  icon: typeof IconTool
}

export const KIND_META: Record<ReportKind, KindMeta> = {
  defect: {
    label: "Defekt inventar",
    short: "Defekt",
    color: "red",
    icon: IconTool,
  },
  faulty: {
    label: "Fejlbehæftet inventar",
    short: "Fejlbehæftet",
    color: "orange",
    icon: IconAlertTriangle,
  },
  suggestion: {
    label: "Forslag til nyt inventar",
    short: "Forslag",
    color: "teal",
    icon: IconBulb,
  },
}

export const KIND_ORDER: ReportKind[] = ["defect", "faulty", "suggestion"]

export function StatusBadge({ status }: { status: ReportStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge color={meta.color} variant="light" size="sm">
      {meta.label}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: ReportKind }) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return (
    <Badge
      color={meta.color}
      variant="light"
      size="sm"
      leftSection={<Icon size={12} />}
    >
      {meta.label}
    </Badge>
  )
}

export function CaseNumber({ number }: { number: number }) {
  return (
    <Badge variant="default" size="sm" radius="sm">
      #{number}
    </Badge>
  )
}

interface PhotoStripProps {
  photos: ReportPhoto[]
}

/**
 * Tappable photo thumbnails that open the shared zoom viewer.
 *
 * The column count is fixed per breakpoint rather than derived from how many
 * photos there are — same as the forum's inline attachments (ThreadPage). Sizing
 * the grid to the photo count instead stretches a lone picture across the whole
 * card, where `fit="cover"` crops a portrait photo of a broken door down to a
 * letterbox band of its middle.
 */
export function PhotoStrip({ photos }: PhotoStripProps) {
  const [zoomed, setZoomed] = useState<ReportPhoto | null>(null)

  if (photos.length === 0) return null

  return (
    <>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
        {photos.map((photo) => (
          <Box
            key={photo.id}
            onClick={(event) => {
              event.stopPropagation()
              setZoomed(photo)
            }}
            style={{ cursor: "zoom-in" }}
          >
            <Image
              src={photo.thumbnail_url}
              alt={photo.name}
              radius="md"
              h={120}
              fit="cover"
              loading="lazy"
            />
          </Box>
        ))}
      </SimpleGrid>
      {zoomed && (
        <ImageZoomViewer
          src={zoomed.image_url}
          alt={zoomed.name}
          opened
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  )
}
