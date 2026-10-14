import { useCallback, useState } from "react"

import { Link, useNavigate, useParams } from "react-router-dom"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  Anchor,
  Button,
  Center,
  Drawer,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core"

import { useDisclosure, useMediaQuery } from "@mantine/hooks"

import { IconPlus, IconSitemap } from "@tabler/icons-react"

import { forumApi } from "../api/forum"

import CreateSubgroupModal from "../components/CreateSubgroupModal"

import OrgTree from "../components/OrgTree"

import OrgDetailPanel, { toDetailView } from "../components/OrgDetailPanel"

import { findNodeBySlug, mandatePath } from "../utils/orgTree"

import "./OverviewPage.css"

export default function OverviewPage() {
  const queryClient = useQueryClient()

  const navigate = useNavigate()

  const { slug } = useParams<{ slug: string }>()

  // Read on the first render rather than in an effect, so deep-linking straight
  // to /overblik/<slug> on a desktop doesn't flash the mobile drawer.
  const isDesktop = useMediaQuery("(min-width: 62em)", false, {
    getInitialValueInEffect: false,
  })

  const [includeInactive, setIncludeInactive] = useState(false)

  // Every group is visible on load. The fold control is for tidying up, not for
  // hiding groups behind a branch someone forgot to open.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["forum", "organisation", includeInactive],
    queryFn: () => forumApi.getOrganisation(includeInactive),
  })

  const nodes = data ?? []

  // On desktop the panel is a permanent column, and an empty one reads as a
  // broken page — so fall back to the first organ. Derived, never navigated:
  // redirecting on mount would push a history entry on every visit and leave
  // the back button pointing at the page you're already on.
  const selectedSlug = slug ?? (isDesktop ? (nodes[0]?.slug ?? null) : null)

  const selectedNode = selectedSlug ? findNodeBySlug(nodes, selectedSlug) : null

  const mandate = selectedSlug ? mandatePath(nodes, selectedSlug) : []

  // Thread counts and latest activity come from the subgroup detail endpoint
  // rather than being added to /organisation/. Its serializer already hides
  // members-only threads from people who can't see them; duplicating that on
  // the organisation endpoint would risk leaking a private thread title.
  const detailQuery = useQuery({
    queryKey: ["forum", "subgroup", selectedSlug],
    queryFn: () => forumApi.getSubgroup(selectedSlug as string),
    enabled: !!selectedSlug,
  })

  const view = toDetailView(selectedNode, detailQuery.data)

  const toggleCollapse = useCallback((id: number) => {
    setCollapsed((current) => {
      const next = new Set(current)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })
  }, [])

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

  const panelBody = view ? (
    <OrgDetailPanel
      view={view}
      detail={detailQuery.data}
      mandate={mandate}
      notInTree={!selectedNode}
    />
  ) : detailQuery.isError ? (
    <Stack gap="xs">
      <Text size="sm">Gruppen findes ikke længere.</Text>

      <Anchor component={Link} to="/overblik" size="sm">
        Tilbage til overblikket
      </Anchor>
    </Stack>
  ) : null

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

      {nodes.length === 0 ? (
        <Text c="dimmed">Der er endnu ikke nogen organisationsstruktur.</Text>
      ) : (
        <div className="overview-layout">
          <OrgTree
            nodes={nodes}
            selectedSlug={selectedSlug}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
          />

          {isDesktop && (
            <Paper className="overview-panel" withBorder radius="md" p="md">
              {panelBody}
            </Paper>
          )}
        </div>
      )}

      {/* Below the breakpoint the panel is a drawer instead. Closing it is a
          navigation, so the browser's back button closes it too. */}
      <Drawer
        opened={!isDesktop && !!slug}
        onClose={() => navigate("/overblik", { replace: true })}
        position="bottom"
        size="80%"
        radius="lg"
        withCloseButton
        closeButtonProps={{ "aria-label": "Luk" }}
      >
        {panelBody}
      </Drawer>
    </Stack>
  )
}
