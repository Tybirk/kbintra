/**
 * Notifications API functions
 */

import { apiClient } from "./client"
import type {
  Notification,
  NotificationPreference,
  UpdateNotificationPreferenceData,
} from "../types"

export const notificationsApi = {
  // Get all notifications
  getNotifications: async (): Promise<Notification[]> => {
    const response = await apiClient.get("/notifications/")
    return response.data.results ?? response.data
  },

  // Get single notification
  getNotification: async (id: number): Promise<Notification> => {
    const response = await apiClient.get(`/notifications/${id}/`)
    return response.data
  },

  // Delete notification
  deleteNotification: async (id: number): Promise<void> => {
    await apiClient.delete(`/notifications/${id}/`)
  },

  // Mark notifications as read
  markAsRead: async (notificationIds?: number[]): Promise<{
    marked_read: number
  }> => {
    const response = await apiClient.post("/notifications/mark-read/", {
      notification_ids: notificationIds,
    })
    return response.data
  },

  // Mark all unread notifications for a specific link path as read
  markReadByLink: async (link: string): Promise<{ marked_read: number }> => {
    const response = await apiClient.post("/notifications/mark-read-by-link/", {
      link,
    })
    return response.data
  },

  // Get unread count
  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    const response = await apiClient.get("/notifications/unread-count/")
    return response.data
  },

  // Clear all notifications
  clearAll: async (): Promise<{ deleted: number }> => {
    const response = await apiClient.delete("/notifications/clear-all/")
    return response.data
  },

  // Get notification preferences
  getPreferences: async (): Promise<NotificationPreference> => {
    const response = await apiClient.get("/notifications/preferences/")
    return response.data
  },

  // Update notification preferences
  updatePreferences: async (
    data: UpdateNotificationPreferenceData,
  ): Promise<NotificationPreference> => {
    const response = await apiClient.patch("/notifications/preferences/", data)
    return response.data
  },

  // Get VAPID public key for push notifications
  getVapidPublicKey: async (): Promise<{ public_key: string }> => {
    const response = await apiClient.get("/notifications/push/vapid-key/")
    return response.data
  },

  // Subscribe to push notifications
  subscribePush: async (subscription: PushSubscription): Promise<void> => {
    const subscriptionJson = subscription.toJSON()
    await apiClient.post("/notifications/push/subscribe/", {
      endpoint: subscriptionJson.endpoint,
      keys: subscriptionJson.keys,
    })
  },

  // Unsubscribe from push notifications
  unsubscribePush: async (endpoint: string): Promise<void> => {
    await apiClient.delete("/notifications/push/subscribe/", {
      data: { endpoint },
    })
  },

  // Send a test push notification (for debugging)
  testPush: async (delay?: number): Promise<TestPushResult> => {
    const response = await apiClient.post("/notifications/push/test/", {
      delay: delay ?? 0,
    })
    return response.data
  },
}

export interface TestPushResult {
  configured: boolean
  subscription_count: number
  scheduled?: boolean
  delay?: number
  message?: string
  subscriptions?: Array<{
    id: number
    endpoint_domain: string
    created_at: string
  }>
  result?: {
    total: number
    success_ids: number[]
    expired_ids: number[]
    failed_ids: number[]
  }
  error?: string
}
