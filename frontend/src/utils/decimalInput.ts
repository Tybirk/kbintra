/**
 * Decimal input handling for Danish keyboards.
 *
 * People here type "3,94". JavaScript's parseFloat stops at the comma (giving 3)
 * and Django's DecimalField rejects it outright, so anything typed with a comma
 * has to be normalised before it is calculated with or sent to the API.
 */

/** "3,94" → "3.94". Also tolerates spaces, which phones like to insert. */
export function normalizeDecimalSeparator(value: string): string {
  const trimmed = value.trim().replace(/\s/g, "")
  // Only the last separator can be the decimal one ("1.234,56" → "1234.56").
  const lastComma = trimmed.lastIndexOf(",")
  const lastDot = trimmed.lastIndexOf(".")
  if (lastComma === -1) return trimmed
  if (lastDot === -1) return trimmed.replace(/,/g, ".")

  if (lastComma > lastDot) {
    return trimmed.replace(/\./g, "").replace(",", ".")
  }
  return trimmed.replace(/,/g, "")
}

/** Parse user input as a number, whichever separator they used. 0 when unparseable. */
export function parseDecimalInput(value: string): number {
  const parsed = Number.parseFloat(normalizeDecimalSeparator(value))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Show a stored value ("3.20") the Danish way ("3,20") in an input. */
export function toDanishDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return ""
  return String(value).replace(".", ",")
}
