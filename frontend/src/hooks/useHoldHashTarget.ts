import { useEffect, useRef } from "react"

import { useLocation, useNavigate } from "react-router-dom"

import { holdInView } from "../utils/holdInView"

/**
 * Open a page at the element its URL hash names (`#post-12`,
 * `#announcement-3`): put its top just under the sticky header, keep it there
 * while the page settles, and highlight it for a moment. `ready` is true once
 * the content that holds the element has rendered.
 *
 * The hash is consumed through the router, so following the same link again
 * works. A hash that names nothing (a deleted post) opens the page at the top.
 */
export function useHoldHashTarget(ready: boolean) {
  const location = useLocation()

  const navigate = useNavigate()

  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!ready || !location.hash) return

    const el = document.getElementById(
      decodeURIComponent(location.hash.slice(1)),
    )

    navigate(location.pathname + location.search, { replace: true })

    if (!el) {
      window.scrollTo(0, 0)

      return
    }

    el.style.borderRadius = "var(--mantine-radius-md)"

    el.style.transition = "box-shadow 0.3s ease"

    el.style.boxShadow = "0 0 0 3px var(--mantine-color-blue-4)"

    setTimeout(() => {
      el.style.boxShadow = ""
    }, 2000)

    // Held until the reader scrolls or leaves, not until the next refetch —
    // which would let go while images above are still loading.
    releaseRef.current?.()

    releaseRef.current = holdInView(el)
  }, [ready, location.hash]) // eslint-disable-line react-hooks/exhaustive-deps

  // Let go when leaving, including for another thread on the same route.
  useEffect(() => () => releaseRef.current?.(), [location.pathname])
}
