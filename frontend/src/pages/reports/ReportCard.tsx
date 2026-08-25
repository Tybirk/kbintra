import { Card, Group, Stack, Text } from "@mantine/core"

import { IconMessageCircle2 } from "@tabler/icons-react"

import dayjs from "dayjs"

import { Link } from "react-router-dom"

import {
  CaseNumber,
  KindBadge,
  LocationLine,
  PhotoStrip,
  StatusBadge,
} from "./shared"

import type { Report } from "../../types"

interface ReportCardProps {
  report: Report
  /** Show which udvalg it belongs to — off inside a single udvalg's own queue. */
  showSubgroup?: boolean
}

export function ReportCard({ report, showSubgroup = false }: ReportCardProps) {
  return (
    <Card
      component={Link}
      to={report.url}
      withBorder
      padding="md"
      radius="md"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Stack gap="xs">
        <Group gap="xs" wrap="wrap">
          <CaseNumber number={report.number} />
          <KindBadge kind={report.kind} />
          <StatusBadge status={report.status} />
        </Group>

        <Text size="sm" lineClamp={4}>
          {report.description}
        </Text>

        <LocationLine location={report.location} />

        {report.photos.length > 0 && <PhotoStrip photos={report.photos} />}

        <Group gap="xs" justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">
            {report.reporter_name}
            {showSubgroup ? ` · ${report.subgroup.name}` : ""}
          </Text>
          <Group gap="xs">
            {report.comment_count > 0 && (
              <Group gap={3} c="dimmed">
                <IconMessageCircle2 size={14} />
                <Text size="xs">{report.comment_count}</Text>
              </Group>
            )}
            <Text size="xs" c="dimmed">
              {dayjs(report.created_at).format("D. MMM YYYY")}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  )
}
