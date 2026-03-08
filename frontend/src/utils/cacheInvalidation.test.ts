import { describe, it, expect, vi, beforeEach } from "vitest"
import { invalidateCacheForLink } from "./cacheInvalidation"
import type { QueryClient } from "@tanstack/react-query"

function makeQueryClient(): QueryClient {
  return {
    invalidateQueries: vi.fn(),
  } as unknown as QueryClient
}

describe("invalidateCacheForLink", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = makeQueryClient()
  })

  describe("forum thread links", () => {
    it("invalidates thread and threads queries for a thread link", () => {
      invalidateCacheForLink(queryClient, "/forum/madgruppen/traad/ugens-menu")
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["thread", "madgruppen", "ugens-menu"],
      })
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["threads", "madgruppen"],
      })
    })

    it("invalidates with correct slugs for different subgroup and thread", () => {
      invalidateCacheForLink(queryClient, "/forum/boliggruppen/traad/ny-aftale")
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["thread", "boliggruppen", "ny-aftale"],
      })
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["threads", "boliggruppen"],
      })
    })

    it("only calls invalidateQueries twice for forum links (no other invalidations)", () => {
      invalidateCacheForLink(queryClient, "/forum/a/traad/b")
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    })
  })

  describe("announcement links", () => {
    it("invalidates announcements for /opslag prefix", () => {
      invalidateCacheForLink(queryClient, "/opslag")
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["announcements"],
      })
    })

    it("invalidates announcements for a specific opslag path", () => {
      invalidateCacheForLink(queryClient, "/opslag/vigtigt-opslag")
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["announcements"],
      })
    })

    it("only calls invalidateQueries once for opslag links", () => {
      invalidateCacheForLink(queryClient, "/opslag/abc")
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    })
  })

  describe("food links", () => {
    it("invalidates food for /mad/ prefix", () => {
      invalidateCacheForLink(queryClient, "/mad/uge/2026-10")
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["food"],
      })
    })

    it("only calls invalidateQueries once for food links", () => {
      invalidateCacheForLink(queryClient, "/mad/noget")
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    })
  })

  describe("unrecognised links", () => {
    it("does not call invalidateQueries for an unknown link", () => {
      invalidateCacheForLink(queryClient, "/kalender")
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    })

    it("does not match /mad without trailing slash", () => {
      invalidateCacheForLink(queryClient, "/mad")
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    })
  })
})
