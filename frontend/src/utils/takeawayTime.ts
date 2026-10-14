// Take-away is normally collected at 17:30; an announcement is only news when
// the food is ready before that (the backend refuses 17:30 or later).
const TAKEAWAY_TIMES = ["17:10", "17:15", "17:20"]

// The fixed advance times ("Nu" is offered next to them) that are still ahead.
export function takeawayTimeOptions(now: Date): string[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return TAKEAWAY_TIMES.filter((t) => {
    const [h, m] = t.split(":").map(Number)
    return h * 60 + m > nowMinutes
  })
}
