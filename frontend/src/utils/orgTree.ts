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
