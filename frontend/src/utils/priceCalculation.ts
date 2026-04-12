/**
 * Food ticket price calculation utilities.
 *
 * Prices in DKK:
 * - Adult meat: 37
 * - Adult vegetarian: 26
 * - Child: 18
 */

export const PRICE_ADULT_MEAT = 37

export const PRICE_ADULT_VEG = 26

export const PRICE_CHILD = 18

/**
 * Calculate the default ticket price based on portion counts.
 */

export function calculateDefaultTicketPrice(
  adultsMeat: number,

  adultsVeg: number,

  childrenCount: number,
): number {
  return (
    PRICE_ADULT_MEAT * adultsMeat +
    PRICE_ADULT_VEG * adultsVeg +
    PRICE_CHILD * childrenCount
  )
}
