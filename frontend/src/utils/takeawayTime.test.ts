import { describe, it, expect } from "vitest"

import { takeawayTimeOptions } from "./takeawayTime"

const at = (h: number, m: number) => new Date(2026, 9, 5, h, m)

describe("takeawayTimeOptions", () => {
  it("offers the quarter-hours still ahead and before 17:30", () => {
    expect(takeawayTimeOptions(at(16, 20))).toEqual([
      "16:30",
      "16:45",
      "17:00",
      "17:15",
    ])
  })

  it("starts at 15:00 early in the day", () => {
    expect(takeawayTimeOptions(at(10, 0))[0]).toBe("15:00")
  })

  it("offers nothing from 17:15 on, leaving only 'Nu'", () => {
    expect(takeawayTimeOptions(at(17, 15))).toEqual([])
    expect(takeawayTimeOptions(at(18, 0))).toEqual([])
  })
})
