import { useMemo } from "react"

import {
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"

import { messagingApi } from "../api/messaging"

import type { Message, MessagePage } from "../types"

/**
 * A conversation's messages, loaded a page at a time from the newest backwards.
 *
 * They live in their own cache, apart from the conversation detail, so that
 * older history can be prepended without the next refetch dropping it. Every
 * change to a message goes through the helpers below.
 */

type MessagePages = InfiniteData<MessagePage, number | undefined>

export const conversationMessagesKey = (conversationId: number) => [
  "conversation-messages",
  conversationId,
]

export function useConversationMessages(conversationId: number) {
  const query = useInfiniteQuery({
    queryKey: conversationMessagesKey(conversationId),

    queryFn: ({ pageParam }) =>
      messagingApi.getMessages(conversationId, pageParam),

    initialPageParam: undefined as number | undefined,

    // Pages run newest to oldest; the next one ends before the oldest loaded message.
    getNextPageParam: (page) =>
      page.has_more ? page.results[0]?.id : undefined,
  })

  const messages = useMemo(
    () => [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.results),
    [query.data],
  )

  return {
    messages,

    isLoading: query.isLoading,

    hasOlder: query.hasNextPage,

    isLoadingOlder: query.isFetchingNextPage,

    loadOlder: query.fetchNextPage,
  }
}

/** Add a newly arrived message, unless it is already there. */
export function appendMessage(
  queryClient: QueryClient,

  conversationId: number,

  message: Message,
) {
  queryClient.setQueryData<MessagePages>(
    conversationMessagesKey(conversationId),

    (old) => {
      if (!old?.pages.length) return old

      if (old.pages.some((p) => p.results.some((m) => m.id === message.id))) {
        return old
      }

      const [newest, ...older] = old.pages

      return {
        ...old,

        pages: [{ ...newest, results: [...newest.results, message] }, ...older],
      }
    },
  )
}

/** Patch one message in place; every other message keeps its identity. */
export function updateMessage(
  queryClient: QueryClient,

  conversationId: number,

  messageId: number,

  patch: Partial<Message>,
) {
  queryClient.setQueryData<MessagePages>(
    conversationMessagesKey(conversationId),

    (old) =>
      old && {
        ...old,

        pages: old.pages.map((page) =>
          page.results.some((m) => m.id === messageId)
            ? {
                ...page,

                results: page.results.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m,
                ),
              }
            : page,
        ),
      },
  )
}
