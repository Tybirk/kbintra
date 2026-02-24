/**
 * Global search component using Mantine Spotlight.
 */

import { useCallback, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Spotlight, spotlight } from "@mantine/spotlight"
import { Center, Loader, rem, Text } from "@mantine/core"
import {
  IconSearch,
  IconUser,
  IconMessage,
  IconFolder,
  IconBell,
  IconCalendar,
  IconHome,
  IconMessages,
  IconCar,
} from "@tabler/icons-react"
import { useDebouncedValue } from "@mantine/hooks"
import { useQuery } from "@tanstack/react-query"

import { searchApi } from "../api/search"
import type { SearchItem, SearchResultType } from "../api/search"
import { FilePreviewModal, getFileIcon } from "./FilePreview"
import type { ForumFile } from "../types"

const TYPE_ICONS: Record<Exclude<SearchResultType, "file">, typeof IconSearch> =
  {
    user: IconUser,
    thread: IconMessages,
    post: IconMessage,
    subgroup: IconFolder,
    announcement: IconBell,
    event: IconCalendar,
    house: IconHome,
    car: IconCar,
  }

const TYPE_LABELS: Record<SearchResultType, string> = {
  user: "Bruger",
  thread: "Tråd",
  post: "Indlæg",
  subgroup: "Forum",
  announcement: "Opslag",
  event: "Begivenhed",
  house: "Hus",
  car: "Bil",
  file: "Fil",
}

// Maps backend plural result keys to singular type keys
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
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery] = useDebouncedValue(query, 300)
  const [previewFile, setPreviewFile] = useState<ForumFile | null>(null)

  const isHouseNumber =
    /^\d+$/.test(debouncedQuery) &&
    Number(debouncedQuery) >= 1 &&
    Number(debouncedQuery) <= 62
  const queryActive = debouncedQuery.length >= 2 || isHouseNumber

  const { data, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchApi.search(debouncedQuery, 5),
    enabled: queryActive,
    staleTime: 1000 * 60, // 1 minute
  })

  const handleAction = useCallback(
    (item: SearchItem) => {
      if (item.type === "file" && item.extra?.file_url) {
        // For files, open the preview modal
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
        })
        spotlight.close()
      } else {
        navigate(item.url)
        spotlight.close()
      }
    },
    [navigate],
  )

  // Build group priority from backend ordering
  const groupLabelPriority: Record<string, number> = {}
  if (data?.group_order) {
    data.group_order.forEach((key, idx) => {
      const type = RESULT_KEY_TO_TYPE[key]
      if (type) groupLabelPriority[TYPE_LABELS[type]] = idx
    })
  }

  // Flatten results into actions grouped by type
  const actions = data
    ? Object.entries(data.results)
        .flatMap(([, items]) =>
          (items as SearchItem[]).map((item) => {
            // Use getFileIcon for files to show proper file type icons
            const Icon =
              item.type === "file"
                ? getFileIcon(item.title)
                : TYPE_ICONS[item.type]
            return {
              id: `${item.type}-${item.id}`,
              label: item.title,
              description: item.subtitle,
              onClick: () => handleAction(item),
              leftSection: (
                <Icon
                  size={18}
                  style={{ color: "var(--mantine-color-dimmed)" }}
                />
              ),
              group: TYPE_LABELS[item.type],
            }
          }),
        )
        .sort((a, b) => {
          // Sort by backend-defined group priority (not alphabetical)
          const pa = groupLabelPriority[a.group] ?? 999
          const pb = groupLabelPriority[b.group] ?? 999
          return pa - pb
        })
    : []

  const nothingFoundContent = queryActive ? (
    isLoading ? (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    ) : (
      <Text c="dimmed" ta="center" py="xl">
        Ingen resultater fundet
      </Text>
    )
  ) : (
    <Text c="dimmed" ta="center" py="xl">
      Skriv mindst 2 tegn for at søge (eller et husnummer)
    </Text>
  )

  return (
    <>
      <Spotlight
        actions={actions}
        nothingFound={nothingFoundContent}
        highlightQuery
        searchProps={{
          leftSection: <IconSearch size={18} style={{ marginRight: rem(8) }} />,
          placeholder: "Søg i KB Intra...",
          ref: searchRef,
        }}
        query={query}
        onQueryChange={setQuery}
        onSpotlightOpen={() => setTimeout(() => searchRef.current?.focus(), 50)}
        shortcut={["mod + K"]}
        scrollable
        maxHeight={400}
      />
      <FilePreviewModal
        file={previewFile}
        opened={previewFile !== null}
        onClose={() => setPreviewFile(null)}
      />
    </>
  )
}

// Export spotlight controls for use in header
export { spotlight }
