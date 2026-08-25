import { useCallback, useEffect, useMemo, useState } from "react"

import { useNavigate, useSearchParams } from "react-router-dom"

import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Chip,
  Container,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core"

import { useDebouncedValue } from "@mantine/hooks"

import { useQuery } from "@tanstack/react-query"

import dayjs from "dayjs"

import {
  IconArrowRight,
  IconBell,
  IconCalendar,
  IconCar,
  IconFolder,
  IconHome,
  IconMessage,
  IconMessages,
  IconSearch,
  IconTool,
  IconUser,
  IconX,
} from "@tabler/icons-react"

import { searchApi } from "../api/search"

import type {
  SearchFuzziness,
  SearchItem,
  SearchResultType,
  SearchSort,
} from "../api/search"

import { FilePreviewModal, getFileIcon } from "../components/FilePreview"

import type { ForumFile } from "../types"

interface TypeOption {
  value: SearchResultType
  label: string
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: "thread", label: "Tråde" },
  { value: "post", label: "Indlæg" },
  { value: "announcement", label: "Opslag" },
  { value: "event", label: "Begivenheder" },
  { value: "report", label: "Indrapporteringer" },
  { value: "file", label: "Filer" },
  { value: "folder", label: "Mapper" },
  { value: "subgroup", label: "Forummer" },
  { value: "user", label: "Beboere" },
  { value: "house", label: "Huse" },
  { value: "car", label: "Biler" },
]

const TYPE_LABELS: Record<SearchResultType, string> = {
  user: "Beboere",
  thread: "Tråde",
  post: "Indlæg",
  subgroup: "Forummer",
  announcement: "Opslag",
  event: "Begivenheder",
  house: "Huse",
  car: "Biler",
  file: "Filer",
  folder: "Mapper",
  report: "Indrapporteringer",
}

const TYPE_ICONS: Record<Exclude<SearchResultType, "file" | "folder">, typeof IconSearch> =
  {
    user: IconUser,
    thread: IconMessages,
    post: IconMessage,
    subgroup: IconFolder,
    announcement: IconBell,
    event: IconCalendar,
    house: IconHome,
    car: IconCar,
    report: IconTool,
  }

// Backend plural keys -> singular type
const RESULT_KEY_TO_TYPE: Record<string, SearchResultType> = {
  users: "user",
  threads: "thread",
  posts: "post",
  subgroups: "subgroup",
  announcements: "announcement",
  events: "event",
  houses: "house",
  cars: "car",
  files: "file",
  folders: "folder",
  reports: "report",
}

interface FuzzinessOption {
  value: SearchFuzziness
  label: string
  description: string
}

const FUZZINESS_OPTIONS: FuzzinessOption[] = [
  {
    value: "exact",
    label: "Eksakt",
    description: "Kun helt præcise ordmatches",
  },
  {
    value: "prefix",
    label: "Prefiks",
    description: "Matcher ord der starter med søgningen",
  },
  {
    value: "fuzzy",
    label: "Fuzzy",
    description: "Tolerer stavefejl i navne",
  },
]

interface SortOption {
  value: SearchSort
  label: string
}

const SORT_OPTIONS: SortOption[] = [
  { value: "relevance", label: "Relevans" },
  { value: "newest", label: "Nyeste" },
]

const LIMIT_OPTIONS = ["10", "20", "50", "100"]

const DEFAULT_TYPES: SearchResultType[] = TYPE_OPTIONS.map((o) => o.value)

function getIconFor(item: SearchItem) {
  if (item.type === "file") return getFileIcon(item.title)
  if (item.type === "folder") return IconFolder
  return TYPE_ICONS[item.type] ?? IconSearch
}

// Event rows show the event start date; everything else shows created_at.
function getItemDateIso(item: SearchItem): string | null {
  if (item.type === "event") {
    const ed = item.extra?.event_date
    return typeof ed === "string" && ed ? ed : null
  }
  return item.created_at && item.created_at.length > 0 ? item.created_at : null
}

function formatShortDanish(iso: string): string {
  const d = dayjs(iso)
  return d.isValid() ? d.format("D/M YYYY") : ""
}

