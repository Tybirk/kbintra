import { useLayoutEffect } from "react"

import { useLocation, useNavigationType } from "react-router-dom"

/**
 * Start every newly opened page at the top.
 *
 * React Router leaves the window where the previous page had it. A page that
 * renders from cache at full height (a thread opened from a push notification
 * while the app was still running) then opens in the middle. Back/forward
 * (POP) is left to the browser, and a link to an anchor (#post-…) is left to
 * the page that owns the anchor.
 */
export function useScrollToTopOnNavigate() {
  const { pathname, hash } = useLocation()

  const navigationType = useNavigationType()

  useLayoutEffect(() => {
    if (navigationType !== "POP" && !hash) window.scrollTo(0, 0)
    // Only a new page counts; a changed hash or query on the same page does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
