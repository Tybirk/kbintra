import { useEffect, useMemo, useState } from "react"

import { Link } from "react-router-dom"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Badge,
  Box,
  Center,
  Loader,
  Stack,
  Avatar,
  Anchor,
  Switch,
  Tree,
  useTree,
  getTreeExpandedState,
  Tooltip,
  Button,
  SegmentedControl,
} from "@mantine/core"
import type { RenderTreeNodePayload, TreeNodeData } from "@mantine/core"

import { useDisclosure } from "@mantine/hooks"

import {
  IconChevronRight,
  IconPlus,
  IconSitemap,
  IconUsers,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { forumApi } from "../api/forum"

import CreateSubgroupModal from "../components/CreateSubgroupModal"

import OrgChart from "../components/OrgChart"

import type { OrgNode } from "../types"

type ViewMode = "chart" | "tree"

const MAX_VISIBLE_AVATARS = 4

const DESCRIPTION_MAX_CHARS = 140

function stripHtml(html: string): string {
  if (!html) return ""
  const doc = new DOMParser().parseFromString(html, "text/html")
  return (doc.body.textContent ?? "").trim()
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trimEnd() + "…"
}

interface OrgTreeNodeData extends TreeNodeData {
  orgNode: OrgNode
}

function buildTreeData(nodes: OrgNode[]): OrgTreeNodeData[] {
  return nodes.map((node) => ({
    value: String(node.id),
    label: node.name,
    orgNode: node,
    children:
      node.children.length > 0 ? buildTreeData(node.children) : undefined,
  }))
}

function OrgNodeCard({ payload }: { payload: RenderTreeNodePayload }) {
  const node = (payload.node as OrgTreeNodeData).orgNode
  const plainDescription = stripHtml(node.description)

  return (
    <Paper withBorder radius="md" p="sm" mb="xs" style={{ width: "100%" }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="wrap">
            <Anchor
              component={Link}
              to={`/forum/${node.slug}`}
              fw={600}
              size="sm"
            >
              {node.name}
            </Anchor>
            {node.is_active === false && (
              <Badge color="gray" variant="light" size="sm">
                Afsluttet
              </Badge>
            )}
          </Group>

          {plainDescription && (
            <Text size="sm" c="dimmed" mt={2}>
              {truncate(plainDescription, DESCRIPTION_MAX_CHARS)}
            </Text>
          )}

          {(node.established_on || node.expires_on) && (
            <Group gap="md" mt={4}>
              {node.established_on && (
                <Text size="xs" c="dimmed">
                  Oprettet: {dayjs(node.established_on).format("D. MMM YYYY")}
                </Text>
              )}
              {node.expires_on && (
                <Text size="xs" c="dimmed">
                  Udløber: {dayjs(node.expires_on).format("D. MMM YYYY")}
                </Text>
              )}
            </Group>
          )}

          {node.member_count > 0 && (
            <Group gap="xs" mt={6}>
              <Avatar.Group>
                {node.members.slice(0, MAX_VISIBLE_AVATARS).map((m) => (
                  <Tooltip
                    key={m.id}
                    label={`${m.first_name} ${m.last_name}`}
                    withArrow
                    position="top"
                  >
                    <Avatar src={m.profile_picture} size="sm" radius="xl">
                      {m.first_name[0]}
                    </Avatar>
                  </Tooltip>
                ))}
                {node.member_count > MAX_VISIBLE_AVATARS && (
                  <Avatar size="sm" radius="xl">
                    +{node.member_count - MAX_VISIBLE_AVATARS}
                  </Avatar>
                )}
              </Avatar.Group>
              <Text size="xs" c="dimmed">
                <IconUsers
                  size={12}
                  style={{ verticalAlign: "middle", marginRight: 2 }}
                />
                {node.member_count} medlem
                {node.member_count !== 1 ? "mer" : ""}
              </Text>
            </Group>
          )}
        </Box>

        {payload.hasChildren && (
          <IconChevronRight
            size={18}
            style={{
              flexShrink: 0,
              marginTop: 4,
              transform: payload.expanded ? "rotate(90deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
        )}
      </Group>
    </Paper>
  )
}

export default function OverviewPage() {
  const queryClient = useQueryClient()

  const [includeInactive, setIncludeInactive] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>("chart")

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["forum", "organisation", includeInactive],
    queryFn: () => forumApi.getOrganisation(includeInactive),
  })

  const treeData = useMemo(() => buildTreeData(data ?? []), [data])

  const tree = useTree()

  // Expand all nodes by default whenever new tree data arrives (e.g. on
  // initial load or when toggling "Vis afsluttede arbejdsgrupper"). Tree's
  // own effect calls `tree.initialize(data)` on the same data change, which
  // would otherwise reset the expanded state — so we set it explicitly via
  // `setExpandedState` right after, using Mantine's `getTreeExpandedState`
  // helper with `"*"` to mean "all nodes expanded".
  useEffect(() => {
    if (treeData.length > 0) {
      tree.setExpandedState(getTreeExpandedState(treeData, "*"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData])

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (isError) {
    return (
      <Center h={200}>
        <Text c="red">Organisationsoverblikket kunne ikke indlæses.</Text>
      </Center>
    )
  }

  return (
    <Stack gap="md" p="md">
      <CreateSubgroupModal
        opened={createOpened}
        onClose={closeCreate}
        defaultGroupType="arbejdsgruppe"
        onCreated={() =>
          queryClient.invalidateQueries({
            queryKey: ["forum", "organisation"],
          })
        }
      />

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <IconSitemap size={28} />
          <Title order={2}>Grafisk overblik</Title>
        </Group>
        <Group gap="md" wrap="wrap">
          <SegmentedControl
            value={viewMode}
            onChange={(value) => setViewMode(value as ViewMode)}
            data={[
              { label: "Diagram", value: "chart" },
              { label: "Træ", value: "tree" },
            ]}
          />
          <Switch
            label="Vis afsluttede arbejdsgrupper"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.currentTarget.checked)}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Opret arbejdsgruppe
          </Button>
        </Group>
      </Group>

      {(data ?? []).length === 0 ? (
        <Text c="dimmed">Der er endnu ikke nogen organisationsstruktur.</Text>
      ) : viewMode === "chart" ? (
        <OrgChart data={data ?? []} />
      ) : (
        <Tree
          data={treeData}
          tree={tree}
          levelOffset="lg"
          expandOnClick
          renderNode={(payload) => (
            <div {...payload.elementProps}>
              <OrgNodeCard payload={payload} />
            </div>
          )}
        />
      )}
    </Stack>
  )
}
