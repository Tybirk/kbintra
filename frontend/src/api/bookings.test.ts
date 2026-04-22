import { describe, it, expect, vi, beforeEach } from "vitest"

import { bookingsApi } from "./bookings"

import { apiClient } from "./client"

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),

    patch: vi.fn(),

    put: vi.fn(),

    delete: vi.fn(),
  },
}))

describe("bookingsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getRooms", () => {
    it("fetches active rooms by default", async () => {
      const mockRooms = [{ id: 1, name: "Fællesrum" }]

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockRooms })

      const result = await bookingsApi.getRooms()

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/rooms/", {
        params: { active: "true" },
      })

      expect(result).toEqual(mockRooms)
    })

    it("fetches all rooms when activeOnly=false", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getRooms(false)

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/rooms/", {
        params: {},
      })
    })
  })

  describe("getRoom", () => {
    it("calls GET /bookings/rooms/{id}/", async () => {
      const mockRoom = { id: 1, name: "Fællesrum" }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockRoom })

      const result = await bookingsApi.getRoom(1)

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/rooms/1/")

      expect(result).toEqual(mockRoom)
    })
  })

  describe("createRoom", () => {
    it("posts to /bookings/rooms/", async () => {
      const mockRoom = { id: 1, name: "Nyt rum" }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockRoom })

      const result = await bookingsApi.createRoom({ name: "Nyt rum" })

      expect(apiClient.post).toHaveBeenCalledWith("/bookings/rooms/", {
        name: "Nyt rum",
      })

      expect(result).toEqual(mockRoom)
    })
  })

  describe("updateRoom", () => {
    it("patches /bookings/rooms/{id}/", async () => {
      const mockRoom = { id: 1, name: "Opdateret rum" }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockRoom })

      const result = await bookingsApi.updateRoom(1, { name: "Opdateret rum" })

      expect(apiClient.patch).toHaveBeenCalledWith("/bookings/rooms/1/", {
        name: "Opdateret rum",
      })

      expect(result).toEqual(mockRoom)
    })
  })

  describe("deleteRoom", () => {
    it("calls DELETE /bookings/rooms/{id}/", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await bookingsApi.deleteRoom(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/bookings/rooms/1/")
    })
  })

  describe("getRecurringBookings", () => {
    it("calls GET /bookings/recurring/ with no filters", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getRecurringBookings()

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/recurring/", {
        params: {},
      })
    })

    it("passes room filter", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getRecurringBookings({ room: 2 })

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/recurring/", {
        params: { room: "2" },
      })
    })

    it("passes active filter", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getRecurringBookings({ active: true })

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/recurring/", {
        params: { active: "true" },
      })
    })
  })

  describe("getRecurringBooking", () => {
    it("calls GET /bookings/recurring/{id}/", async () => {
      const mockBooking = { id: 1, title: "Ugentlig rengøring" }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockBooking })

      const result = await bookingsApi.getRecurringBooking(1)

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/recurring/1/")

      expect(result).toEqual(mockBooking)
    })
  })

  describe("createRecurringBooking", () => {
    it("posts to /bookings/recurring/", async () => {
      const mockBooking = { id: 1 }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockBooking })

      const data = { title: "Ugentlig møde", room: 1, weekday: 1 }

      const result = await bookingsApi.createRecurringBooking(data as never)

      expect(apiClient.post).toHaveBeenCalledWith("/bookings/recurring/", data)

      expect(result).toEqual(mockBooking)
    })
  })

  describe("updateRecurringBooking", () => {
    it("patches /bookings/recurring/{id}/", async () => {
      const mockBooking = { id: 1, title: "Opdateret" }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockBooking })

      const result = await bookingsApi.updateRecurringBooking(1, {
        title: "Opdateret",
      })

      expect(apiClient.patch).toHaveBeenCalledWith("/bookings/recurring/1/", {
        title: "Opdateret",
      })

      expect(result).toEqual(mockBooking)
    })
  })

  describe("deleteRecurringBooking", () => {
    it("calls DELETE /bookings/recurring/{id}/", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await bookingsApi.deleteRecurringBooking(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/bookings/recurring/1/")
    })
  })

  describe("createRecurringBookingException", () => {
    it("posts to /bookings/recurring/{id}/exception/ with exception_date", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({})

      await bookingsApi.createRecurringBookingException(1, "2026-03-10")

      expect(apiClient.post).toHaveBeenCalledWith(
        "/bookings/recurring/1/exception/",

        { exception_date: "2026-03-10" },
      )
    })
  })

  describe("getCalendarBookings", () => {
    it("calls GET /bookings/calendar/ with start and end", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getCalendarBookings("2026-02-01", "2026-02-28")

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/calendar/", {
        params: { start: "2026-02-01", end: "2026-02-28" },
      })
    })

    it("passes optional room filter", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await bookingsApi.getCalendarBookings("2026-02-01", "2026-02-28", 3)

      expect(apiClient.get).toHaveBeenCalledWith("/bookings/calendar/", {
        params: { start: "2026-02-01", end: "2026-02-28", room: "3" },
      })
    })
  })

  describe("checkAvailability", () => {
    it("posts to /bookings/check-availability/", async () => {
      const mockResult = { available: true }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResult })

      const data = {
        room: 1,

        start_time: "2026-02-10T10:00:00Z",

        end_time: "2026-02-10T12:00:00Z",
      }

      const result = await bookingsApi.checkAvailability(data as never)

      expect(apiClient.post).toHaveBeenCalledWith(
        "/bookings/check-availability/",

        data,
      )

      expect(result).toEqual(mockResult)
    })
  })
})
