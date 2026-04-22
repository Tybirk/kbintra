import { describe, it, expect, vi, beforeEach } from "vitest"

import { notificationsApi } from "./notifications"

import { apiClient } from "./client"

// Mock the apiClient

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),

    patch: vi.fn(),

    delete: vi.fn(),
  },
}))

describe("notificationsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getNotifications", () => {
    it("should fetch paginated notifications", async () => {
      const mockNotifications = [
        { id: 1, message: "New message", is_read: false },

        { id: 2, message: "New post", is_read: true },
      ]

      const paginatedResponse = {
        count: 2,

        next: null,

        previous: null,

        results: mockNotifications,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: paginatedResponse })

      const result = await notificationsApi.getNotifications()

      expect(apiClient.get).toHaveBeenCalledWith("/notifications/", {
        params: { page: 1 },
      })

      expect(result).toEqual(paginatedResponse)
    })

    it("should handle non-paginated response", async () => {
      const mockNotifications = [{ id: 1, message: "Test" }]

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockNotifications })

      const result = await notificationsApi.getNotifications()

      expect(result).toEqual({
        count: 1,

        next: null,

        previous: null,

        results: mockNotifications,
      })
    })
  })

  describe("getNotification", () => {
    it("should fetch single notification", async () => {
      const mockNotification = { id: 1, message: "New message", is_read: false }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockNotification })

      const result = await notificationsApi.getNotification(1)

      expect(apiClient.get).toHaveBeenCalledWith("/notifications/1/")

      expect(result).toEqual(mockNotification)
    })
  })

  describe("deleteNotification", () => {
    it("should delete notification", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await notificationsApi.deleteNotification(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/notifications/1/")
    })
  })

  describe("markAsRead", () => {
    it("should mark all notifications as read", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 10 } })

      const result = await notificationsApi.markAsRead()

      expect(apiClient.post).toHaveBeenCalledWith("/notifications/mark-read/", {
        notification_ids: undefined,
      })

      expect(result).toEqual({ marked_read: 10 })
    })

    it("should mark specific notifications as read", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 3 } })

      const result = await notificationsApi.markAsRead([1, 2, 3])

      expect(apiClient.post).toHaveBeenCalledWith("/notifications/mark-read/", {
        notification_ids: [1, 2, 3],
      })

      expect(result).toEqual({ marked_read: 3 })
    })
  })

  describe("getUnreadCount", () => {
    it("should fetch unread notification count", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { unread_count: 7 } })

      const result = await notificationsApi.getUnreadCount()

      expect(apiClient.get).toHaveBeenCalledWith("/notifications/unread-count/")

      expect(result).toEqual({ unread_count: 7 })
    })

    it("should return zero when no unread notifications", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { unread_count: 0 } })

      const result = await notificationsApi.getUnreadCount()

      expect(result.unread_count).toBe(0)
    })
  })

  describe("clearAll", () => {
    it("should clear all notifications", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: { deleted: 15 } })

      const result = await notificationsApi.clearAll()

      expect(apiClient.delete).toHaveBeenCalledWith("/notifications/clear-all/")

      expect(result).toEqual({ deleted: 15 })
    })
  })

  describe("getPreferences", () => {
    it("should fetch notification preferences", async () => {
      const mockPreferences = {
        email_new_message: true,

        email_new_post: false,

        push_enabled: true,
      }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockPreferences })

      const result = await notificationsApi.getPreferences()

      expect(apiClient.get).toHaveBeenCalledWith("/notifications/preferences/")

      expect(result).toEqual(mockPreferences)
    })
  })

  describe("updatePreferences", () => {
    it("should update notification preferences", async () => {
      const mockPreferences = {
        email_new_message: false,

        email_new_post: true,

        push_enabled: false,
      }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockPreferences })

      const result = await notificationsApi.updatePreferences({
        email_new_message: false,

        push_enabled: false,
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        "/notifications/preferences/",

        {
          email_new_message: false,

          push_enabled: false,
        },
      )

      expect(result).toEqual(mockPreferences)
    })
  })

  describe("markReadByLink", () => {
    it("should post the link to the mark-read-by-link endpoint", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 1 } })

      const result = await notificationsApi.markReadByLink(
        "/forum/general/traad/some-thread",
      )

      expect(apiClient.post).toHaveBeenCalledWith(
        "/notifications/mark-read-by-link/",

        { link: "/forum/general/traad/some-thread" },
      )

      expect(result).toEqual({ marked_read: 1 })
    })

    it("passes a percent-encoded path as-is — the backend is responsible for decoding", async () => {
      // Browsers expose location.pathname with non-ASCII chars percent-encoded

      // (e.g. æ → %C3%A6). The frontend sends whatever pathname it has;

      // MarkNotificationsByLinkView on the backend calls unquote() before matching.

      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 1 } })

      await notificationsApi.markReadByLink(
        "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende",
      )

      expect(apiClient.post).toHaveBeenCalledWith(
        "/notifications/mark-read-by-link/",

        {
          link: "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende",
        },
      )
    })

    it("returns zero when no notifications matched", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 0 } })

      const result = await notificationsApi.markReadByLink("/forum/general")

      expect(result).toEqual({ marked_read: 0 })
    })
  })
})
