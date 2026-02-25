import { describe, it, expect, vi, beforeEach } from "vitest"
import { announcementsApi } from "./announcements"
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

describe("announcementsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getAnnouncements", () => {
    it("fetches from /announcements/ with no params by default", async () => {
      const mockData = [{ id: 1, title: "Vigtig besked" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })

      const result = await announcementsApi.getAnnouncements()

      expect(apiClient.get).toHaveBeenCalledWith("/announcements/", {
        params: {},
      })
      expect(result).toEqual(mockData)
    })

    it("passes is_active=false when includeInactive=true", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

      await announcementsApi.getAnnouncements(true)

      expect(apiClient.get).toHaveBeenCalledWith("/announcements/", {
        params: { is_active: "false" },
      })
    })

    it("handles paginated response with results wrapper", async () => {
      const mockResults = [{ id: 1, title: "Test opslag" }]
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockResults, count: 1 },
      })

      const result = await announcementsApi.getAnnouncements()

      expect(result).toEqual(mockResults)
    })
  })

  describe("getAnnouncement", () => {
    it("fetches /announcements/{id}/", async () => {
      const mockAnnouncement = { id: 5, title: "Enkelt opslag" }
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockAnnouncement })

      const result = await announcementsApi.getAnnouncement(5)

      expect(apiClient.get).toHaveBeenCalledWith("/announcements/5/")
      expect(result).toEqual(mockAnnouncement)
    })
  })

  describe("createAnnouncement", () => {
    it("posts JSON when no attachments", async () => {
      const mockAnnouncement = { id: 1, title: "Nyt opslag" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockAnnouncement })

      const data = { title: "Nyt opslag", content: "<p>Indhold</p>" }
      const result = await announcementsApi.createAnnouncement(data)

      expect(apiClient.post).toHaveBeenCalledWith("/announcements/", data)
      expect(result).toEqual(mockAnnouncement)
    })

    it("posts FormData when attachments provided", async () => {
      const mockAnnouncement = { id: 1, title: "Opslag med fil" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockAnnouncement })

      const data = {
        title: "Opslag med fil",
        content: "<p>Indhold</p>",
        is_active: true,
        priority: 2,
      }
      const file = new File(["data"], "dokument.pdf", {
        type: "application/pdf",
      })

      await announcementsApi.createAnnouncement(data, [file])

      expect(apiClient.post).toHaveBeenCalledWith(
        "/announcements/",
        expect.any(FormData),
        expect.objectContaining({ headers: expect.any(Object) }),
      )
    })
  })

  describe("updateAnnouncement", () => {
    it("patches /announcements/{id}/", async () => {
      const mockAnnouncement = { id: 1, title: "Opdateret opslag" }
      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockAnnouncement })

      const result = await announcementsApi.updateAnnouncement(1, {
        title: "Opdateret opslag",
      })

      expect(apiClient.patch).toHaveBeenCalledWith("/announcements/1/", {
        title: "Opdateret opslag",
      })
      expect(result).toEqual(mockAnnouncement)
    })
  })

  describe("deleteAnnouncement", () => {
    it("deletes /announcements/{id}/", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await announcementsApi.deleteAnnouncement(3)

      expect(apiClient.delete).toHaveBeenCalledWith("/announcements/3/")
    })
  })
})
