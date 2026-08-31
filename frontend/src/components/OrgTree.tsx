import { Link } from "react-router-dom"

import { Avatar, Badge, Text, UnstyledButton } from "@mantine/core"

import { IconChevronRight } from "@tabler/icons-react"

import { flattenForDisplay } from "../utils/orgTree"

import { GROUP_TYPE_STYLES } from "../utils/groupType"

import type { OrgNode } from "../types"

import "./OrgTree.css"

/** Rail geometry, in px. `PAD` is where a root row's content starts, `STEP` is
 * what one mandate level costs, and `INSET` places a connector inside the
 * parent's indent slot. Depth is cheap: four levels fit in 68px, so even the
 * deepest branch leaves most of a phone screen for the name.
 */
const PAD = 14

const STEP = 18

const INSET = 7

const MAX_VISIBLE_AVATARS = 3

const contentX = (depth: number) => PAD + depth * STEP

/** Only defined for level >= 1 — depth-0 rows have no connector. */
const lineX = (level: number) => PAD + (level - 1) * STEP + INSET

interface OrgTreeProps {
  nodes: OrgNode[]

  selectedSlug: string | null

  collapsed: Set<number>

  onToggleCollapse: (id: number) => void
}

/** The organisation as one vertical tree: indentation is the mandate chain, and
 * every row links to that group's detail panel.
 *
 * Deliberately a plain list of links rather than an ARIA `tree` widget. A real
 * `role="tree"` owes the user arrow-key navigation, typeahead and roving
 * tabindex; a list of links gets the structure across without any of that
 * machinery to keep working.
 */
export default function OrgTree({
  nodes,
  selectedSlug,
  collapsed,
  onToggleCollapse,
}: OrgTreeProps) {
  const rows = flattenForDisplay(nodes, collapsed)

  return (
    <ul className="org-tree" role="list">
      {rows.map(({ node, depth, isLast, ancestorHasNext }) => {
        const style = GROUP_TYPE_STYLES[node.group_type]

        const rail = `color-mix(in srgb, var(--mantine-color-${style.color}-6) 32%, transparent)`

        const hasChildren = node.children.length > 0

        const isCollapsed = collapsed.has(node.id)

        const isSelected = node.slug === selectedSlug

        return (
          <li
            key={node.id}
            className="org-tree-row"
            data-selected={isSelected || undefined}
            style={{ paddingLeft: contentX(depth) }}
          >
            {ancestorHasNext.map((hasNext, index) =>
              hasNext ? (
                <span
                  key={`guide-${node.id}-${index}`}
                  className="org-tree-rail"
                  style={{ left: lineX(index + 1), background: rail }}
                />
              ) : null,
            )}

            {depth > 0 && !isLast && (
              <span
                className="org-tree-rail"
                style={{ left: lineX(depth), background: rail }}
              />
            )}

            {depth > 0 && (
              <span
                className="org-tree-elbow"
                style={{ left: lineX(depth), borderColor: rail }}
              />
            )}

            {hasChildren ? (
              <UnstyledButton
                className="org-tree-fold"
                onClick={() => onToggleCollapse(node.id)}
                aria-expanded={!isCollapsed}
                aria-label={
                  isCollapsed
                    ? `Fold ${node.name} ud`
                    : `Fold ${node.name} sammen`
                }
              >
                <IconChevronRight className="org-tree-chevron" size={13} />
              </UnstyledButton>
            ) : (
              <span
                className="org-tree-dot"
                style={{
                  background: `var(--mantine-color-${style.color}-6)`,
                }}
              />
            )}

            <Link
              to={`/overblik/${node.slug}`}
              className="org-tree-link"
              aria-current={isSelected ? "true" : undefined}
            >
              <Text
                component="span"
                className="org-tree-name"
                size="sm"
                fw={depth === 0 ? 600 : 500}
              >
                {node.name}
              </Text>

              {!node.is_active && (
                <Badge color="gray" variant="light" size="xs">
                  Afsluttet
                </Badge>
              )}

              <span className="org-tree-meta">
                {node.member_count > 0 && (
                  <Avatar.Group>
                    {node.members
                      .slice(0, MAX_VISIBLE_AVATARS)
                      .map((member) => (
                        <Avatar
                          key={member.id}
                          src={member.profile_picture}
                          size="sm"
                          radius="xl"
                        >
                          {member.first_name[0]}
                        </Avatar>
                      ))}

                    {node.member_count > MAX_VISIBLE_AVATARS && (
                      <Avatar size="sm" radius="xl">
                        +{node.member_count - MAX_VISIBLE_AVATARS}
                      </Avatar>
                    )}
                  </Avatar.Group>
                )}

                <Text component="span" size="xs" c="dimmed">
                  {node.member_count}
                </Text>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
