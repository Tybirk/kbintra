import { useEffect, useRef } from "react"
import { useAuthStore } from "../store/authStore"

// Injected at build time by Vite
declare const __APP_VERSION__: string

const CURRENT_VERSION = __APP_VERSION__

/**
 * Hook that checks for app updates and forces reload when new version is detected.
 * Uses multiple strategies to work reliably on iOS PWAs:
 * - visibilitychange event (when tab becomes visible)
 * - pageshow event (more reliable on iOS when returning to PWA)
 * - focus event (backup)
 * - periodic polling (fallback)
 *
 * Only runs when authenticated — reloading on the login page wipes form inputs.
 */
export function useVersionCheck() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const lastCheckRef = useRef<number>(0)
  const MIN_CHECK_INTERVAL = 30_000 // 30 seconds between checks

  useEffect(() => {
    // Don't run version checks on the login page — reloading clears form inputs
    if (!isAuthenticated) return
    async function checkVersion() {
      // Rate limit checks
      const now = Date.now()
      if (now - lastCheckRef.current < MIN_CHECK_INTERVAL) {
        return
      }
      lastCheckRef.current = now

      try {
        // Fetch with aggressive cache bypass for iOS
        const response = await fetch(`/version.json?_=${now}`, {
          method: "GET",
          cache: "no-store", // Completely bypass HTTP cache
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        })
        if (!response.ok) return

        const data = await response.json()
        const serverVersion = data.version as string

        if (serverVersion && serverVersion !== CURRENT_VERSION) {
          console.log(
            `[VersionCheck] New version detected: ${serverVersion} (current: ${CURRENT_VERSION})`,
          )

          // Clear all caches before reload
          if ("caches" in window) {
            const cacheNames = await caches.keys()
            await Promise.all(cacheNames.map((name) => caches.delete(name)))
            console.log("[VersionCheck] Cleared all caches")
          }

          // Try to update and activate new service worker
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.getRegistration()
            if (registration) {
              await registration.update()
              // If there's a waiting worker, skip waiting
              if (registration.waiting) {
                registration.waiting.postMessage({ type: "SKIP_WAITING" })
              }
            }
          }

          // Small delay to let SW activate, then hard reload
          setTimeout(() => {
            window.location.reload()
          }, 100)
        }
      } catch (error) {
        // Silently fail - don't break the app if version check fails
        console.debug("[VersionCheck] Check failed:", error)
      }
    }

    // Multiple event listeners for iOS reliability
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkVersion()
      }
    }

    // pageshow fires when navigating back to a page (including from bfcache on iOS)
    function handlePageShow(event: PageTransitionEvent) {
      // persisted means it came from bfcache
      if (event.persisted) {
        checkVersion()
      }
    }

    function handleFocus() {
      checkVersion()
    }

    // Check on initial load (after a delay to not slow down startup)
    const initialCheckTimer = setTimeout(checkVersion, 3000)

    // Periodic polling every 5 minutes as fallback
    const pollingInterval = setInterval(checkVersion, 5 * 60 * 1000)

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pageshow", handlePageShow)
    window.addEventListener("focus", handleFocus)

    return () => {
      clearTimeout(initialCheckTimer)
      clearInterval(pollingInterval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pageshow", handlePageShow)
      window.removeEventListener("focus", handleFocus)
    }
  }, [isAuthenticated])
}
