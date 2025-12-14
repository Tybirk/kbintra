/**
 * Food ticket price calculation utilities.
 *
 * Prices in DKK:
 * - Adult meat: 37
 * - Adult vegetarian: 26
 * - Child: 18
 */

export const PRICE_ADULT_MEAT = 37;
export const PRICE_ADULT_VEG = 26;
export const PRICE_CHILD = 18;

export type MealType = 'meat' | 'vegetarian';

/**
 * Calculate the default ticket price based on meal type and portion counts.
 */
export function calculateDefaultTicketPrice(
  mealType: MealType,
  adultsCount: number,
  childrenCount: number
): number {
  const adultPrice = mealType === 'meat' ? PRICE_ADULT_MEAT : PRICE_ADULT_VEG;
  return adultPrice * adultsCount + PRICE_CHILD * childrenCount;
}
