import { describe, it, expect } from "vitest"

import { QueryClient, type InfiniteData } from "@tanstack/react-query"

import {
  appendMessage,
  conversationMessagesKey,
  updateMessage,
} from "./useConversationMessages"

import type { Message, MessagePage } from "../types"

const message = (id: number): Message => ({
  id,

  conversation: 1,

  sender: {
    id: 2,
    first_name: "Alice",
    last_name: "Smith",
    profile_picture: null,
  },

  content: `msg ${id}`,

  is_own: false,

  is_read: true,

  is_system_message: false,

  is_deleted: false,

  edited_at: null,

  created_at: "2024-01-15T12:00:00Z",

  attachments: [],
})

type Pages = InfiniteData<MessagePage, number | undefined>

// Pages run newest first: page 0 holds messages 3-4, page 1 the older 1-2.
function seeded() {
  const queryClient = new QueryClient()

  queryClient.setQueryData<Pages>(conversationMessagesKey(1), {
    pages: [
      { results: [message(3), message(4)], has_more: true },

      { results: [message(1), message(2)], has_more: false },
    ],

    pageParams: [undefined, 3],
  })

  const read = () =>
    queryClient.getQueryData<Pages>(conversationMessagesKey(1))!

  return { queryClient, read }
}

describe("appendMessage", () => {
  it("adds a new message to the end of the newest page", () => {
    const { queryClient, read } = seeded()

    appendMessage(queryClient, 1, message(5))

    expect(read().pages[0].results.map((m) => m.id)).toEqual([3, 4, 5])
  })

  it("ignores a message that is already loaded", () => {
    const { queryClient, read } = seeded()

    const before = read()

    appendMessage(queryClient, 1, message(2))

    expect(read()).toBe(before)
  })
})

describe("updateMessage", () => {
  it("patches the message and keeps every other message's identity", () => {
    const { queryClient, read } = seeded()

    const before = read()

    updateMessage(queryClient, 1, 1, { content: "edited" })

    const after = read()

    expect(after.pages[1].results[0].content).toBe("edited")

    expect(after.pages[1].results[1]).toBe(before.pages[1].results[1])

    expect(after.pages[0]).toBe(before.pages[0])
  })
})
