/**
 * Calendar API — re-exports from events API for backward compatibility.
 */

import { eventsApi } from "./events"

export const calendarApi = {
  getEvents: (start?: string, end?: string) =>
    eventsApi.getEvents({ start, end }),
  getUpcomingEvents: () => eventsApi.getUpcomingEvents(),
  getEvent: (id: number) => eventsApi.getEvent(id),
  createEvent: (data: Parameters<typeof eventsApi.createEvent>[0]) =>
    eventsApi.createEvent(data),
  updateEvent: (
    id: number,
    data: Parameters<typeof eventsApi.updateEvent>[1],
  ) => eventsApi.updateEvent(id, data),
  deleteEvent: (id: number) => eventsApi.deleteEvent(id),
}
