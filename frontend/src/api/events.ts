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

  // Get single event
  getEvent: async (id: number): Promise<Event> => {
    const response = await apiClient.get(`/events/${id}/`)
    return response.data
  },

  // Create event
  createEvent: async (data: CreateEventData): Promise<Event> => {
    const response = await apiClient.post("/events/", data)
    return response.data
  },

  // Update event
  updateEvent: async (id: number, data: UpdateEventData): Promise<Event> => {
    const response = await apiClient.patch(`/events/${id}/`, data)
    return response.data
  },

  // Delete event
  deleteEvent: async (id: number): Promise<void> => {
    await apiClient.delete(`/events/${id}/`)
  },

  // RSVP
  submitRsvp: async (eventId: number, data: RsvpSubmitData): Promise<Event> => {
    const response = await apiClient.patch(`/events/${eventId}/rsvp/`, data)
    return response.data
  },

  // Get attendees
  getAttendees: async (eventId: number): Promise<EventAttendance[]> => {
    const response = await apiClient.get(`/events/${eventId}/attendees/`)
    return response.data
  },

  // Get household members for RSVP
  getHouseholdMembers: async (eventId: number): Promise<HouseholdMember[]> => {
    const response = await apiClient.get(`/events/${eventId}/household/`)
    return response.data
  },

  // Download iCal
  getICalUrl: (eventId: number): string => `/api/events/${eventId}/ical/`,

  // Files
  getFiles: async (eventId: number): Promise<EventFile[]> => {
    const response = await apiClient.get(`/events/${eventId}/files/`)
    return response.data
  },

  uploadFiles: async (eventId: number, files: File[]): Promise<EventFile[]> => {
    const formData = new FormData()
    files.forEach((file) => formData.append("files", file))
    const response = await apiClient.post(
      `/events/${eventId}/files/`,
      formData,
      {
        headers: { "Content-Type": undefined },
      },
    )
    return response.data
  },
}
