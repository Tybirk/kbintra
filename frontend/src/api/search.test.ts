import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchApi } from "./search"
import { apiClient } from "./client"

// Mock the apiClient
vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

describe("searchApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("search", () => {
    it("should search with query parameter", async () => {
      const mockResponse = {
        query: "test",
        results: {
          users: [
            {
              id: 1,
              type: "user",
              title: "Test User",
              subtitle: "House 1",
              url: "/profil/1",
              score: 100,
            },
          ],
          threads: [],
          posts: [],
          subgroups: [],
          announcements: [],
          events: [],
          houses: [],
          files: [],
        },
        total_count: 1,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockResponse })

      const result = await searchApi.search("test")

      expect(apiClient.get).toHaveBeenCalledWith("/search/", {
        params: { q: "test", limit: 5 },
      })
      expect(result).toEqual(mockResponse)
    })

    it("should use custom limit", async () => {
      const mockResponse = {
        query: "test",
        results: {
          users: [],
          threads: [],
          posts: [],
          subgroups: [],
          announcements: [],
          events: [],
          houses: [],
          files: [],
        },
        total_count: 0,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockResponse })

      await searchApi.search("test", 10)

      expect(apiClient.get).toHaveBeenCalledWith("/search/", {
        params: { q: "test", limit: 10 },
      })
    })

    it("should return results grouped by type", async () => {
      const mockResponse = {
        query: "forum",
        results: {
          users: [],
          threads: [
            {
              id: 1,
              type: "thread",
              title: "Forum Thread",
              subtitle: "General Discussion",
              url: "/forum/general/1",
              score: 85,
            },
          ],
          posts: [
            {
              id: 2,
              type: "post",
              title: "Forum Thread",
              subtitle: "This is a post about forum...",
              url: "/forum/general/1",
              score: 70,
            },
          ],
          subgroups: [
            {
              id: 3,
              type: "subgroup",
              title: "Forum Subgroup",
              subtitle: "Description",
              url: "/forum/general",
              score: 90,
            },
          ],
          announcements: [],
          events: [],
          houses: [],
          files: [],
        },
        total_count: 3,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockResponse })

      const result = await searchApi.search("forum")

      expect(result.total_count).toBe(3)
      expect(result.results.threads).toHaveLength(1)
      expect(result.results.posts).toHaveLength(1)
      expect(result.results.subgroups).toHaveLength(1)
    })

    it("should handle empty results", async () => {
      const mockResponse = {
        query: "nonexistent",
        results: {
          users: [],
          threads: [],
          posts: [],
          subgroups: [],
          announcements: [],
          events: [],
          houses: [],
          files: [],
        },
        total_count: 0,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockResponse })

      const result = await searchApi.search("nonexistent")

      expect(result.total_count).toBe(0)
      Object.values(result.results).forEach((items) => {
        expect(items).toHaveLength(0)
      })
    })
  })
})
