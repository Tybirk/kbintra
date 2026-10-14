import dayjs from "dayjs"
import "dayjs/locale/da"
import { beforeAll, describe, expect, it } from "vitest"

import { teamPlanCsv } from "./teamPlanCsv"

beforeAll(() => {
  dayjs.locale("da")
})

describe("teamPlanCsv", () => {
  it("writes one row per cook, semicolon-separated, with a BOM for Excel", () => {
    const csv = teamPlanCsv([
      {
        date: "2027-01-04",
        members: [
          {
            name: "Åse Ørsted",
            house_number: "12",
            is_over_50: true,
            can_be_head_chef: true,
            prefers_housemate: false,
          },
          {
            name: 'Bo "Bøf"; Hansen',
            house_number: "3",
            is_over_50: false,
            can_be_head_chef: false,
            prefers_housemate: true,
          },
        ],
      },
    ])

    expect(csv.startsWith("﻿")).toBe(true)
    const lines = csv.slice(1).trimEnd().split("\r\n")
    expect(lines).toEqual([
      "Dato;Ugedag;Navn;Hus;Chefkok;Over 50;Med medbeboer",
      "2027-01-04;mandag;Åse Ørsted;12;ja;ja;",
      '2027-01-04;mandag;"Bo ""Bøf""; Hansen";3;;;ja',
    ])
  })
})
