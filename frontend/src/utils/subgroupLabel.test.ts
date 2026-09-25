import { describe, it, expect } from "vitest"

import { subgroupOptionLabel } from "./subgroupLabel"

describe("subgroupOptionLabel", () => {
  it("puts the group's emoji before its name", () => {
    expect(subgroupOptionLabel({ icon: "🏸", name: "Badmintongruppe" })).toBe(
      "🏸 Badmintongruppe",
    )
  })

  it("falls back to 💬 for a group without an emoji", () => {
    expect(subgroupOptionLabel({ icon: "", name: "Ny gruppe" })).toBe(
      "💬 Ny gruppe",
    )
  })
})
