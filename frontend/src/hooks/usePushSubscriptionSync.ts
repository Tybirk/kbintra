import { useEffect } from "react"

import { notificationsApi } from "../api/notifications"
import {
  isPushSupported,
  getCurrentPushSubscription,
  subscribeToPushNotifications,
} from "../utils/pushNotifications"

/**
 * Hook that ensures push subscriptions stay valid across app restarts.
 *
 * On Android, force-closing a PWA can invalidate the push subscription.
 * When the app reopens, the service worker re-registers but the old
 * subscription endpoint may be dead. This hook detects that and
 * re-subscribes automatically if the user had previously granted permission.
 */
export function usePushSubscriptionSync() {
  useEffect(() => {
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

    // Delay to avoid slowing down app startup
    const timer = setTimeout(syncPushSubscription, 5000)
    return () => clearTimeout(timer)
  }, [])
}
