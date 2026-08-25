import { useState } from "react"

import {
  Badge,
  Button,
  Center,
  Chip,
  Group,
  Loader,
  Pagination,
  Select,
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

interface StatusFilterOption {
  value: string
  label: string
}

const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: "open", label: "Åbne sager" },
  { value: "all", label: "Alle sager" },
  ...STATUS_ORDER.map((status) => ({
    value: status,
    label: STATUS_META[status].label,
  })),
]

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

      {/* One filter row, not two blocks of chips.
          Status was eleven 28px chips over two rows: 174px — a quarter of a
          375px phone — spent before the first case, and each target under-sized
          for a thumb. It is now a Select (as Udlæg filters), unlabelled because
          its own value reads as the label ("Åbne sager"), sharing a row with the
          three kind chips. Kind stays as chips: only three, and the fastest way
          to narrow a queue.
          Explicit toggles rather than a Chip.Group, so tapping the active chip
          clears it — as a single-select group it could not be cleared at all
          without reloading the page. */}
      <Group gap="xs" wrap="wrap">
        <Select
          data={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={(value) => changeStatus(value as StatusFilter || "open")}
          allowDeselect={false}
          size="sm"
          w={150}
          aria-label="Filtrér efter status"
        />
        {KIND_ORDER.map((kind) => (
          <Chip
            key={kind}
            size="md"
            color={KIND_META[kind].color}
            checked={kindFilter === kind}
            onClick={() => changeKind(kindFilter === kind ? null : kind)}
          >
            {KIND_META[kind].short}
          </Chip>
        ))}
      </Group>

      {data && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {data.count} {data.count === 1 ? "sag" : "sager"}
          </Text>
          {data.open_count > 0 && (
            <Badge size="sm" variant="light" color="blue">
              {data.open_count === 1 ? "1 åben" : `${data.open_count} åbne`}
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
