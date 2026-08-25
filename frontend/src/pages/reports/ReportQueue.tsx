import { useState } from "react"

import {
  Badge,
  Button,
  Center,
  Chip,
  Group,
  Loader,
  Pagination,
  Stack,
  Text,
  TextInput,
} from "@mantine/core"

import { useDebouncedValue } from "@mantine/hooks"

import { IconDownload, IconPlus, IconSearch } from "@tabler/icons-react"

import { useQuery } from "@tanstack/react-query"

import { reportsApi } from "../../api/reports"

import { ReportCard } from "./ReportCard"

import { ReportForm } from "./ReportForm"

import { KIND_META, KIND_ORDER, STATUS_META, STATUS_ORDER } from "./shared"

import type { ReportFilters } from "../../api/reports"

import type { ReportKind, ReportStatus } from "../../types"

interface ReportQueueProps {
  /** Restrict to one udvalg (the subgroup tab); omitted on the main page. */
  subgroupSlug?: string
  /** Whether the current user may export this udvalg's queue. */
  canExport?: boolean
}

type StatusFilter = ReportStatus | "open" | "all"

export function ReportQueue({ subgroupSlug, canExport }: ReportQueueProps) {
  // Default to "open": the reason to look at this list is nearly always the
  // things nobody has dealt with yet. Closed cases stay one tap away.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open")
  const [kindFilter, setKindFilter] = useState<ReportKind | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)

  const filters: ReportFilters = {
    subgroup: subgroupSlug,
    status: statusFilter === "all" ? undefined : statusFilter,
    kind: kindFilter ?? undefined,
    q: debouncedSearch || undefined,
    page,
  }

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "list", filters],
    queryFn: () => reportsApi.list(filters),
  })

  function changeStatus(value: StatusFilter) {
    setStatusFilter(value)
    setPage(1)
  }

  function changeKind(value: ReportKind | null) {
    setKindFilter(value)
    setPage(1)
  }

  const reports = data?.results ?? []

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setFormOpen(true)}
        >
          Ny indrapportering
        </Button>
        {canExport && subgroupSlug && (
          <Button
            variant="subtle"
            size="sm"
            leftSection={<IconDownload size={16} />}
            onClick={() => reportsApi.exportCsv(subgroupSlug)}
          >
            Hent som regneark
          </Button>
        )}
      </Group>

      <TextInput
        placeholder="Søg i beskrivelse, sted eller navn"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value)
          setPage(1)
        }}
      />

      <Chip.Group
        multiple={false}
        value={statusFilter}
        onChange={(value) => changeStatus(value as StatusFilter || "open")}
      >
        <Group gap={6}>
          <Chip value="open" size="sm">
            Åbne
          </Chip>
          {STATUS_ORDER.map((status) => (
            <Chip
              key={status}
              value={status}
              size="sm"
              color={STATUS_META[status].color}
            >
              {STATUS_META[status].label}
            </Chip>
          ))}
          <Chip value="all" size="sm">
            Alle
          </Chip>
        </Group>
      </Chip.Group>

      <Chip.Group
        multiple={false}
        value={kindFilter ?? ""}
        onChange={(value) => changeKind(value as ReportKind || null)}
      >
        <Group gap={6}>
          {KIND_ORDER.map((kind) => (
            <Chip
              key={kind}
              value={kind}
              size="sm"
              color={KIND_META[kind].color}
            >
              {KIND_META[kind].short}
            </Chip>
          ))}
        </Group>
      </Chip.Group>

      {data && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {data.count} {data.count === 1 ? "sag" : "sager"}
          </Text>
          {data.open_count > 0 && (
            <Badge size="sm" variant="light" color="blue">
              {data.open_count} åbne
            </Badge>
          )}
        </Group>
      )}

      {isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : reports.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">
          Ingen sager matcher.
        </Text>
      ) : (
        <Stack gap="sm">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              showSubgroup={!subgroupSlug}
            />
          ))}
        </Stack>
      )}

      {data && data.num_pages > 1 && (
        <Center>
          <Pagination
            total={data.num_pages}
            value={data.page}
            onChange={setPage}
          />
        </Center>
      )}

      <ReportForm
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        subgroupSlug={subgroupSlug}
      />
    </Stack>
  )
}
