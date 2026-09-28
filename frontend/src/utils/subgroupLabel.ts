import type { Subgroup } from "../types"

/**
 * A group as it reads in a picker: its emoji, then its name — the way every
 * forum list shows it. Groups without an emoji get 💬, the same default the
 * group page shows, so the names still line up.
 */
export function subgroupOptionLabel(
  subgroup: Pick<Subgroup, "icon" | "name">,
): string {
  return `${subgroup.icon || "💬"} ${subgroup.name}`
}
