import { describe, it, expect } from "vitest"

import { takeawayTimeOptions } from "./takeawayTime"

const at = (h: number, m: number) => new Date(2026, 9, 5, h, m)

describe("takeawayTimeOptions", () => {
  it("offers 17:10, 17:15 and 17:20 earlier in the day", () => {
    expect(takeawayTimeOptions(at(16, 20))).toEqual(["17:10", "17:15", "17:20"])
  })

  it("drops the times that have passed", () => {
    expect(takeawayTimeOptions(at(17, 12))).toEqual(["17:15", "17:20"])
  })

  it("offers nothing from 17:20 on, leaving only 'Nu'", () => {
    expect(takeawayTimeOptions(at(17, 20))).toEqual([])
    expect(takeawayTimeOptions(at(18, 0))).toEqual([])
  })
})
