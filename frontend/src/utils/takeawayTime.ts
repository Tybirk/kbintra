// Take-away is normally collected at 17:30; an announcement is only news when
// the food is ready before that (the backend refuses 17:30 or later).
const TAKEAWAY_STANDARD_MINUTES = 17 * 60 + 30

// Quarter-hours still ahead of now and before 17:30, as "HH:MM".
export function takeawayTimeOptions(now: Date): string[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const options: string[] = []
  for (let m = 15 * 60; m < TAKEAWAY_STANDARD_MINUTES; m += 15) {
    if (m > nowMinutes) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0")
      const mm = String(m % 60).padStart(2, "0")
      options.push(`${hh}:${mm}`)
    }
  }
  return options
}
