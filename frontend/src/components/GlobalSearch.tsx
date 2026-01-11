/**
 * Global search component using Mantine Spotlight.
 */

import { useCallback, useState } from "react"
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
} from "@tabler/icons-react"
import { useDebouncedValue } from "@mantine/hooks"
import { useQuery } from "@tanstack/react-query"

import { searchApi } from "../api/search"
import type { SearchItem, SearchResultType } from "../api/search"
import { FilePreviewModal, getFileIcon } from "./FilePreview"
import type { ForumFile } from "../types"

const TYPE_ICONS: Record<Exclude<SearchResultType, "file">, typeof IconSearch> = {
  user: IconUser,
  thread: IconMessages,
  post: IconMessage,
  subgroup: IconFolder,
  announcement: IconBell,
  event: IconCalendar,
  house: IconHome,
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  user: "Bruger",
  thread: "Tråd",
  post: "Indlæg",
  subgroup: "Forum",
  announcement: "Opslag",
  event: "Begivenhed",
  house: "Hus",
  file: "Fil",
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [debouncedQuery] = useDebouncedValue(query, 300)
  const [previewFile, setPreviewFile] = useState<ForumFile | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchApi.search(debouncedQuery, 5),
    enabled: debouncedQuery.length >= 2,
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
          uploaded_by: { id: 0, first_name: "", last_name: "", profile_picture: null },
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

  // Flatten results into actions grouped by type
  const actions = data
    ? Object.entries(data.results)
        .flatMap(([, items]) =>
          (items as SearchItem[]).map((item) => {
            // Use getFileIcon for files to show proper file type icons
            const Icon =
              item.type === "file" ? getFileIcon(item.title) : TYPE_ICONS[item.type]
            return {
              id: `${item.type}-${item.id}`,
              label: item.title,
              description: item.subtitle,
              onClick: () => handleAction(item),
              leftSection: <Icon size={18} style={{ color: "var(--mantine-color-dimmed)" }} />,
              group: TYPE_LABELS[item.type],
            }
          }),
        )
        .sort((a, b) => {
          // Sort by group for better visual grouping
          if (a.group < b.group) return -1
          if (a.group > b.group) return 1
          return 0
        })
    : []

  const nothingFoundContent =
    debouncedQuery.length >= 2 ? (
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
        Skriv mindst 2 tegn for at søge
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
        }}
        query={query}
        onQueryChange={setQuery}
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
