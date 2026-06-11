import type { ScheduleEventData, EventPayload } from "@mantine/schedule"

import type { Event, CalendarBooking } from "../types"

import dayjs from "dayjs"

/** Convert a community Event → ScheduleEventData */

export function eventToScheduleData(
  event: Event,
): ScheduleEventData<{ event: Event }> {
  return {
    id: `event-${event.id}`,

    title: event.title,

    start: dayjs(event.start_datetime).format("YYYY-MM-DD HH:mm:ss"),

    end: dayjs(event.end_datetime).format("YYYY-MM-DD HH:mm:ss"),

    color: event.is_cancelled ? "gray" : "blue",

    variant: "light",

    payload: { event },
  }
}

/** Convert a CalendarBooking → ScheduleEventData */

export function bookingToScheduleData(
  booking: CalendarBooking,
): ScheduleEventData<{ booking: CalendarBooking }> {
  return {
    id: booking.id,

    title: booking.title,

    start: dayjs(booking.start_datetime).format("YYYY-MM-DD HH:mm:ss"),

    end: dayjs(booking.end_datetime).format("YYYY-MM-DD HH:mm:ss"),

    color: booking.room.color,

    variant: "light",

    payload: { booking },
  }
}

/**
 * Expand multi-day events into one single-day segment per covered day.
 *
 * Works around two `@mantine/schedule@9.0.0-alpha.1` limitations with multi-day
 * events, both fixed by treating a multi-day booking as a series of single-day
 * ones:
 *
 *  - **Month grid:** it packs a week's events into week-global rows and only
 *    renders the first two inline (`position.row < 2`), while the "+N more"
 *    badge is counted independently per day. A day fully covered by multi-day
 *    events gets all of its own events pushed past the 2-row cap, so the cell
 *    renders blank while still showing "+N more" (reported for 23 Jun / Aug
 *    Sundays 2026). Independent single-day chips fill each day's lowest rows
 *    first, so no day with events can render blank.
 *  - **Day view:** it only includes events that *start* on the viewed day
 *    (`getDayViewEvents`), so an overnight booking is missing from its second
 *    day. A per-day segment starts on each covered day, so it shows on all of
 *    them.
 *
 * The week view already renders multi-day events as spanning bars and the
 * mobile "oversigt" agenda lists them, so those keep the original events.
 *
 * Each segment keeps the original payload (so clicks still resolve to the
 * booking) and gets a per-day unique id (the library throws on duplicate ids).
 */
export function expandMultiDayEvents<T extends EventPayload>(
  events: ScheduleEventData<T>[],
): ScheduleEventData<T>[] {
  const result: ScheduleEventData<T>[] = []

  for (const event of events) {
    const start = dayjs(event.start)
    const end = dayjs(event.end)
    const startDay = start.startOf("day")
    const endDay = end.startOf("day")

    if (!endDay.isAfter(startDay)) {
      result.push(event)
      continue
    }

    let day = startDay
    while (!day.isAfter(endDay)) {
      const segStart = day.isSame(startDay, "day") ? start : day.startOf("day")
      const segEnd = day.isSame(endDay, "day") ? end : day.endOf("day")

      result.push({
        ...event,
        id: `${event.id}__${day.format("YYYY-MM-DD")}`,
        start: segStart.format("YYYY-MM-DD HH:mm:ss"),
        end: segEnd.format("YYYY-MM-DD HH:mm:ss"),
      })

      day = day.add(1, "day")
    }
  }

  return result
}

/** Danish labels for the Schedule component */

export const DA_SCHEDULE_LABELS = {
  today: "I dag",

  next: "Næste",

  previous: "Forrige",

  more: "Mere",

  day: "Dag",

  week: "Uge",

  month: "Måned",

  year: "År",

  allDay: "Hele dagen",

  weekday: "Ugedag",

  timeSlot: "Tidsinterval",

  selectMonth: "Vælg måned",

  selectYear: "Vælg år",

  switchToDayView: "Skift til dagvisning",

  switchToWeekView: "Skift til ugevisning",

  switchToMonthView: "Skift til månedsvisning",

  switchToYearView: "Skift til årsvisning",

  viewSelectLabel: "Kalendervisning",

  moreLabel: (hiddenEventsCount: number) => `+${hiddenEventsCount} mere`,
}
