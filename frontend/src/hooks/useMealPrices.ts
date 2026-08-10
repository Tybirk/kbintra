import { useQuery } from "@tanstack/react-query"

import { foodApi } from "../api/food"

export const MEAL_PRICES_QUERY_KEY = ["food", "prices"]

/**
 * The full portion price schedule (a handful of rows). Pass it to
 * `resolvePrices` / `calculateDefaultTicketPrice` together with a meal date —
 * prices are never "current", always anchored to the date of the meal.
 */
export function useMealPrices() {
  return useQuery({
    queryKey: MEAL_PRICES_QUERY_KEY,

    queryFn: foodApi.getMealPrices,

    // Prices change a couple of times a year; no need to refetch eagerly.
    staleTime: 60 * 60 * 1000,
  })
}
