import { Link } from "react-router-dom"

import {
  Paper,
  Text,
  Anchor,
  Badge,
  Group,
  Box,
  Tooltip,
  Avatar,
} from "@mantine/core"

import {
  IconBuilding,
  IconUsersGroup,
  IconShield,
  IconUsers,
  IconBriefcase,
} from "@tabler/icons-react"

import type { OrgNode, GroupType } from "../types"

import "./OrgChart.css"

const MAX_VISIBLE_AVATARS = 3

const DESCRIPTION_MAX_CHARS = 160

function stripHtml(html: string): string {
  if (!html) return ""
  const doc = new DOMParser().parseFromString(html, "text/html")
  return (doc.body.textContent ?? "").trim()
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trimEnd() + "…"
}

interface GroupTypeStyle {
  label: string
  color: string
  icon: typeof IconBuilding
  prominent: boolean
}

const GROUP_TYPE_STYLES: Record<GroupType, GroupTypeStyle> = {
  generalforsamling: {
    label: "Generalforsamling",
    color: "blue",
    icon: IconBuilding,
    prominent: true,
  },
  faellesmoede: {
    label: "Fællesmøde",
    color: "teal",
    icon: IconUsers,
    prominent: true,
  },
  bestyrelse: {
    label: "Bestyrelse",
    color: "grape",
    icon: IconShield,
    prominent: true,
  },
  udvalg: {
    label: "Udvalg",
    color: "indigo",
    icon: IconUsersGroup,
    prominent: true,
  },
  arbejdsgruppe: {
    label: "Arbejdsgruppe",
    color: "green",
    icon: IconBriefcase,
    prominent: false,
  },
  almindelig: {
    label: "Gruppe",
    color: "gray",
    icon: IconBriefcase,
    prominent: false,
  },
}

function OrgChartBox({ node }: { node: OrgNode }) {
  const style = GROUP_TYPE_STYLES[node.group_type]
  const Icon = style.icon
  const plainDescription = stripHtml(node.description)

  return (
    <Tooltip
      label={truncate(plainDescription, DESCRIPTION_MAX_CHARS)}
      disabled={!plainDescription}
      multiline
      w={260}
      withArrow
      position="bottom"
    >
      <Paper
        withBorder
        radius="md"
        p="sm"
        shadow={style.prominent ? "sm" : undefined}
        className="org-chart-box"
        style={{
          borderColor: style.prominent
            ? `var(--mantine-color-${style.color}-5)`
            : undefined,
          borderWidth: style.prominent ? 2 : 1,
        }}
      >
        <Box
          className="org-chart-accent"
          style={{ background: `var(--mantine-color-${style.color}-5)` }}
        />
        <Group gap={6} wrap="nowrap" mb={4}>
          <Icon
            size={16}
            color={`var(--mantine-color-${style.color}-7)`}
            style={{ flexShrink: 0 }}
          />
          <Badge
            color={style.color}
            variant={style.prominent ? "filled" : "light"}
            size="xs"
          >
            {style.label}
          </Badge>
          {node.is_active === false && (
            <Badge color="gray" variant="light" size="xs">
              Afsluttet
            </Badge>
          )}
        </Group>

        <Anchor
          component={Link}
          to={`/forum/${node.slug}`}
          fw={600}
          size="sm"
          lineClamp={2}
        >
          {node.name}
        </Anchor>

        {node.member_count > 0 && (
          <Group gap={4} mt={6} wrap="nowrap">
            <Avatar.Group>
              {node.members.slice(0, MAX_VISIBLE_AVATARS).map((m) => (
                <Avatar
                  key={m.id}
                  src={m.profile_picture}
                  size="sm"
                  radius="xl"
                >
                  {m.first_name[0]}
                </Avatar>
              ))}
              {node.member_count > MAX_VISIBLE_AVATARS && (
                <Avatar size="sm" radius="xl">
                  +{node.member_count - MAX_VISIBLE_AVATARS}
                </Avatar>
              )}
            </Avatar.Group>
            <Text size="xs" c="dimmed">
              {node.member_count}
            </Text>
          </Group>
        )}
      </Paper>
    </Tooltip>
  )
}

interface OrgChartNodeProps {
  node: OrgNode
  isRoot?: boolean
}

function OrgChartNode({ node, isRoot }: OrgChartNodeProps) {
  const hasChildren = node.children.length > 0

  return (
    <li
      className={`${hasChildren ? "has-children" : ""} ${
        isRoot ? "org-chart-root" : ""
      }`}
    >
      <div className="org-chart-node">
        <OrgChartBox node={node} />
      </div>
      {hasChildren && (
        <ul>
          {node.children.map((child) => (
            <OrgChartNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function OrgChart({ data }: { data: OrgNode[] }) {
  return (
    <div className="org-chart-scroll">
      <div className="org-chart" data-testid="org-chart">
        <ul>
          {data.map((node) => (
            <OrgChartNode key={node.id} node={node} isRoot />
          ))}
        </ul>
      </div>
    </div>
  )
}
