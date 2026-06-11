import { describe, it, expect } from "vitest"

import {
  eventToScheduleData,
  bookingToScheduleData,
  expandMultiDayEvents,
  DA_SCHEDULE_LABELS,
} from "./scheduleHelpers"

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

describe("expandMultiDayEvents", () => {
  it("leaves a single-day event unchanged", () => {
    const single = bookingToScheduleData(baseBooking)

    const result = expandMultiDayEvents([single])

    expect(result).toHaveLength(1)

    expect(result[0]).toEqual(single)
  })

  it("splits a multi-day event into one single-day chip per covered day", () => {
    const multi = bookingToScheduleData({
      ...baseBooking,
      start_datetime: "2026-06-22T14:00:00",
      end_datetime: "2026-06-23T11:00:00",
    })

    const result = expandMultiDayEvents([multi])

    expect(result).toHaveLength(2)

    // First day keeps the real start time, ends at end-of-day
    expect(result[0].start).toBe("2026-06-22 14:00:00")
    expect(result[0].end).toBe("2026-06-22 23:59:59")

    // Last day starts at midnight, keeps the real end time
    expect(result[1].start).toBe("2026-06-23 00:00:00")
    expect(result[1].end).toBe("2026-06-23 11:00:00")
  })

  it("gives each segment a per-day unique id and keeps the payload", () => {
    const booking: CalendarBooking = {
      ...baseBooking,
      start_datetime: "2026-06-22T14:00:00",
      end_datetime: "2026-06-24T11:00:00",
    }
    const multi = bookingToScheduleData(booking)

    const result = expandMultiDayEvents([multi])

    expect(result.map((e) => e.id)).toEqual([
      "booking-1__2026-06-22",
      "booking-1__2026-06-23",
      "booking-1__2026-06-24",
    ])

    // A fully-covered middle day spans the whole day
    expect(result[1].start).toBe("2026-06-23 00:00:00")
    expect(result[1].end).toBe("2026-06-23 23:59:59")

    // Payload (used to resolve clicks back to the booking) is preserved
    for (const seg of result) {
      expect(seg.payload).toEqual({ booking })
    }
  })

  it("treats an end at exactly midnight as the previous day (no empty next-day chip)", () => {
    const multi = bookingToScheduleData({
      ...baseBooking,
      start_datetime: "2026-06-22T14:00:00",
      end_datetime: "2026-06-23T00:00:00",
    })

    const result = expandMultiDayEvents([multi])

    // Covers only 22 Jun — no zero-length 23 Jun segment
    expect(result).toHaveLength(1)
    expect(result[0].start).toBe("2026-06-22 14:00:00")
    expect(result[0].end).toBe("2026-06-22 23:59:59")
  })

  it("does not add an empty trailing day for a multi-day event ending at midnight", () => {
    const multi = bookingToScheduleData({
      ...baseBooking,
      start_datetime: "2026-06-22T14:00:00",
      end_datetime: "2026-06-24T00:00:00",
    })

    const result = expandMultiDayEvents([multi])

    // Last covered day is 23 Jun, not an empty 24 Jun
    expect(result.map((e) => e.id)).toEqual([
      "booking-1__2026-06-22",
      "booking-1__2026-06-23",
    ])
    expect(result[1].end).toBe("2026-06-23 23:59:59")
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
