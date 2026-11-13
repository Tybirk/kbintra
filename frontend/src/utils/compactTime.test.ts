import { describe, it, expect } from "vitest"

import dayjs from "dayjs"

import { compactTime } from "./compactTime"

// Thursday 13 November 2026, 15:00.
const now = dayjs(new Date(2026, 10, 13, 15, 0))

const at = (month: number, day: number, h: number, m = 0, year = 2026) =>
  new Date(year, month - 1, day, h, m)

describe("compactTime", () => {
  it("says nu for the last minute, and for a clock a little ahead", () => {
    expect(compactTime(now.subtract(30, "second"), now)).toBe("nu")
    expect(compactTime(now.add(20, "second"), now)).toBe("nu")
  })

  it("counts minutes for the last hour, without 'siden'", () => {
    expect(compactTime(now.subtract(1, "minute"), now)).toBe("1 min")
    expect(compactTime(now.subtract(59, "minute"), now)).toBe("59 min")
  })

  it("gives the time of day for earlier today", () => {
    expect(compactTime(at(11, 13, 9, 5), now)).toBe("09:05")
  })

  it("counts minutes across midnight, then says i går", () => {
    const justAfterMidnight = dayjs(at(11, 14, 0, 10))

    expect(compactTime(at(11, 13, 23, 50), justAfterMidnight)).toBe("20 min")
    expect(compactTime(at(11, 13, 22, 0), justAfterMidnight)).toBe("i går")
  })

  it("says i går for all of yesterday", () => {
    expect(compactTime(at(11, 12, 0, 1), now)).toBe("i går")
    expect(compactTime(at(11, 12, 23, 59), now)).toBe("i går")
  })

  it("names the weekday within the week", () => {
    expect(compactTime(at(11, 11, 12), now)).toBe("ons.")
    expect(compactTime(at(11, 7, 12), now)).toBe("lør.")
  })

  it("gives day and month from a week back", () => {
    expect(compactTime(at(11, 6, 12), now)).toBe("6. nov.")
    expect(compactTime(at(5, 1, 12), now)).toBe("1. maj")
  })

  it("adds the year for earlier years", () => {
    expect(compactTime(at(12, 31, 12, 0, 2025), now)).toBe("31.12.25")
  })

  it("reads the server's ISO timestamps", () => {
    expect(compactTime(now.subtract(5, "minute").toISOString(), now)).toBe(
      "5 min",
    )
  })
})
