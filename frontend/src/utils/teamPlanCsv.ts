import dayjs from "dayjs"

import type { PlannedTeam } from "../types"

const SEPARATOR = ";"

function cell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The plan as a spreadsheet: one row per cook. Semicolon-separated with a BOM,
 * which is what Danish Excel opens straight into columns with æøå intact.
 */
export function teamPlanCsv(teams: PlannedTeam[]): string {
  const header = [
    "Dato",
    "Ugedag",
    "Navn",
    "Hus",
    "Chefkok",
    "Over 50",
    "Med medbeboer",
  ]
  const rows = teams.flatMap((team) =>
    team.members.map((m) => [
      team.date,
      dayjs(team.date).format("dddd"),
      m.name,
      m.house_number,
      m.can_be_head_chef ? "ja" : "",
      m.is_over_50 ? "ja" : "",
      m.prefers_housemate ? "ja" : "",
    ]),
  )
  const lines = [header, ...rows].map((r) => r.map(cell).join(SEPARATOR))

  return "﻿" + lines.join("\r\n") + "\r\n"
}

export function downloadTeamPlanCsv(teams: PlannedTeam[], fileName: string) {
  const blob = new Blob([teamPlanCsv(teams)], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
