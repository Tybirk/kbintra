import type { QueryClient } from "@tanstack/react-query"

/** Invalidate cached queries relevant to a notification link so navigating shows fresh data. */
export function invalidateCacheForLink(queryClient: QueryClient, link: string) {
  const forumMatch = link.match(/^\/forum\/([^/]+)\/traad\/([^/]+)/)
  if (forumMatch) {
    const [, subgroupSlug, threadSlug] = forumMatch
    queryClient.invalidateQueries({
      queryKey: ["thread", subgroupSlug, threadSlug],
    })
    queryClient.invalidateQueries({ queryKey: ["threads", subgroupSlug] })
    return
  }
  if (link.startsWith("/opslag")) {
    queryClient.invalidateQueries({ queryKey: ["announcements"] })
    return
  }
  if (link.startsWith("/mad/")) {
    queryClient.invalidateQueries({ queryKey: ["food"] })
  }
}
