/**
 * Events API functions (unified: community events + private room bookings)
 */

import { apiClient } from "./client"

import type {
  Event,
  EventFile,
  CreateEventData,
  UpdateEventData,
  HouseholdMember,
  RsvpSubmitData,
  EventAttendance,
} from "../types"

export const eventsApi = {
  // Get events with optional filters

  getEvents: async (params?: {
    start?: string

    end?: string

    visibility?: string

    room?: number

    subgroup?: number

    mine?: boolean
  }): Promise<Event[]> => {
    const queryParams: Record<string, string> = {}

    if (params?.start) queryParams.start = params.start

    if (params?.end) queryParams.end = params.end

    if (params?.visibility) queryParams.visibility = params.visibility

    if (params?.room) queryParams.room = String(params.room)

    if (params?.subgroup) queryParams.subgroup = String(params.subgroup)

    if (params?.mine) queryParams.mine = "true"

    const response = await apiClient.get("/events/", { params: queryParams })

    return response.data.results ?? response.data
  },

  // Get upcoming community events (for dashboard widget)

  getUpcomingEvents: async (): Promise<Event[]> => {
    const response = await apiClient.get("/events/upcoming/")

    return response.data.results ?? response.data
  },

  // Get single event by slug

  getEvent: async (slug: string): Promise<Event> => {
    const response = await apiClient.get(`/events/${slug}/`)

    return response.data
  },

  // Create event

  createEvent: async (
    data: CreateEventData,

    options?: { skipNotifications?: boolean },
  ): Promise<Event> => {
    const params = options?.skipNotifications
      ? { skip_notifications: "true" }
      : undefined

    const response = await apiClient.post("/events/", data, { params })

    return response.data
  },

  // Update event

  updateEvent: async (slug: string, data: UpdateEventData): Promise<Event> => {
    const response = await apiClient.patch(`/events/${slug}/`, data)

    return response.data
  },

  // Delete event

  deleteEvent: async (slug: string): Promise<void> => {
    await apiClient.delete(`/events/${slug}/`)
  },

  // RSVP

  submitRsvp: async (
    eventSlug: string,

    data: RsvpSubmitData,
  ): Promise<Event> => {
    const response = await apiClient.patch(`/events/${eventSlug}/rsvp/`, data)

    return response.data
  },

  // Get attendees

  getAttendees: async (eventSlug: string): Promise<EventAttendance[]> => {
    const response = await apiClient.get(`/events/${eventSlug}/attendees/`)

    return response.data
  },

  // Get household members for RSVP

  getHouseholdMembers: async (
    eventSlug: string,
  ): Promise<HouseholdMember[]> => {
    const response = await apiClient.get(`/events/${eventSlug}/household/`)

    return response.data
  },

  // Download iCal file via authenticated request

  downloadICal: async (eventSlug: string): Promise<void> => {
    const response = await apiClient.get(`/events/${eventSlug}/ical/`, {
      responseType: "blob",
    })

    const blob = new Blob([response.data], { type: "text/calendar" })

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")

    a.href = url

    a.download =
      response.headers["content-disposition"]?.match(/filename="(.+)"/)?.[1] ??
      `event-${eventSlug}.ics`

    document.body.appendChild(a)

    a.click()

    document.body.removeChild(a)

    URL.revokeObjectURL(url)
  },

  // Cancel event

  cancelEvent: async (
    slug: string,

    cancellationMessage?: string,
  ): Promise<Event> => {
    const response = await apiClient.post<Event>(`/events/${slug}/cancel/`, {
      cancellation_message: cancellationMessage ?? "",
    })

    return response.data
  },

  // Files

  getFiles: async (eventSlug: string): Promise<EventFile[]> => {
    const response = await apiClient.get(`/events/${eventSlug}/files/`)

    return response.data
  },

  uploadFiles: async (
    eventSlug: string,

    files: File[],
  ): Promise<EventFile[]> => {
    const formData = new FormData()

    files.forEach((file) => formData.append("files", file))

    const response = await apiClient.post(
      `/events/${eventSlug}/files/`,

      formData,
    )

    return response.data
  },
}
