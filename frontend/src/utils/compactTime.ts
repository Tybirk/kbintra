import dayjs, { type Dayjs } from "dayjs"

/**
 * When something happened, short enough to stay on one line beside a title:
 * "nu", "3 min", "14:32", "i går", "tirs.", "12. okt.", "12.10.24".
 *
 * The last hour counts minutes, as the conversation list's readers asked for;
 * after that the time of day says more than "5 timer siden" and never goes
 * stale. "siden" is left out: next to the last message it goes without saying.
 */
export function compactTime(
  value: string | Date | Dayjs,
  now: Dayjs = dayjs(),
): string {
  const then = dayjs(value)

  const minutes = now.diff(then, "minute")

  // A clock a little ahead of the server's still reads as just now.
  if (minutes < 1) return "nu"

  if (minutes < 60) return `${minutes} min`

  const days = now.startOf("day").diff(then.startOf("day"), "day")

  if (days === 0) return then.format("HH:mm")

  if (days === 1) return "i går"

  if (days < 7) return then.format("ddd")

  if (then.year() === now.year()) return then.format("D. MMM")

  return then.format("D.M.YY")
}
