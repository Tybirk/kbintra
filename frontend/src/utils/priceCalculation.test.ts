import { describe, it, expect } from "vitest"

import {
  calculateDefaultTicketPrice,
  resolvePrices,
  FALLBACK_PRICES,
} from "./priceCalculation"

import type { MealPrice } from "../types"

function priceSet(
  id: number,

  effective_from: string,

  adultMeat: number,

  adultVeg: number,

  child: number,
): MealPrice {
  return {
    id,

    effective_from,

    price_adult_meat: adultMeat,

    price_adult_veg: adultVeg,

    price_child: child,

    note: "",

    created_by_name: "",

    created_at: "2026-08-02T10:00:00Z",

    is_locked: true,
  }
}

// Newest first, as the API returns it.
const schedule: MealPrice[] = [
  priceSet(2, "2026-08-02", 40, 30, 18),

  priceSet(1, "2000-01-01", 37, 26, 18),
]

describe("priceCalculation", () => {
  describe("resolvePrices", () => {
    it("uses the old prices for meals before the cutover", () => {
      expect(resolvePrices(schedule, "2026-08-01")).toEqual({
        adultMeat: 37,

        adultVeg: 26,

        child: 18,
      })
    })

    it("uses the new prices from the cutover date onwards", () => {
      expect(resolvePrices(schedule, "2026-08-02")).toEqual({
        adultMeat: 40,

        adultVeg: 30,

        child: 18,
      })

      expect(resolvePrices(schedule, "2027-03-15").adultVeg).toBe(30)
    })

    it("falls back when the schedule is missing or has not loaded", () => {
      expect(resolvePrices(undefined, "2026-08-05")).toEqual(FALLBACK_PRICES)

      expect(resolvePrices([], "2026-08-05")).toEqual(FALLBACK_PRICES)
    })

    it("falls back for dates before the earliest price set", () => {
      expect(resolvePrices(schedule, "1999-12-31")).toEqual(FALLBACK_PRICES)
    })

    it("picks the latest matching set regardless of array order", () => {
      const unordered = [schedule[1], schedule[0]]

      expect(resolvePrices(unordered, "2026-12-01").adultMeat).toBe(40)
    })
  })

  describe("calculateDefaultTicketPrice", () => {
    it("prices a meat meal at the meal date's rate", () => {
      expect(calculateDefaultTicketPrice(schedule, "2026-07-01", 1, 0, 0)).toBe(
        37,
      )

      expect(calculateDefaultTicketPrice(schedule, "2026-08-05", 1, 0, 0)).toBe(
        40,
      )
    })

    it("prices a vegetarian meal at the meal date's rate", () => {
      expect(calculateDefaultTicketPrice(schedule, "2026-07-01", 0, 1, 0)).toBe(
        26,
      )

      expect(calculateDefaultTicketPrice(schedule, "2026-08-05", 0, 1, 0)).toBe(
        30,
      )
    })

    it("keeps the child price unchanged across the cutover", () => {
      expect(calculateDefaultTicketPrice(schedule, "2026-07-01", 0, 0, 3)).toBe(
        54,
      )

      expect(calculateDefaultTicketPrice(schedule, "2026-08-05", 0, 0, 3)).toBe(
        54,
      )
    })

    it("sums mixed portions", () => {
      // 1 * 40 + 1 * 30 + 1 * 18 = 88
      expect(calculateDefaultTicketPrice(schedule, "2026-08-05", 1, 1, 1)).toBe(
        88,
      )

      // 2 * 26 + 1 * 18 = 70 at the old rates
      expect(calculateDefaultTicketPrice(schedule, "2026-07-01", 0, 2, 1)).toBe(
        70,
      )
    })

    it("returns 0 for no portions", () => {
      expect(calculateDefaultTicketPrice(schedule, "2026-08-05", 0, 0, 0)).toBe(
        0,
      )
    })
  })
})
