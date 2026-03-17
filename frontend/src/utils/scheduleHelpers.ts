import type { ScheduleEventData } from "@mantine/schedule"
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
