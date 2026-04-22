import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { isDateLocked } from "./foodDeadline"

// Deadline logic: deadline = Wednesday 23:59:59 of the PREVIOUS week

// (the week before the meal's week, where Monday = start of week)

//

// Examples:

//   Meal Monday  2026-03-09 → deadline Wednesday 2026-03-04 23:59:59

//   Meal Wednesday 2026-03-11 → deadline Wednesday 2026-03-04 23:59:59

//   Meal Saturday  2026-03-14 → deadline Wednesday 2026-03-04 23:59:59

//   Meal Sunday    2026-03-15 → deadline Wednesday 2026-03-04 23:59:59

describe("isDateLocked", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("meal on Monday 2026-03-09", () => {
    const mealDate = "2026-03-09"

    // deadline: Wednesday 2026-03-04 23:59:59

    it("is not locked just before the deadline", () => {
      vi.setSystemTime(new Date("2026-03-04T23:59:58"))

      expect(isDateLocked(mealDate)).toBe(false)
    })

    it("is locked at the deadline moment", () => {
      vi.setSystemTime(new Date("2026-03-04T23:59:59"))

      expect(isDateLocked(mealDate)).toBe(true)
    })

    it("is locked after the deadline", () => {
      vi.setSystemTime(new Date("2026-03-05T00:00:00"))

      expect(isDateLocked(mealDate)).toBe(true)
    })
  })

  describe("meal on Wednesday 2026-03-11", () => {
    const mealDate = "2026-03-11"

    // deadline: Wednesday 2026-03-04 23:59:59

    it("is not locked just before the deadline", () => {
      vi.setSystemTime(new Date("2026-03-04T23:59:58"))

      expect(isDateLocked(mealDate)).toBe(false)
    })

    it("is locked at the deadline moment", () => {
      vi.setSystemTime(new Date("2026-03-04T23:59:59"))

      expect(isDateLocked(mealDate)).toBe(true)
    })
  })

  describe("meal on Saturday 2026-03-14", () => {
    const mealDate = "2026-03-14"

    // deadline: Wednesday 2026-03-04 23:59:59

    it("is not locked before the deadline", () => {
      vi.setSystemTime(new Date("2026-03-04T12:00:00"))

      expect(isDateLocked(mealDate)).toBe(false)
    })

    it("is locked after the deadline", () => {
      vi.setSystemTime(new Date("2026-03-05T00:00:00"))

      expect(isDateLocked(mealDate)).toBe(true)
    })
  })

  describe("meal on Sunday 2026-03-15", () => {
    const mealDate = "2026-03-15"

    // deadline: Wednesday 2026-03-04 23:59:59 (Sunday uses weekday=6)

    it("is not locked before the deadline", () => {
      vi.setSystemTime(new Date("2026-03-04T12:00:00"))

      expect(isDateLocked(mealDate)).toBe(false)
    })

    it("is locked after the deadline", () => {
      vi.setSystemTime(new Date("2026-03-06T00:00:00"))

      expect(isDateLocked(mealDate)).toBe(true)
    })
  })

  it("a meal far in the future is not locked today", () => {
    vi.setSystemTime(new Date("2026-03-08T12:00:00"))

    // Meal next Monday = 2026-03-16; deadline = 2026-03-11 23:59:59

    expect(isDateLocked("2026-03-16")).toBe(false)
  })

  it("a meal from the past is always locked", () => {
    vi.setSystemTime(new Date("2026-03-08T12:00:00"))

    expect(isDateLocked("2025-01-01")).toBe(true)
  })
})
