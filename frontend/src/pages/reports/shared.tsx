import { useState } from "react"

import { Badge, Box, Image, SimpleGrid, Text } from "@mantine/core"

import {
  IconAlertTriangle,
  IconBulb,
  IconMapPin,
  IconTool,
} from "@tabler/icons-react"

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
  /** The description prompt follows the type — a wish is not a breakage. */
  placeholder: string
}

export const KIND_META: Record<ReportKind, KindMeta> = {
  defect: {
    label: "Defekt inventar",
    short: "Defekt",
    color: "red",
    icon: IconTool,
    placeholder: "Hvad er ødelagt? Så mange detaljer som muligt.",
  },
  faulty: {
    label: "Fejlbehæftet inventar",
    short: "Fejlbehæftet",
    color: "orange",
    icon: IconAlertTriangle,
    placeholder: "Hvad virker ikke som det skal? Så mange detaljer som muligt.",
  },
  suggestion: {
    label: "Forslag til nyt inventar",
    short: "Forslag",
    color: "teal",
    icon: IconBulb,
    placeholder: "Hvad kunne vi ønske os — og hvad skal det bruges til?",
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

interface LocationLineProps {
  location: string
  size?: "xs" | "sm"
}

/**
 * "Hvor?" with its pin.
 *
 * The icon is inline inside the Text rather than a sibling flex child. As a
 * sibling, the address is one unbreakable flex item: the moment it no longer
 * fits beside the pin the whole string drops to the next line, leaving the pin
 * stranded on a line of its own — which reads as a broken image. Inline, the pin
 * is just the first glyph of the sentence and the text wraps under itself.
 */
export function LocationLine({ location, size = "xs" }: LocationLineProps) {
  if (!location) return null
  return (
    <Text size={size} c="dimmed">
      <IconMapPin
        size={14}
        style={{ verticalAlign: "-2px", marginRight: 4, flexShrink: 0 }}
      />
      {location}
    </Text>
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
