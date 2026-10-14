import type { QueryClient } from "@tanstack/react-query"

/** Invalidate cached queries relevant to a notification link so navigating shows fresh data. */

export function invalidateCacheForLink(queryClient: QueryClient, link: string) {
  // The slug stops at a #post-N or ?query, or the key never matches the cache.
  const forumMatch = link.match(/^\/forum\/([^/]+)\/traad\/([^/?#]+)/)

  if (forumMatch) {
    const [, subgroupSlug, threadSlug] = forumMatch

    queryClient.invalidateQueries({
      queryKey: ["thread", subgroupSlug, threadSlug],
    })

    queryClient.invalidateQueries({ queryKey: ["threads", subgroupSlug] })

    return
  }

  // An event (older notifications link event threads this way). If the event
  // has a thread the page redirects to it, and the link doesn't say which: every
  // cached thread goes stale, and only the one on screen refetches.
  const eventMatch = link.match(/^\/kalender\/([^/?#]+)/)

  if (eventMatch) {
    queryClient.invalidateQueries({ queryKey: ["event", eventMatch[1]] })

    queryClient.invalidateQueries({ queryKey: ["thread"] })

    return
  }

  if (link.startsWith("/opslag")) {
    queryClient.invalidateQueries({ queryKey: ["announcements"] })

    return
  }

  if (link.startsWith("/mad/")) {
    queryClient.invalidateQueries({ queryKey: ["food"] })

    return
  }

  if (link.startsWith("/bildeling")) {
    queryClient.invalidateQueries({ queryKey: ["carsharing"] })
  }
}
