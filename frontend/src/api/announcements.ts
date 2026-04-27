/**
 * Announcements API functions
 */

import { apiClient } from "./client"
import { asArray } from "./helpers"

import type { Announcement, CreateAnnouncementData } from "../types"

export const announcementsApi = {
  getAnnouncements: async (
    includeInactive = false,

    dashboardOnly = false,
  ): Promise<Announcement[]> => {
    const params: Record<string, string> = {}

    if (includeInactive) params.is_active = "false"

    if (dashboardOnly) params.dashboard_only = "true"

    const response = await apiClient.get("/announcements/", { params })

    return asArray(response.data)
  },

  getAnnouncement: async (id: number): Promise<Announcement> => {
    const response = await apiClient.get(`/announcements/${id}/`)

    return response.data
  },

  createAnnouncement: async (
    data: CreateAnnouncementData,

    attachments?: File[],
  ): Promise<Announcement> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData()

      formData.append("title", data.title)

      formData.append("content", data.content)

      if (data.is_active !== undefined) {
        formData.append("is_active", String(data.is_active))
      }

      if (data.priority !== undefined) {
        formData.append("priority", String(data.priority))
      }

      attachments.forEach((file) => {
        formData.append("attachments", file)
      })

      // Don't set Content-Type header - let browser set it with boundary

      const response = await apiClient.post("/announcements/", formData, {
        headers: {
          "Content-Type": undefined,
        },
      })

      return response.data
    }

    const response = await apiClient.post("/announcements/", data)

    return response.data
  },

  updateAnnouncement: async (
    id: number,

    data: Partial<CreateAnnouncementData>,
  ): Promise<Announcement> => {
    const response = await apiClient.patch(`/announcements/${id}/`, data)

    return response.data
  },

  deleteAnnouncement: async (id: number): Promise<void> => {
    await apiClient.delete(`/announcements/${id}/`)
  },
}
