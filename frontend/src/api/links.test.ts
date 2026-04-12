import { describe, it, expect, vi, beforeEach } from "vitest"

import { linksApi } from "./links"

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

describe("linksApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getLinks", () => {
    it("calls GET /links/ and returns content and updated_at", async () => {
      const mockData = {
        content: "<p>Nyttige links her</p>",

        updated_at: "2026-01-01T12:00:00Z",
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })

      const result = await linksApi.getLinks()

      expect(apiClient.get).toHaveBeenCalledWith("/links/")

      expect(result).toEqual(mockData)
    })
  })

  describe("updateLinks", () => {
    it("puts to /links/ with content", async () => {
      const mockData = {
        content: "<p>Opdateret indhold</p>",

        updated_at: "2026-02-01T10:00:00Z",
      }

      vi.mocked(apiClient.put).mockResolvedValue({ data: mockData })

      const result = await linksApi.updateLinks("<p>Opdateret indhold</p>")

      expect(apiClient.put).toHaveBeenCalledWith("/links/", {
        content: "<p>Opdateret indhold</p>",
      })

      expect(result).toEqual(mockData)
    })
  })
})
