/**
 * Global search component using Mantine Spotlight.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { Link, useNavigate } from "react-router-dom"

import { Spotlight, spotlight } from "@mantine/spotlight"
import type {
  SpotlightActionData,
  SpotlightActionGroupData,
} from "@mantine/spotlight"

type SpotlightActions = SpotlightActionData | SpotlightActionGroupData

import "@mantine/spotlight/styles.css"

import { ActionIcon, Center, Loader, rem, Text } from "@mantine/core"

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
  IconX,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react"

import { useDebouncedValue, useMediaQuery } from "@mantine/hooks"

import { useQuery } from "@tanstack/react-query"

import dayjs from "dayjs"

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

    folder: IconFolder,
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

  folder: "Mappe",
}

// Convert a flat list of actions (each with a `group` field) into Mantine's
// grouped shape so the spotlight renders group headers. Mirrors Mantine's
// internal `flatActionsToGroups` — we need our own because the custom `filter`
// prop replaces the default filter, which is where that grouping normally
// happens. Order is preserved: a group appears where its first member appears.
function groupActions(actions: SpotlightActionData[]): SpotlightActions[] {
  const groups: Record<string, SpotlightActionGroupData> = {}
  const result: SpotlightActions[] = []
  for (const action of actions) {
    if (action.group) {
      let group = groups[action.group]
      if (!group) {
        group = { group: action.group, actions: [] }
        groups[action.group] = group
        result.push(group)
      }
      group.actions.push(action)
    } else {
      result.push(action)
    }
  }
  return result
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

  folders: "folder",
}

// Module-level ref so AppHeader can focus the input after opening the spotlight

let _searchInputEl: HTMLInputElement | null = null

export function focusSpotlightSearch() {
  _searchInputEl?.focus()
}

interface GlobalSearchProps {
  onAction?: () => void
}

export function GlobalSearch({ onAction }: GlobalSearchProps) {
  const navigate = useNavigate()

  const isMobile = useMediaQuery("(max-width: 48em)")

  const [query, setQuery] = useState("")

  // Track whether we pushed a history entry so we can pop it on normal close

  const historyPushedRef = useRef(false)

  // Prevent the close handler from calling history.back() when back button triggered the close

  const closingFromHistoryRef = useRef(false)

  // Track whether the spotlight is currently open so popstate can decide
  // between reopening (returning to the pushed entry) and closing.

  const openRef = useRef(false)

  // Track visual viewport height so the actions list fits above the keyboard

  const [vpHeight, setVpHeight] = useState<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport

    if (!isMobile || !vv) return

    const update = () => setVpHeight(vv.height)

    update()

    vv.addEventListener("resize", update)

    return () => vv.removeEventListener("resize", update)
  }, [isMobile])

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // Returning (Back) onto the search history entry while the spotlight is
      // closed → reopen the search with the retained query.
      if (
        (e.state as { spotlight?: boolean } | null)?.spotlight &&
        !openRef.current
      ) {
        historyPushedRef.current = true

        spotlight.open()

        return
      }

      // Back pressed while the spotlight is open → close it (existing behaviour).
      if (historyPushedRef.current && openRef.current) {
        closingFromHistoryRef.current = true

        historyPushedRef.current = false

        spotlight.close()
      }
    }

    window.addEventListener("popstate", handlePopState)

    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

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
        // For files, open the preview modal. onSpotlightClose will call history.back()

        // to pop the spotlight entry, which is correct here.

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

        spotlight.close()
      } else {
        // Push the destination on top of the spotlight history entry so Back
        // returns to the search (which reopens via the popstate handler).

        historyPushedRef.current = false // prevents onSpotlightClose from popping the entry

        navigate(item.url)

        spotlight.close()
      }

      onAction?.()
    },

    [navigate, onAction],
  )

  // Build group priority from backend ordering

  const groupLabelPriority: Record<string, number> = {}

  if (data?.group_order) {
    data.group_order.forEach((key, idx) => {
      const type = RESULT_KEY_TO_TYPE[key]

      if (type) groupLabelPriority[TYPE_LABELS[type]] = idx
    })
  }

  const ADVANCED_GROUP_LABEL = "Mere"

  const advancedSearchTarget = debouncedQuery
    ? `/soeg?q=${encodeURIComponent(debouncedQuery)}`
    : "/soeg"

  // Synthetic action that takes the user to the full advanced-search page.
  // Rendered as a real <Link> so ctrl/cmd/middle-click opens in a new tab
  // exactly like normal anchors. The onClick still fires for the regular
  // SPA path so we can clear the history-stash flag and run onAction.
  // Styled distinctly from regular search hits (top border + accent icon +
  // tint) so users perceive it as a navigation CTA, not just another result.
  const advancedSearchAction = queryActive
    ? {
        id: "__advanced_search__",
        label: "Avanceret søgning",
        description: "Filtrer på type, fuzzy match og sortering",
        component: Link,
        to: advancedSearchTarget,
        onClick: () => {
          historyPushedRef.current = false
          onAction?.()
        },
        leftSection: (
          <IconAdjustmentsHorizontal
            size={18}
            style={{ color: "var(--mantine-primary-color-filled)" }}
          />
        ),
        group: ADVANCED_GROUP_LABEL,
        style: {
          borderTop: "1px solid var(--mantine-color-default-border)",
          marginTop: rem(6),
          background: "var(--mantine-color-default-hover)",
        },
      } as unknown as SpotlightActionData
    : null

  // Flatten results into actions grouped by type

  const resultActions = data
    ? Object.entries(data.results)

        .flatMap(([, items]) =>
          (items as SearchItem[]).map((item) => {
            // Use getFileIcon for files to show proper file type icons

            const Icon =
              item.type === "file"
                ? getFileIcon(item.title)
                : TYPE_ICONS[item.type]

            const dateIso = getItemDateIso(item)
            const dateText = dateIso ? formatShortDanish(dateIso) : ""

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

              rightSection: dateText ? (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {dateText}
                </Text>
              ) : undefined,

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

  const actions = advancedSearchAction
    ? [...resultActions, advancedSearchAction]
    : resultActions

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
        // Our backend already returns results that match the query, so the
        // default client-side substring filter just gets in the way — it would
        // hide hits whose title doesn't literally contain the query (e.g. a
        // snippet match in a post body) and would also strip the synthetic
        // "Avanceret søgning" row. We still need to convert the flat action
        // list into Mantine's grouped shape ourselves, because the default
        // filter is also what produces the group headers.
        filter={(_q, items) => groupActions(items as SpotlightActionData[])}
        nothingFound={nothingFoundContent}
        highlightQuery
        fullScreen={isMobile}
        onSpotlightOpen={() => {
          openRef.current = true

          // Only push a new ghost entry when one isn't already in place. When
          // reopening via Back (popstate), historyPushedRef is already set and
          // we are sitting on the existing spotlight entry — pushing again would
          // leave a stale entry behind.
          if (!historyPushedRef.current) {
            history.pushState({ spotlight: true }, "")

            historyPushedRef.current = true
          }
        }}
        onSpotlightClose={() => {
          openRef.current = false

          if (closingFromHistoryRef.current) {
            closingFromHistoryRef.current = false
          } else if (historyPushedRef.current) {
            historyPushedRef.current = false

            history.back()
          }
        }}
        searchProps={{
          leftSection: <IconSearch size={18} style={{ marginRight: rem(8) }} />,

          placeholder: "Søg i KB Intra...",

          rightSection: (
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={() => spotlight.close()}
              aria-label="Luk søgning"
            >
              <IconX size={16} />
            </ActionIcon>
          ),

          rightSectionPointerEvents: "all",

          ref: (el) => {
            _searchInputEl = el
          },
        }}
        query={query}
        onQueryChange={setQuery}
        transitionProps={{ duration: 0 }}
        shortcut={["mod + K"]}
        scrollable
        maxHeight={400}
        styles={
          isMobile && vpHeight
            ? { actionsList: { maxHeight: `${vpHeight - 64}px` } }
            : undefined
        }
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
