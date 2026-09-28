import { useEffect, useRef } from "react"

import { useLocation, useNavigationType } from "react-router-dom"

import { holdInView } from "../utils/holdInView"

/**
 * Open a page at the element its URL hash names (`#post-12`,
 * `#announcement-3`): put its top just under the sticky header, keep it there
 * while the page settles, and highlight it for a moment.
 *
 * `ready`: the content that holds the element has rendered. `settled`: it is
 * not being refetched — a cached copy of a thread may not have the reply a
 * notification links to yet, so a missing element only counts as missing once
 * the fresh copy is in. Then a link to something deleted opens the page at the
 * top — arriving from a scrolled page. A POP (a cold start, back/forward, a
 * plain anchor inside a post) is left alone.
 *
 * Each navigation is handled once, so following the same link again works.
 * The hash leaves the address bar through history.replaceState, not the
 * router: a new router entry would make "Tilbage" believe there is history to
 * go back to on a cold start.
 */
export function useHoldHashTarget(ready: boolean, settled: boolean) {
  const location = useLocation()

  const navigationType = useNavigationType()

  const handledKeyRef = useRef<string | null>(null)

  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!ready || !location.hash || handledKeyRef.current === location.key) {
      return
    }

    const el = document.getElementById(
      decodeURIComponent(location.hash.slice(1)),
    )

    if (!el && !settled) return

    handledKeyRef.current = location.key

    if (!el) {
      if (navigationType !== "POP") window.scrollTo(0, 0)

      return
    }

    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    )

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
  }, [ready, settled, location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Let go when leaving, including for another thread on the same route.
  useEffect(() => () => releaseRef.current?.(), [location.pathname])
}
