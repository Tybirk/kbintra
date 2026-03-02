import dayjs from "dayjs"

/**
 * Returns true if the registration deadline for the given meal date has passed.
 * Mirrors the backend `is_after_deadline()` logic.
 *
 * Deadline = Wednesday 23:59:59 of the week before the meal.
 * Works regardless of whether a registration exists for that date.
 */
export function isDateLocked(dateStr: string): boolean {
  const mealDate = dayjs(dateStr)
  // dayjs .day(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  // Convert to Mon=0 … Sun=6 (same as Python weekday())
  const jsDay = mealDate.day()
  const weekday = jsDay === 0 ? 6 : jsDay - 1
  const daysToSubtract = weekday + 5 // Mon=5, Tue=6, Wed=7, Thu=8
  const deadline = mealDate
    .subtract(daysToSubtract, "day")
    .hour(23)
    .minute(59)
    .second(59)
  return dayjs().valueOf() >= deadline.valueOf()
}
