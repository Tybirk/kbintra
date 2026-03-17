import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"

import { notificationsApi } from "../api/notifications"
import { useAuthStore } from "../store/authStore"
import {
  isPushSupported,
  getCurrentPushSubscription,
  getPushOptedOut,
  subscribeToPushNotifications,
} from "../utils/pushNotifications"

/** Minimum interval (ms) between automatic re-syncs to avoid spamming the backend. */
const DEBOUNCE_MS = 30_000

async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported()) return
  if (Notification.permission !== "granted") return

  try {
    const subscription = await getCurrentPushSubscription()

    if (subscription) {
      // Subscription exists in browser — re-register with backend
      // to ensure backend has the current endpoint (it may have changed)
      const { created } = await notificationsApi.subscribePush(subscription)
      if (created) {
        console.warn(
          "[PushSync] Backend created a new subscription — previous one was likely deleted as dead",
        )
      }
    } else {
      // Permission granted but no subscription. If the user explicitly opted
      // out, respect that. Otherwise it was likely a force-close that killed
      // the subscription — re-subscribe automatically.
      if (getPushOptedOut()) return
      const result = await subscribeToPushNotifications()
      if (!result) {
        console.warn(
          "[PushSync] Re-subscribe returned falsy — push may not be working",
        )
      }
    }
  } catch (error) {
    // Don't break the app if sync fails
    console.warn("[PushSync] Failed to sync push subscription:", error)
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
 * Re-syncs on:
 * - Initial mount (delayed 5 s)
 * - visibilitychange → visible (app returns to foreground)
 * - pageshow (iOS PWA bfcache resume)
 * - PUSH_SUBSCRIPTION_CHANGED message from the service worker
 *
 * All automatic triggers are debounced to at most once per 30 s;
 * the SW "subscription changed" event bypasses the debounce because
 * it represents a known real change.
 */
export function usePushSubscriptionSync() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const lastSyncRef = useRef<number>(0)

  useEffect(() => {
    // Don't sync push subscriptions when not authenticated — API calls would
    // trigger a 401 → token refresh → redirect loop on the login page.
    if (!isAuthenticated) return
    /** Run syncPushSubscription respecting the debounce window. */
    function debouncedSync() {
      const now = Date.now()
      if (now - lastSyncRef.current < DEBOUNCE_MS) return
      lastSyncRef.current = now
      syncPushSubscription()
    }

    /** Unconditional sync (bypasses debounce). */
    function immediateSync() {
      lastSyncRef.current = Date.now()
      syncPushSubscription()
    }

    // Sync on startup (delayed to avoid slowing down app init)
    const timer = setTimeout(() => {
      lastSyncRef.current = Date.now()
      syncPushSubscription()
    }, 5000)

    // Re-sync when the app returns to foreground
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        debouncedSync()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    // iOS PWA bfcache resume
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        debouncedSync()
      }
    }
    window.addEventListener("pageshow", handlePageShow)

    // Re-sync when the SW notifies us of a subscription change.
    // Also handle NAVIGATE messages sent by the SW on notification click —
    // this ensures the PWA navigates to the right page even when Firefox
    // focuses a regular browser tab instead of the PWA window.
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        console.debug("[PushSync] SW reported subscription change, re-syncing")
        immediateSync()
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
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("pageshow", handlePageShow)
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage)
    }
  }, [navigate, isAuthenticated])
}
