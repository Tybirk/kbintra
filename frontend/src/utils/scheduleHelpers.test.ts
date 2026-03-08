import { describe, it, expect } from "vitest"
import { eventToScheduleData, bookingToScheduleData, DA_SCHEDULE_LABELS } from "./scheduleHelpers"
import type { Event, CalendarBooking } from "../types"

const baseEvent: Event = {
  id: 1,
  slug: "test-event",
  title: "Fællesspisning",
  description: "Hyggelig aften",
  created_by: { id: 1, name: "Test User", profile_picture: null },
  visibility: "all",
  start_datetime: "2026-03-10T18:00:00",
  end_datetime: "2026-03-10T20:00:00",
  rooms: [],
  location: "",
  resolved_location: "",
  subgroup: null,
  folder: null,
  rsvp_enabled: false,
  rsvp_deadline: null,
  is_own: false,
  can_edit: false,
  is_cancelled: false,
  cancellation_message: "",
  thread_id: null,
}

const baseBooking: CalendarBooking = {
  id: "booking-1",
  event_slug: null,
  room: { id: 2, name: "Storsal", color: "green" },
  user: { id: 1, name: "Test User", profile_picture: null },
  title: "Møde",
  description: "",
  start_datetime: "2026-03-11T10:00:00",
  end_datetime: "2026-03-11T12:00:00",
  is_recurring: false,
  recurring_booking_id: null,
  is_own: true,
}

describe("eventToScheduleData", () => {
  it("maps id as event-<id>", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.id).toBe("event-1")
  })

  it("maps title", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.title).toBe("Fællesspisning")
  })

  it("formats start and end as YYYY-MM-DD HH:mm:ss", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.start).toBe("2026-03-10 18:00:00")
    expect(result.end).toBe("2026-03-10 20:00:00")
  })

  it("uses blue color for active events", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.color).toBe("blue")
  })

  it("uses gray color for cancelled events", () => {
    const result = eventToScheduleData({ ...baseEvent, is_cancelled: true })
    expect(result.color).toBe("gray")
  })

  it("sets variant to light", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.variant).toBe("light")
  })

  it("passes the original event in payload", () => {
    const result = eventToScheduleData(baseEvent)
    expect(result.payload).toEqual({ event: baseEvent })
  })
})

describe("bookingToScheduleData", () => {
  it("maps id from booking.id", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.id).toBe("booking-1")
  })

  it("maps title", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.title).toBe("Møde")
  })

  it("formats start and end as YYYY-MM-DD HH:mm:ss", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.start).toBe("2026-03-11 10:00:00")
    expect(result.end).toBe("2026-03-11 12:00:00")
  })

  it("uses the room color", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.color).toBe("green")
  })

  it("sets variant to light", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.variant).toBe("light")
  })

  it("passes the original booking in payload", () => {
    const result = bookingToScheduleData(baseBooking)
    expect(result.payload).toEqual({ booking: baseBooking })
  })
})

describe("DA_SCHEDULE_LABELS", () => {
  it("has Danish labels for all expected keys", () => {
    expect(DA_SCHEDULE_LABELS.today).toBe("I dag")
    expect(DA_SCHEDULE_LABELS.next).toBe("Næste")
    expect(DA_SCHEDULE_LABELS.previous).toBe("Forrige")
    expect(DA_SCHEDULE_LABELS.week).toBe("Uge")
    expect(DA_SCHEDULE_LABELS.month).toBe("Måned")
    expect(DA_SCHEDULE_LABELS.day).toBe("Dag")
    expect(DA_SCHEDULE_LABELS.year).toBe("År")
  })
})
