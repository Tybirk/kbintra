import { useEffect, useState } from "react"

import dayjs, { type Dayjs } from "dayjs"

/**
 * The current time, refreshed every `intervalMs`, for labels like "3 min".
 * Half a minute keeps a minute label at most that far behind: with a full
 * minute, "nu" could stay up for nearly two.
 */
export function useNow(intervalMs = 30_000): Dayjs {
  const [now, setNow] = useState(() => dayjs())

  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs()), intervalMs)

    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
