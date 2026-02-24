import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { notificationsApi } from "../api/notifications"
import {
  isPushSupported,
  getCurrentPushSubscription,
  subscribeToPushNotifications,
} from "../utils/pushNotifications"

async function syncPushSubscription() {
  if (!isPushSupported()) return
  if (Notification.permission !== "granted") return

  try {
    const subscription = await getCurrentPushSubscription()

    if (subscription) {
      // Subscription exists in browser — re-register with backend
      // to ensure backend has the current endpoint (it may have changed)
      await notificationsApi.subscribePush(subscription)
    } else {
      // Permission granted but no subscription — force-close likely
      // killed it. Re-subscribe from scratch.
      await subscribeToPushNotifications()
    }
  } catch (error) {
    // Don't break the app if sync fails
    console.debug("[PushSync] Failed to sync push subscription:", error)
  }
}

/**
 * Hook that ensures push subscriptions stay valid across app restarts.
 *
 * On Android, force-closing a PWA can invalidate the push subscription.
 * When the app reopens, the service worker re-registers but the old
 * subscription endpoint may be dead. This hook detects that and
 * re-subscribes automatically if the user had previously granted permission.
 *
 * Also listens for PUSH_SUBSCRIPTION_CHANGED messages from the service worker,
 * which fires when the browser rotates the push subscription while the app is open.
 */
export function usePushSubscriptionSync() {
  const navigate = useNavigate()

  useEffect(() => {
    // Sync on startup (delayed to avoid slowing down app init)
    const timer = setTimeout(syncPushSubscription, 5000)

    // Re-sync when the SW notifies us of a subscription change.
    // Also handle NAVIGATE messages sent by the SW on notification click —
    // this ensures the PWA navigates to the right page even when Firefox
    // focuses a regular browser tab instead of the PWA window.
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        console.debug("[PushSync] SW reported subscription change, re-syncing")
        syncPushSubscription()
      } else if (event.data?.type === "NAVIGATE" && event.data.url) {
        try {
          const url = new URL(event.data.url)
          navigate(url.pathname + url.search + url.hash, { replace: false })
        } catch {
          // Malformed URL — ignore
        }
      }
    }
    navigator.serviceWorker?.addEventListener("message", handleSwMessage)

    return () => {
      clearTimeout(timer)
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage)
    }
  }, [navigate])
}
