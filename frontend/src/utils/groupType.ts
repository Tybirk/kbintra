import type { GroupType } from "../types"

export interface GroupTypeStyle {
  label: string

  /** Mantine palette name, used for badges, dots and connector rails. */
  color: string
}

/** Danish label and palette for each group type.
 *
 * Shared by the organisation tree and its detail panel so a group looks the
 * same wherever it appears. The colours are carried over from the org chart
 * this replaced, so the overview keeps its familiar palette.
 */
export const GROUP_TYPE_STYLES: Record<GroupType, GroupTypeStyle> = {
  generalforsamling: { label: "Generalforsamling", color: "blue" },

  faellesmoede: { label: "Fællesmøde", color: "teal" },

  bestyrelse: { label: "Bestyrelse", color: "grape" },

  udvalg: { label: "Udvalg", color: "indigo" },

  arbejdsgruppe: { label: "Arbejdsgruppe", color: "green" },

  almindelig: { label: "Gruppe", color: "gray" },
}
