/**
 * Push notification utilities
 */

import { notificationsApi } from "../api/notifications"

/**
 * Convert a base64 string to a Uint8Array (needed for applicationServerKey)
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer
}

/**
 * Check if push notifications are supported
 */
export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/**
 * Get the current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in window)) {
    return "denied"
  }
  return Notification.permission
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    return "denied"
  }
  return await Notification.requestPermission()
}

/**
 * Get the current push subscription
 */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null
  }

  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription()
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPushNotifications(): Promise<boolean> {
  if (!isPushSupported()) {
    console.error("Push notifications not supported")
    return false
  }

  // Request permission first
  const permission = await requestNotificationPermission()
  if (permission !== "granted") {
    console.log("Notification permission denied")
    return false
  }

  try {
    // Get VAPID public key from server
    const { public_key } = await notificationsApi.getVapidPublicKey()
    if (!public_key) {
      console.error("No VAPID public key configured")
      return false
    }

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready

    // Subscribe to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    })

    // Send subscription to server
    await notificationsApi.subscribePush(subscription)
    console.log("Successfully subscribed to push notifications")
    return true
  } catch (error) {
    console.error("Error subscribing to push notifications:", error)
    return false
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPushNotifications(): Promise<boolean> {
  try {
    const subscription = await getCurrentPushSubscription()
    if (!subscription) {
      console.log("No push subscription to unsubscribe")
      return true
    }

    // Unsubscribe from browser
    await subscription.unsubscribe()

    // Remove subscription from server
    await notificationsApi.unsubscribePush(subscription.endpoint)
    console.log("Successfully unsubscribed from push notifications")
    return true
  } catch (error) {
    console.error("Error unsubscribing from push notifications:", error)
    return false
  }
}

/**
 * Check if currently subscribed to push notifications
 */
export async function isPushSubscribed(): Promise<boolean> {
  const subscription = await getCurrentPushSubscription()
  return subscription !== null
}
