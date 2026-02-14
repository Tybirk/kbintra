import type { QueryClient } from "@tanstack/react-query"

/** Invalidate cached queries relevant to a notification link so navigating shows fresh data. */
export function invalidateCacheForLink(queryClient: QueryClient, link: string) {
  const forumMatch = link.match(/^\/forum\/([^/]+)\/(\d+)/)
  if (forumMatch) {
    const [, slug, threadId] = forumMatch
    queryClient.invalidateQueries({ queryKey: ["thread", Number(threadId)] })
    queryClient.invalidateQueries({ queryKey: ["threads", slug] })
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
