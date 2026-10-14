import type { OrgNode } from "../types"

export interface ParentOption {
  value: string
  label: string
}

/** Flatten the nested organisation tree into a flat list of parent options,
 * indenting each entry by its depth so the hierarchy stays visible in a Select.
 *
 * `excludeId` drops a single node (and only that node, not its subtree) from the
 * results — used when editing a group so it can't be selected as its own parent.
 * The backend still rejects deeper cycles (parent = a descendant).
 */
export function flattenOrgTree(
  nodes: OrgNode[],
  depth = 0,
  excludeId?: number,
): ParentOption[] {
  return nodes.flatMap((node) => [
    ...(node.id === excludeId
      ? []
      : [
          {
            value: String(node.id),
            label: `${"  ".repeat(depth)}${node.name}`,
          },
        ]),
    ...flattenOrgTree(node.children, depth + 1, excludeId),
  ])
}

/** Find a node anywhere in the tree by its slug. */
export function findNodeBySlug(nodes: OrgNode[], slug: string): OrgNode | null {
  for (const node of nodes) {
    if (node.slug === slug) return node

    const hit = findNodeBySlug(node.children, slug)
    if (hit) return hit
  }

  return null
}

/** The chain of organs a group has its mandate from, root first, excluding the
 * group itself. Empty for a root node, which has no mandate above it.
 */
export function mandatePath(nodes: OrgNode[], slug: string): OrgNode[] {
  function walk(siblings: OrgNode[], trail: OrgNode[]): OrgNode[] | null {
    for (const node of siblings) {
      if (node.slug === slug) return trail

      const hit = walk(node.children, [...trail, node])
      if (hit) return hit
    }

    return null
  }

  return walk(nodes, []) ?? []
}

export interface OrgRow {
  node: OrgNode

  depth: number

  /** Last among its siblings — no connector line continues below it. */
  isLast: boolean

  /** `ancestorHasNext[k]` = the ancestor at depth `k + 1` has a later sibling,
   * so its connector line must keep running past this row. Always
   * `depth - 1` long, because a depth-0 row draws no connector at all.
   */
  ancestorHasNext: boolean[]
}

/** Flatten the tree into the visible rows, carrying the guide flags each row
 * needs to draw its connector rails. Children of a collapsed node are skipped.
 */
export function flattenForDisplay(
  nodes: OrgNode[],
  collapsed: Set<number>,
): OrgRow[] {
  const rows: OrgRow[] = []

  function walk(
    siblings: OrgNode[],
    depth: number,
    ancestorHasNext: boolean[],
  ): void {
    siblings.forEach((node, index) => {
      const isLast = index === siblings.length - 1

      rows.push({ node, depth, isLast, ancestorHasNext })

      if (node.children.length > 0 && !collapsed.has(node.id)) {
        // Roots contribute no guide: they have no connector of their own, so
        // the array stays exactly one shorter than the child's depth.
        walk(
          node.children,
          depth + 1,
          depth === 0 ? [] : [...ancestorHasNext, !isLast],
        )
      }
    })
  }

  walk(nodes, 0, [])

  return rows
}