export default function AdvancedSearchPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // Local form state initialised from URL params so links remain shareable.
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [types, setTypes] = useState<SearchResultType[]>(() => {
    const raw = params.get("types")
    if (!raw) return DEFAULT_TYPES
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter((t): t is SearchResultType => t in TYPE_LABELS)
    return parsed.length > 0 ? parsed : DEFAULT_TYPES
  })
  const [fuzziness, setFuzziness] = useState<SearchFuzziness>(
    params.get("fuzziness") as SearchFuzziness || "fuzzy",
  )
  const [sort, setSort] = useState<SearchSort>(
    params.get("sort") as SearchSort || "relevance",
  )
  const [limit, setLimit] = useState<string>(params.get("limit") || "20")
  const [previewFile, setPreviewFile] = useState<ForumFile | null>(null)

  const [debouncedQuery] = useDebouncedValue(query, 300)

  // Sync state -> URL so users can copy/share. Replaces history entry so the
  // back button still returns to the page they came from.
  useEffect(() => {
    const next = new URLSearchParams()
    if (debouncedQuery) next.set("q", debouncedQuery)
    if (types.length > 0 && types.length !== DEFAULT_TYPES.length) {
      next.set("types", types.join(","))
    }
    if (fuzziness !== "fuzzy") next.set("fuzziness", fuzziness)
    if (sort !== "relevance") next.set("sort", sort)
    if (limit !== "20") next.set("limit", limit)
    setParams(next, { replace: true })
  }, [debouncedQuery, types, fuzziness, sort, limit, setParams])

  const queryActive = debouncedQuery.trim().length >= 2

  const numericLimit = useMemo(() => {
    const n = Number(limit)
    return Number.isFinite(n) && n > 0 ? n : 20
  }, [limit])

  const { data, isFetching, isError } = useQuery({
    queryKey: [
      "search-advanced",
      debouncedQuery,
      types.join(","),
      fuzziness,
      sort,
      numericLimit,
    ],
    queryFn: () =>
      searchApi.advanced({
        query: debouncedQuery,
        types,
        fuzziness,
        sort,
        limit: numericLimit,
      }),
    enabled: queryActive,
    staleTime: 1000 * 30,
  })

  const handleResultClick = useCallback(
    (item: SearchItem) => {
      if (item.type === "file" && item.extra?.file_url) {
        setPreviewFile({
          id: item.id,
          name: item.title,
          file: item.extra.file_url as string,
          file_url: item.extra.file_url as string,
          uploaded_by: {
            id: 0,
            first_name: "",
            last_name: "",
            profile_picture: null,
          },
          is_own: false,
          uploaded_at: "",
          members_only: false,
        })
        return
      }
      navigate(item.url)
    },
    [navigate],
  )

  const selectAllTypes = () => setTypes(DEFAULT_TYPES)
  const clearTypes = () => setTypes([])

  // Ordered list of (groupKey, items) using backend group_order when present.
  const grouped = useMemo(() => {
    if (!data) return []
    const order = data.group_order ?? Object.keys(data.results)
    return order
      .map((key) => ({
        key,
        type: RESULT_KEY_TO_TYPE[key],
        items: (data.results[(key as keyof typeof data.results)] ??
          []) as SearchItem[],
      }))
      .filter((g) => g.type && g.items.length > 0)
  }, [data])

  return (
    <Container size="md" py="md" px={{ base: "xs", sm: "md" }}>
      <Stack gap="lg">
        <div>
          <Title order={2}>Avanceret søgning</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Søg på tværs af forum, opslag, kalender og filer med flere
            indstillinger.
          </Text>
        </div>

        <Paper withBorder p="md" radius="md">
          <Stack gap="md">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Søg..."
              size="md"
              leftSection={<IconSearch size={18} />}
              rightSection={
                query ? (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => setQuery("")}
                    aria-label="Ryd"
                  >
                    <IconX size={16} />
                  </ActionIcon>
                ) : null
              }
              autoFocus
            />

            <div>
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={500}>
                  Indholdstyper
                </Text>
                <Group gap="xs">
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={selectAllTypes}
                  >
                    Vælg alle
                  </Anchor>
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={clearTypes}
                  >
                    Ryd
                  </Anchor>
                </Group>
              </Group>
              <Chip.Group
                multiple
                value={types}
                onChange={(v) => setTypes(v as SearchResultType[])}
              >
                <Group gap="xs">
                  {TYPE_OPTIONS.map((opt) => (
                    <Chip
                      key={opt.value}
                      value={opt.value}
                      size="sm"
                      variant={types.includes(opt.value) ? "filled" : "light"}
                    >
                      {opt.label}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
            </div>

            <SimpleGrid
              cols={{ base: 1, sm: 2 }}
              spacing="md"
              verticalSpacing="md"
            >
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Matchtype
                </Text>
                <SegmentedControl
                  value={fuzziness}
                  onChange={(v) => setFuzziness(v as SearchFuzziness)}
                  data={FUZZINESS_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  fullWidth
                />
                <Text size="xs" c="dimmed" mt={4}>
                  {
                    FUZZINESS_OPTIONS.find((o) => o.value === fuzziness)
                      ?.description
                  }
                </Text>
              </Box>

              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Sortering
                </Text>
                <SegmentedControl
                  value={sort}
                  onChange={(v) => setSort(v as SearchSort)}
                  data={SORT_OPTIONS}
                  fullWidth
                />
              </Box>

              <Select
                label="Maks. resultater pr. type"
                value={limit}
                onChange={(v) => setLimit(v ?? "20")}
                data={LIMIT_OPTIONS}
                allowDeselect={false}
              />
            </SimpleGrid>
          </Stack>
        </Paper>

        {!queryActive && (
          <Paper withBorder p="lg" radius="md">
            <Text c="dimmed" ta="center">
              Skriv mindst 2 tegn for at søge
            </Text>
          </Paper>
        )}

        {queryActive && isFetching && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {queryActive && !isFetching && isError && (
          <Paper withBorder p="md" radius="md">
            <Text c="red">Kunne ikke hente resultater. Prøv igen.</Text>
          </Paper>
        )}

        {queryActive && !isFetching && data && grouped.length === 0 && (
          <Paper withBorder p="lg" radius="md">
            <Text c="dimmed" ta="center">
              Ingen resultater fundet
            </Text>
          </Paper>
        )}

        {queryActive && grouped.length > 0 && (
          <Stack gap="md">
            {grouped.map((group) => (
              <Paper key={group.key} withBorder p="md" radius="md">
                <Group justify="space-between" mb="xs">
                  <Title order={4}>
                    {group.type ? TYPE_LABELS[group.type] : group.key}
                  </Title>
                  <Badge variant="light">{group.items.length}</Badge>
                </Group>
                <Stack gap={4}>
                  {group.items.map((item) => {
                    const Icon = getIconFor(item)
                    const dateIso = getItemDateIso(item)
                    const dateText = dateIso ? formatShortDanish(dateIso) : ""
                    return (
                      <Box
                        key={`${item.type}-${item.id}`}
                        component="button"
                        type="button"
                        onClick={() => handleResultClick(item)}
                        style={{
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          padding: "8px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          width: "100%",
                        }}
                        className="advanced-search-result"
                      >
                        <Icon
                          size={18}
                          style={{
                            color: "var(--mantine-color-dimmed)",
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text fw={500} truncate>
                            {item.title}
                          </Text>
                          {item.subtitle && (
                            <Text size="xs" c="dimmed" truncate>
                              {item.subtitle}
                            </Text>
                          )}
                        </div>
                        {dateText && (
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {dateText}
                          </Text>
                        )}
                        <IconArrowRight
                          size={16}
                          style={{
                            color: "var(--mantine-color-dimmed)",
                            flexShrink: 0,
                          }}
                        />
                      </Box>
                    )
                  })}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

        <Group justify="center">
          <Button
            variant="subtle"
            onClick={() => navigate(-1)}
            aria-label="Tilbage"
          >
            Tilbage
          </Button>
        </Group>
      </Stack>

      <FilePreviewModal
        file={previewFile}
        opened={previewFile !== null}
        onClose={() => setPreviewFile(null)}
      />
    </Container>
  )
}
