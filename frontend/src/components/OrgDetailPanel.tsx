import { Link } from "react-router-dom"

import {
  Avatar,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core"

import dayjs from "dayjs"

import { RichTextContent } from "./RichTextContent"

import { GROUP_TYPE_STYLES } from "../utils/groupType"

import type { GroupType, OrgNode, OrgNodeMember, Subgroup } from "../types"

const MAX_VISIBLE_MEMBERS = 6

/** The fields the panel renders, normalised so it doesn't care whether they
 * came from the organisation tree or from the subgroup detail endpoint.
 */
export interface OrgDetailView {
  name: string

  slug: string

  groupType: GroupType

  description: string

  establishedOn: string | null

  expiresOn: string | null

  isActive: boolean

  memberCount: number

  members: OrgNodeMember[]
}

/** Prefer the node already in the tree so the panel paints instantly, and fall
 * back to the detail response for a group the current tree doesn't list (an
 * archived group reached by URL while "Vis afsluttede" is off).
 */
export function toDetailView(
  node: OrgNode | null,
  detail: Subgroup | undefined,
): OrgDetailView | null {
  if (node) {
    return {
      name: node.name,
      slug: node.slug,
      groupType: node.group_type,
      description: node.description,
      establishedOn: node.established_on,
      expiresOn: node.expires_on,
      isActive: node.is_active,
      memberCount: node.member_count,
      members: node.members,
    }
  }

  if (detail) {
    return {
      name: detail.name,
      slug: detail.slug,
      groupType: detail.group_type,
      description: detail.description,
      establishedOn: detail.established_on,
      expiresOn: detail.expires_on,
      isActive: detail.is_active,
      memberCount: detail.members.length,
      members: detail.members.map((member) => member.user),
    }
  }

  return null
}

function formatDate(iso: string | null): string {
  return iso ? dayjs(iso).format("D. MMM YYYY") : "—"
}

// Named rather than inline: oxfmt strips the semicolon out of an inline object
// type here and leaves the file unparseable. See CLAUDE.md.
interface FactProps {
  label: string

  value: string
}

function Fact({ label, value }: FactProps) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>

      <Text size="sm">{value}</Text>
    </div>
  )
}

interface OrgDetailPanelProps {
  view: OrgDetailView

  /** Thread counts and latest activity. Arrives after the panel has already
   * painted from tree data, so everything it feeds is rendered conditionally.
   */
  detail: Subgroup | undefined

  /** Ancestors, root first. Empty for a root group. */
  mandate: OrgNode[]

  /** The group isn't among the rows currently shown in the tree. */
  notInTree: boolean
}

export default function OrgDetailPanel({
  view,
  detail,
  mandate,
  notInTree,
}: OrgDetailPanelProps) {
  const style = GROUP_TYPE_STYLES[view.groupType]

  const shownMembers = view.members.slice(0, MAX_VISIBLE_MEMBERS)

  const hiddenMembers = view.memberCount - shownMembers.length

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={style.color} variant="light" size="sm">
          {style.label}
        </Badge>

        {!view.isActive && (
          <Badge color="gray" variant="light" size="sm">
            Afsluttet
          </Badge>
        )}
      </Group>

      <div>
        <Title order={3} size="h4">
          {view.name}
        </Title>

        {mandate.length > 0 && (
          <Text size="xs" c="dimmed" mt={4}>
            Mandat fra {mandate.map((organ) => organ.name).join(" › ")}
          </Text>
        )}
      </div>

      {/* Two different reasons a group can be missing from the tree, and they
          need different explanations: it is archived and the switch is off, or
          it is an ordinary group that was never part of the organisation. */}
      {notInTree && !view.isActive && (
        <Text size="xs" c="dimmed">
          Denne gruppe er afsluttet. Slå »Vis afsluttede arbejdsgrupper« til for
          at se den i træet.
        </Text>
      )}

      {notInTree && view.isActive && (
        <Text size="xs" c="dimmed">
          Denne gruppe er ikke en del af foreningens organisation.
        </Text>
      )}

      {view.description && (
        <RichTextContent
          className="description-content"
          html={view.description}
        />
      )}

      <Group gap="lg">
        <Fact label="Oprettet" value={formatDate(view.establishedOn)} />

        <Fact label="Udløber" value={formatDate(view.expiresOn)} />

        <Fact label="Medlemmer" value={String(view.memberCount)} />

        {detail && <Fact label="Tråde" value={String(detail.thread_count)} />}
      </Group>

      {shownMembers.length > 0 && (
        <Group gap="xs">
          {shownMembers.map((member) => (
            <Group key={member.id} gap={6} wrap="nowrap">
              <Avatar src={member.profile_picture} size="sm" radius="xl">
                {member.first_name[0]}
              </Avatar>

              <Text size="sm">
                {member.first_name} {member.last_name}
              </Text>
            </Group>
          ))}

          {hiddenMembers > 0 && (
            <Text size="sm" c="dimmed">
              +{hiddenMembers} flere
            </Text>
          )}
        </Group>
      )}

      {detail?.latest_thread_title && (
        <Paper withBorder radius="sm" p="xs">
          <Text size="xs" c="dimmed" tt="uppercase">
            Seneste tråd
          </Text>

          <Text size="sm">{detail.latest_thread_title}</Text>

          {detail.latest_thread_activity_at && (
            <Text size="xs" c="dimmed">
              {dayjs(detail.latest_thread_activity_at).fromNow()}
            </Text>
          )}
        </Paper>
      )}

      <Button component={Link} to={`/forum/${view.slug}`} variant="filled">
        Åbn forumgruppen
      </Button>
    </Stack>
  )
}
