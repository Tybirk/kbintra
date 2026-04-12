/**
 * Bookings API functions
 */

import { apiClient } from "./client"

import type {
  Room,
  RecurringBooking,
  CreateRecurringBookingData,
  CalendarBooking,
  AvailabilityCheckRequest,
  AvailabilityResult,
} from "../types"

export const bookingsApi = {
  // Rooms

  getRooms: async (activeOnly = true): Promise<Room[]> => {
    const params = activeOnly ? { active: "true" } : {}

    const response = await apiClient.get("/bookings/rooms/", { params })

    return response.data.results ?? response.data
  },

  getRoom: async (id: number): Promise<Room> => {
    const response = await apiClient.get(`/bookings/rooms/${id}/`)

    return response.data
  },

  createRoom: async (data: Partial<Room>): Promise<Room> => {
    const response = await apiClient.post("/bookings/rooms/", data)

    return response.data
  },

  updateRoom: async (id: number, data: Partial<Room>): Promise<Room> => {
    const response = await apiClient.patch(`/bookings/rooms/${id}/`, data)

    return response.data
  },

  deleteRoom: async (id: number): Promise<void> => {
    await apiClient.delete(`/bookings/rooms/${id}/`)
  },

  // Recurring bookings (admin only)

  getRecurringBookings: async (params?: {
    room?: number

    active?: boolean
  }): Promise<RecurringBooking[]> => {
    const queryParams: Record<string, string> = {}

    if (params?.room) queryParams.room = String(params.room)

    if (params?.active !== undefined) queryParams.active = String(params.active)

    const response = await apiClient.get("/bookings/recurring/", {
      params: queryParams,
    })

    return response.data.results ?? response.data
  },

  getRecurringBooking: async (id: number): Promise<RecurringBooking> => {
    const response = await apiClient.get(`/bookings/recurring/${id}/`)

    return response.data
  },

  createRecurringBooking: async (
    data: CreateRecurringBookingData,
  ): Promise<RecurringBooking> => {
    const response = await apiClient.post("/bookings/recurring/", data)

    return response.data
  },

  updateRecurringBooking: async (
    id: number,

    data: Partial<CreateRecurringBookingData>,
  ): Promise<RecurringBooking> => {
    const response = await apiClient.patch(`/bookings/recurring/${id}/`, data)

    return response.data
  },

  deleteRecurringBooking: async (id: number): Promise<void> => {
    await apiClient.delete(`/bookings/recurring/${id}/`)
  },

  // Create exception for a single occurrence (skip one date)

  createRecurringBookingException: async (
    recurringBookingId: number,

    exceptionDate: string,
  ): Promise<void> => {
    await apiClient.post(
      `/bookings/recurring/${recurringBookingId}/exception/`,

      {
        exception_date: exceptionDate,
      },
    )
  },

  // Calendar view

  getCalendarBookings: async (
    start: string,

    end: string,

    roomId?: number,
  ): Promise<CalendarBooking[]> => {
    const params: Record<string, string> = { start, end }

    if (roomId) params.room = String(roomId)

    const response = await apiClient.get("/bookings/calendar/", { params })

    return response.data
  },

  // Availability check

  checkAvailability: async (
    data: AvailabilityCheckRequest,
  ): Promise<AvailabilityResult> => {
    const response = await apiClient.post("/bookings/check-availability/", data)

    return response.data
  },
}
