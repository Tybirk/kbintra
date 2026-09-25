/**
 * Birthdate formatting, shared by the house page and the profile pages so the
 * two cannot drift into showing a resident's birthday two different ways.
 */

import dayjs from "dayjs"

/** Whole years lived, or null if the date is missing or unparseable. */
export function ageInYears(
  birthdate: string | null | undefined,
): number | null {
  if (!birthdate) return null
  const parsed = dayjs(birthdate)
  if (!parsed.isValid()) return null
  return dayjs().diff(parsed, "year")
}

/**
 * "1992-10-04" → "4. oktober 1992 (33 år)".
 *
 * The month name comes from the Danish dayjs locale registered in main.tsx.
 * A future date (a typo, most likely) would give a negative age, so the age is
 * left off rather than printed as "(-1 år)".
 */
export function formatBirthdateWithAge(
  birthdate: string | null | undefined,
): string | null {
  if (!birthdate) return null
  const parsed = dayjs(birthdate)
  if (!parsed.isValid()) return null

  const date = parsed.format("D. MMMM YYYY")
  const age = ageInYears(birthdate)
  return age !== null && age >= 0 ? `${date} (${age} år)` : date
}
