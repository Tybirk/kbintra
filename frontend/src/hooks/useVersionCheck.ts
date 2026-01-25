import { useEffect, useRef } from "react"

// Injected at build time by Vite
declare const __APP_VERSION__: string

const CURRENT_VERSION = __APP_VERSION__

/**
 * Hook that checks for app updates when the window becomes visible.
 * Forces a hard reload when a new version is detected.
 * This is especially important for iOS PWAs which don't auto-update reliably.
 */
export function useVersionCheck() {
  const lastCheckRef = useRef<number>(0)
  const MIN_CHECK_INTERVAL = 60_000 // Don't check more than once per minute

  useEffect(() => {
    async function checkVersion() {
      // Rate limit checks
      const now = Date.now()
      if (now - lastCheckRef.current < MIN_CHECK_INTERVAL) {
        return
      }
      lastCheckRef.current = now

      try {
        // Fetch with cache-busting query param
        const response = await fetch(`/version.json?t=${now}`)
        if (!response.ok) return

        const data = await response.json()
        const serverVersion = data.version as string

        if (serverVersion && serverVersion !== CURRENT_VERSION) {
          console.log(
            `New version detected: ${serverVersion} (current: ${CURRENT_VERSION})`
          )

          // Try to update service worker first
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.getRegistration()
            if (registration) {
              await registration.update()
            }
          }

          // Force hard reload to bypass all caches
          window.location.reload()
        }
      } catch (error) {
        // Silently fail - don't break the app if version check fails
        console.debug("Version check failed:", error)
      }
    }

    // Check when tab becomes visible
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkVersion()
      }
    }

    // Check on initial load (after a delay to not slow down startup)
    const initialCheckTimer = setTimeout(checkVersion, 5000)

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearTimeout(initialCheckTimer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])
}
