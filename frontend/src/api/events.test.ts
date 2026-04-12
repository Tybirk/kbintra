import { describe, it, expect, vi, beforeEach } from "vitest"

import { eventsApi } from "./events"

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

describe("eventsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getEvents", () => {
    it("calls GET /events/ with no params by default", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getEvents()

      expect(apiClient.get).toHaveBeenCalledWith("/events/", { params: {} })
    })

    it("passes start and end filters", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getEvents({
        start: "2026-01-01",

        end: "2026-01-31",
      })

      expect(apiClient.get).toHaveBeenCalledWith("/events/", {
        params: { start: "2026-01-01", end: "2026-01-31" },
      })
    })

    it("passes visibility, room, subgroup and mine filters", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getEvents({
        visibility: "public",

        room: 2,

        subgroup: 5,

        mine: true,
      })

      expect(apiClient.get).toHaveBeenCalledWith("/events/", {
        params: {
          visibility: "public",

          room: "2",

          subgroup: "5",

          mine: "true",
        },
      })
    })

    it("handles paginated response", async () => {
      const mockResults = [{ id: 1, title: "Møde" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockResults },
      })

      const result = await eventsApi.getEvents()

      expect(result).toEqual(mockResults)
    })
  })

  describe("getUpcomingEvents", () => {
    it("calls GET /events/upcoming/", async () => {
      const mockEvents = [{ id: 1, title: "Kommende begivenhed" }]

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockEvents })

      const result = await eventsApi.getUpcomingEvents()

      expect(apiClient.get).toHaveBeenCalledWith("/events/upcoming/")

      expect(result).toEqual(mockEvents)
    })
  })

  describe("getEvent", () => {
    it("calls GET /events/{slug}/", async () => {
      const mockEvent = {
        id: 7,

        slug: "faellesspisning",

        title: "Fællesspisning",
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockEvent })

      const result = await eventsApi.getEvent("faellesspisning")

      expect(apiClient.get).toHaveBeenCalledWith("/events/faellesspisning/")

      expect(result).toEqual(mockEvent)
    })
  })

  describe("createEvent", () => {
    it("posts to /events/", async () => {
      const mockEvent = {
        id: 1,

        slug: "nyt-arrangement",

        title: "Nyt arrangement",
      }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockEvent })

      const data = {
        title: "Nyt arrangement",

        start_time: "2026-02-01T18:00:00Z",
      }

      const result = await eventsApi.createEvent(data as never)

      expect(apiClient.post).toHaveBeenCalledWith("/events/", data, {
        params: undefined,
      })

      expect(result).toEqual(mockEvent)
    })

    it("passes skip_notifications param when option set", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 1, slug: "test" },
      })

      await eventsApi.createEvent({ title: "Test" } as never, {
        skipNotifications: true,
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        "/events/",

        expect.any(Object),

        { params: { skip_notifications: "true" } },
      )
    })
  })

  describe("updateEvent", () => {
    it("patches /events/{slug}/", async () => {
      const mockEvent = { id: 1, slug: "opdateret", title: "Opdateret" }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockEvent })

      const result = await eventsApi.updateEvent("opdateret", {
        title: "Opdateret",
      })

      expect(apiClient.patch).toHaveBeenCalledWith("/events/opdateret/", {
        title: "Opdateret",
      })

      expect(result).toEqual(mockEvent)
    })
  })

  describe("deleteEvent", () => {
    it("calls DELETE /events/{slug}/", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await eventsApi.deleteEvent("julefest")

      expect(apiClient.delete).toHaveBeenCalledWith("/events/julefest/")
    })
  })

  describe("submitRsvp", () => {
    it("patches /events/{slug}/rsvp/", async () => {
      const mockEvent = { id: 1 }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockEvent })

      await eventsApi.submitRsvp("julefest", { status: "yes" } as never)

      expect(apiClient.patch).toHaveBeenCalledWith("/events/julefest/rsvp/", {
        status: "yes",
      })
    })
  })

  describe("getAttendees", () => {
    it("calls GET /events/{slug}/attendees/", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getAttendees("julefest")

      expect(apiClient.get).toHaveBeenCalledWith("/events/julefest/attendees/")
    })
  })

  describe("getHouseholdMembers", () => {
    it("calls GET /events/{slug}/household/", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getHouseholdMembers("julefest")

      expect(apiClient.get).toHaveBeenCalledWith("/events/julefest/household/")
    })
  })

  describe("cancelEvent", () => {
    it("posts to /events/{slug}/cancel/ with cancellation_message", async () => {
      const mockEvent = { id: 1 }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockEvent })

      await eventsApi.cancelEvent("julefest", "Aflyst grundet vejr")

      expect(apiClient.post).toHaveBeenCalledWith("/events/julefest/cancel/", {
        cancellation_message: "Aflyst grundet vejr",
      })
    })

    it("posts empty string when no cancellation message", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 1 } })

      await eventsApi.cancelEvent("julefest")

      expect(apiClient.post).toHaveBeenCalledWith("/events/julefest/cancel/", {
        cancellation_message: "",
      })
    })
  })

  describe("getFiles", () => {
    it("calls GET /events/{slug}/files/", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await eventsApi.getFiles("julefest")

      expect(apiClient.get).toHaveBeenCalledWith("/events/julefest/files/")
    })
  })

  describe("uploadFiles", () => {
    it("posts FormData to /events/{slug}/files/", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: [] })

      const file = new File(["data"], "dokument.pdf")

      await eventsApi.uploadFiles("julefest", [file])

      expect(apiClient.post).toHaveBeenCalledWith(
        "/events/julefest/files/",

        expect.any(FormData),
      )
    })
  })

  describe("downloadICal", () => {
    it("calls GET /events/{slug}/ical/ with responseType blob", async () => {
      // Stub URL methods not available in jsdom

      URL.createObjectURL = vi.fn().mockReturnValue("blob:test")

      URL.revokeObjectURL = vi.fn()

      const mockAnchor = { href: "", download: "", click: vi.fn() }

      vi.spyOn(document.body, "appendChild").mockReturnValue(
        mockAnchor as unknown as Node,
      )

      vi.spyOn(document.body, "removeChild").mockReturnValue(
        mockAnchor as unknown as Node,
      )

      vi.spyOn(document, "createElement").mockReturnValue(
        mockAnchor as unknown as HTMLElement,
      )

      vi.mocked(apiClient.get).mockResolvedValue({
        data: new Blob(["calendar data"]),

        headers: { "content-disposition": 'attachment; filename="event.ics"' },
      })

      await eventsApi.downloadICal("julefest")

      expect(apiClient.get).toHaveBeenCalledWith("/events/julefest/ical/", {
        responseType: "blob",
      })
    })
  })
})
