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

    // In dev mode version.json doesn't exist (it's generated at build time),

    // so skip version checks to avoid console errors.

    if (import.meta.env.DEV) return

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

        // Guard against non-JSON responses (e.g. HTML error pages)

        const contentType = response.headers.get("content-type") ?? ""

        if (!contentType.includes("application/json")) return

        const data = await response.json()

        const serverVersion = data.version as string

        if (serverVersion && serverVersion !== CURRENT_VERSION) {
          console.log(
            `[VersionCheck] New version detected: ${serverVersion} (current: ${CURRENT_VERSION})`,
          )

          // The caches are left alone: the page comes from the network, and
          // the service worker replaces its precache itself (deleting it
          // here left one device with none).

          window.location.reload()
        }
      } catch {
        // Silently fail - don't break the app if version check fails
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

    // A part of the app that fails to load has usually been removed by a
    // deploy (the PDF viewer isn't precached): check now, not at the next
    // focus or poll.
    function handlePreloadError() {
      lastCheckRef.current = 0

      checkVersion()
    }

    // Check on initial load (after a delay to not slow down startup)

    const initialCheckTimer = setTimeout(checkVersion, 3000)

    // Periodic polling every 5 minutes as fallback

    const pollingInterval = setInterval(checkVersion, 5 * 60 * 1000)

    document.addEventListener("visibilitychange", handleVisibilityChange)

    window.addEventListener("pageshow", handlePageShow)

    window.addEventListener("focus", handleFocus)

    window.addEventListener("vite:preloadError", handlePreloadError)

    return () => {
      clearTimeout(initialCheckTimer)

      clearInterval(pollingInterval)

      document.removeEventListener("visibilitychange", handleVisibilityChange)

      window.removeEventListener("pageshow", handlePageShow)

      window.removeEventListener("focus", handleFocus)

      window.removeEventListener("vite:preloadError", handlePreloadError)
    }
  }, [isAuthenticated])
}
