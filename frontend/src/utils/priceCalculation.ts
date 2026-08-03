/**
 * Date-aware portion pricing.
 *
 * Prices change over time and are configured by food admins (see /mad/admin).
 * Every lookup is anchored to the **meal date**, never to "today", so past
 * meals keep the prices that applied when they were served — same rule as
 * `backend/apps/food/pricing.py`.
 */

import type { MealPrice, MealPrices } from "../types"

/**
 * Prices used before the price schedule existed. Only a safety net for when the
 * schedule has not loaded yet — the backend always seeds at least one price set.
 */
export const FALLBACK_PRICES: MealPrices = {
  adultMeat: 37,

  adultVeg: 26,

  child: 18,
}

/**
 * The prices in effect on `mealDate` (YYYY-MM-DD): the latest set that starts on
 * or before it.
 */
export function resolvePrices(
  schedule: MealPrice[] | undefined,

  mealDate: string,
): MealPrices {
  if (!schedule || schedule.length === 0) return FALLBACK_PRICES

  let match: MealPrice | undefined

  for (const entry of schedule) {
    if (entry.effective_from > mealDate) continue

    if (!match || entry.effective_from > match.effective_from) match = entry
  }

  if (!match) return FALLBACK_PRICES

  return {
    adultMeat: match.price_adult_meat,

    adultVeg: match.price_adult_veg,

    child: match.price_child,
  }
}

/**
 * Calculate the default ticket price for a meal on `mealDate`.
 */
export function calculateDefaultTicketPrice(
  schedule: MealPrice[] | undefined,

  mealDate: string,

  adultsMeat: number,

  adultsVeg: number,

  childrenCount: number,
): number {
  const prices = resolvePrices(schedule, mealDate)

  const total =
    prices.adultMeat * adultsMeat +
    prices.adultVeg * adultsVeg +
    prices.child * childrenCount

  // Prices may have two decimals, and float maths turns e.g. 40.10 * 3 into
  // 120.30000000000001. Round to øre so we never show (or send) that.
  return Math.round(total * 100) / 100
}
