import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { act, screen, waitFor, within } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render, mockUser } from "../test/testUtils"

import MessagesPage from "./MessagesPage"

import { useAuthStore } from "../store/authStore"

import { messagingApi, chatWs } from "../api/messaging"

import { apiClient } from "../api/client"

import { saveDraft } from "../utils/draftStorage"

import { Route, Routes } from "react-router-dom"

import type { Conversation, Message, Participant, Poll, User } from "../types"

// Mock the messaging API

vi.mock("../api/messaging", () => ({
  messagingApi: {
    getConversations: vi.fn(),

    getConversation: vi.fn(),

    createConversation: vi.fn(),

    getMessages: vi.fn(),

    sendMessage: vi.fn(),

    sendPoll: vi.fn(),

    markAsRead: vi.fn(),

    getUnreadCount: vi.fn(),
  },

  chatWs: {
    connect: vi.fn(),

    disconnect: vi.fn(),

    onConnectionChange: vi.fn().mockReturnValue(vi.fn()),

    onMessage: vi.fn().mockReturnValue(vi.fn()),

    sendMessage: vi.fn(),

    markRead: vi.fn(),

    joinConversation: vi.fn(),

    isConnected: false,
  },
}))

// Mock apiClient for user fetching

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),
  },

  getAccessToken: vi.fn().mockReturnValue("mock-token"),
}))

// Mock notifications

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },

  Notifications: () => null,
}))

const mockUsers: User[] = [
  {
    id: 2,

    email: "alice@example.com",

    first_name: "Alice",

    last_name: "Smith",

    phone_number: "",

    birthdate: null,

    profile_picture: null,

    bio: "",

    house: 1,

    house_name: "House 1",

    house_inhabitant_count: 2,

    is_staff: false,

    date_joined: "2024-01-01T00:00:00Z",
  },

  {
    id: 3,

    email: "bob@example.com",

    first_name: "Bob",

    last_name: "Johnson",

    phone_number: "",

    birthdate: null,

    profile_picture: null,

    bio: "",

    house: 2,

    house_name: "House 2",

    house_inhabitant_count: 1,

    is_staff: false,

    date_joined: "2024-01-02T00:00:00Z",
  },

  {
    id: 4,

    email: "carol@example.com",

    first_name: "Carol",

    last_name: "Williams",

    phone_number: "",

    birthdate: null,

    profile_picture: null,

    bio: "",

    house: 3,

    house_name: "House 3",

    house_inhabitant_count: 3,

    is_staff: false,

    date_joined: "2024-01-03T00:00:00Z",
  },
]

const mockConversation: Conversation = {
  id: 1,

  participants: [
    { id: 1, first_name: "Test", last_name: "User", profile_picture: null },

    { id: 2, first_name: "Alice", last_name: "Smith", profile_picture: null },
  ],

  other_participants: [
    { id: 2, first_name: "Alice", last_name: "Smith", profile_picture: null },
  ],

  last_message: {
    id: 1,

    content: "Hello!",

    created_at: "2024-01-15T12:00:00Z",

    sender_id: 2,
  },

  unread_count: 0,

  created_at: "2024-01-15T10:00:00Z",
}

const mockGroupConversation: Conversation = {
  id: 2,

  participants: [
    { id: 1, first_name: "Test", last_name: "User", profile_picture: null },

    { id: 2, first_name: "Alice", last_name: "Smith", profile_picture: null },

    { id: 3, first_name: "Bob", last_name: "Johnson", profile_picture: null },
  ],

  other_participants: [
    { id: 2, first_name: "Alice", last_name: "Smith", profile_picture: null },

    { id: 3, first_name: "Bob", last_name: "Johnson", profile_picture: null },
  ],

  last_message: {
    id: 2,

    content: "Group message",

    created_at: "2024-01-15T14:00:00Z",

    sender_id: 3,
  },

  unread_count: 1,

  created_at: "2024-01-15T11:00:00Z",
}

// Mounted under the same route as in App.tsx, so /beskeder/ny and
// /beskeder/<id> reach the page as they do in the app.
const renderMessagesPage = (path = "/beskeder") =>
  render(
    <Routes>
      <Route path="/beskeder/:conversationId?" element={<MessagesPage />} />
    </Routes>,
    { initialEntries: [path] },
  )

describe("MessagesPage", () => {
  afterEach(async () => {
    // Choosing a recipient saves an encrypted draft asynchronously. Let that
    // land and then drop it, so it can't restore into the next test.
    await new Promise((resolve) => setTimeout(resolve, 50))

    localStorage.clear()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Drafts of an unsent message live in localStorage; start every test clean.
    localStorage.clear()

    useAuthStore.setState({
      user: mockUser,

      isAuthenticated: true,

      isLoading: false,

      error: null,
    })

    vi.mocked(messagingApi.getConversations).mockResolvedValue([])
  })

  it("should render messages page with new message button", async () => {
    renderMessagesPage()

    expect(screen.getByText("Beskeder")).toBeInTheDocument()

    expect(
      screen.getByRole("button", { name: /ny besked/i }),
    ).toBeInTheDocument()
  })

  it("should show empty state when no conversations", async () => {
    renderMessagesPage()

    await waitFor(() => {
      expect(screen.getByText("Ingen samtaler endnu")).toBeInTheDocument()
    })
  })

  it("should display conversations list", async () => {
    vi.mocked(messagingApi.getConversations).mockResolvedValue([
      mockConversation,
    ])

    renderMessagesPage()

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
  })

  describe("Group conversations display", () => {
    it("should display group conversation with multiple names", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([
        mockGroupConversation,
      ])

      renderMessagesPage()

      await waitFor(() => {
        expect(screen.getByText("Alice, Bob")).toBeInTheDocument()
      })
    })

    it("should show sender name prefix in group chat message preview", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([
        mockGroupConversation,
      ])

      renderMessagesPage()

      await waitFor(() => {
        expect(screen.getByText(/Bob:/)).toBeInTheDocument()
      })
    })

    it("should show unread badge for group conversations", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([
        mockGroupConversation,
      ])

      renderMessagesPage()

      await waitFor(() => {
        expect(screen.getByText("1")).toBeInTheDocument()
      })
    })
  })

  describe("New Conversation Area", () => {
    beforeEach(() => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUsers })
    })

    it("should show inline compose area when clicking new message button", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        // Should show "Til:" label for recipient selection

        expect(screen.getByText("Til:")).toBeInTheDocument()
      })
    })

    it("should show search input with placeholder", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })
    })

    it("should display users in search results when focused", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      // Focus on search input to show dropdown

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()

        expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
      })
    })

    it("should filter users by search", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.type(searchInput, "bob")

      await waitFor(() => {
        expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
      })

      expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument()
    })

    it("should select user and show as badge", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Click to select Alice

      await user.click(screen.getByText("Alice Smith"))

      // Should show as badge with first name

      await waitFor(() => {
        // Badge shows first name "Alice"

        expect(screen.getByText("Alice")).toBeInTheDocument()
      })
    })

    it("should allow selecting multiple users", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice

      await user.click(screen.getByText("Alice Smith"))

      // Search for Bob

      const updatedSearchInput = screen.getByPlaceholderText(/tilføj flere/i)

      await user.type(updatedSearchInput, "bob")

      await waitFor(() => {
        expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
      })

      // Select Bob

      await user.click(screen.getByText("Bob Johnson"))

      // Both should appear as badges

      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument()

        expect(screen.getByText("Bob")).toBeInTheDocument()
      })
    })

    it("should show group conversation info when multiple users selected", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice

      await user.click(screen.getByText("Alice Smith"))

      // Should show single conversation message

      await waitFor(() => {
        expect(screen.getByText(/Ny samtale med Alice/i)).toBeInTheDocument()
      })

      // Search for and select Bob

      const updatedSearchInput = screen.getByPlaceholderText(/tilføj flere/i)

      await user.type(updatedSearchInput, "bob")

      await waitFor(() => {
        expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
      })

      await user.click(screen.getByText("Bob Johnson"))

      // Should now show group conversation message

      await waitFor(() => {
        expect(
          screen.getByText(/Gruppesamtale med 2 personer/i),
        ).toBeInTheDocument()
      })
    })

    it("should show hint about adding multiple people", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice

      await user.click(screen.getByText("Alice Smith"))

      // Should show hint about adding more people

      await waitFor(() => {
        expect(screen.getByText(/tilføje flere personer/i)).toBeInTheDocument()
      })
    })

    it("should not show already selected users in search results", async () => {
      const user = userEvent.setup()

      renderMessagesPage()

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/søg efter personer/i),
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg efter personer/i)

      await user.click(searchInput)

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice

      await user.click(screen.getByText("Alice Smith"))

      // Search for alice again

      const updatedSearchInput = screen.getByPlaceholderText(/tilføj flere/i)

      await user.type(updatedSearchInput, "alice")

      // Since Alice is the only user matching "alice" and she's selected,

      // the search results should show "Ingen brugere fundet"

      await waitFor(() => {
        expect(screen.getByText("Ingen brugere fundet")).toBeInTheDocument()
      })
    })
  })

  describe("Sender names", () => {
    const alice: Participant = mockGroupConversation.other_participants[0]

    const bob: Participant = mockGroupConversation.other_participants[1]

    const makeMessage = (id: number, sender: Participant): Message => ({
      id,

      conversation: 2,

      sender,

      content: `Besked ${id}`,

      is_own: sender.id === mockUser.id,

      is_read: true,

      is_system_message: false,

      is_deleted: false,

      edited_at: null,

      created_at: `2024-01-15T14:0${id}:00Z`,

      attachments: [],
    })

    const renderConversation = (conversation: Conversation) => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([conversation])

      vi.mocked(messagingApi.getConversation).mockResolvedValue(conversation)

      return renderMessagesPage(`/beskeder/${conversation.id}`)
    }

    it("names the sender once per run of incoming messages in a group chat", async () => {
      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: [
          makeMessage(1, alice),
          makeMessage(2, alice),
          makeMessage(3, bob),
        ],

        has_more: false,
      })

      renderConversation(mockGroupConversation)

      await waitFor(() => {
        expect(screen.getByText("Besked 3")).toBeInTheDocument()
      })

      const aliceLinks = screen.getAllByRole("link", { name: "Alice" })

      expect(aliceLinks).toHaveLength(1)

      expect(aliceLinks[0]).toHaveAttribute("href", "/profil/2")

      expect(screen.getByRole("link", { name: "Bob" })).toBeInTheDocument()
    })

    it("names the sender again after a system line of theirs", async () => {
      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: [
          makeMessage(1, alice),
          {
            ...makeMessage(2, alice),
            is_system_message: true,
            content: "Alice omdøbte samtalen",
          },
          makeMessage(3, alice),
        ],

        has_more: false,
      })

      renderConversation(mockGroupConversation)

      await waitFor(() => {
        expect(screen.getByText("Besked 3")).toBeInTheDocument()
      })

      expect(screen.getAllByRole("link", { name: "Alice" })).toHaveLength(2)
    })

    it("shows the thumbnail, not the original, in the bubble", async () => {
      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: [
          {
            ...makeMessage(1, alice),

            attachments: [
              {
                id: 7,

                name: "ferie.jpg",

                file: "/media/message_attachments/ferie.jpg",

                file_url: "/media/message_attachments/ferie.jpg?sig=a",

                preview_url: "/media/message_attachments/ferie.jpg?sig=a",

                thumbnail_url: "/media/message_attachments/thumbs/7.jpg?sig=b",

                uploaded_at: "2024-01-15T14:01:00Z",
              },
            ],
          },
        ],

        has_more: false,
      })

      renderConversation(mockGroupConversation)

      const img = await screen.findByAltText("ferie.jpg")

      expect(img).toHaveAttribute(
        "src",
        "/media/message_attachments/thumbs/7.jpg?sig=b",
      )

      expect(img).toHaveAttribute("loading", "lazy")
    })

    it("does not name the sender in a 1:1 chat", async () => {
      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: [makeMessage(1, mockConversation.other_participants[0])],

        has_more: false,
      })

      renderConversation({ ...mockConversation, id: 2 })

      await waitFor(() => {
        expect(screen.getByText("Besked 1")).toBeInTheDocument()
      })

      expect(
        screen.queryByRole("link", { name: "Alice" }),
      ).not.toBeInTheDocument()
    })
  })

  describe("Polls", () => {
    const alice: Participant = mockGroupConversation.other_participants[0]

    const makePoll = (votes: number): Poll => ({
      id: 5,

      question: "Pizza fredag?",

      allow_multiple_votes: false,

      is_anonymous: false,

      allow_others_to_add_options: false,

      options: [
        {
          id: 1,

          text: "Ja",

          order: 0,

          vote_count: votes,

          has_voted: false,

          voters: [],
        },
        {
          id: 2,

          text: "Nej",

          order: 1,

          vote_count: 0,

          has_voted: false,

          voters: [],
        },
      ],

      total_voters: votes,

      is_own: false,

      created_at: "2024-01-15T14:01:00Z",
    })

    const pollMessage: Message = {
      id: 1,

      conversation: 2,

      sender: alice,

      content: "",

      is_own: false,

      is_read: true,

      is_system_message: false,

      is_deleted: false,

      edited_at: null,

      created_at: "2024-01-15T14:01:00Z",

      attachments: [],

      poll: makePoll(0),
    }

    const renderGroupChat = () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([
        mockGroupConversation,
      ])

      vi.mocked(messagingApi.getConversation).mockResolvedValue(
        mockGroupConversation,
      )

      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: [pollMessage],

        has_more: false,
      })

      return renderMessagesPage(`/beskeder/${mockGroupConversation.id}`)
    }

    it("shows a poll message as the poll", async () => {
      renderGroupChat()

      expect(await screen.findByText("Pizza fredag?")).toBeInTheDocument()

      expect(screen.getByText("Ja")).toBeInTheDocument()

      expect(screen.getByText("0 personer har stemt")).toBeInTheDocument()
    })

    it("updates the poll in place when the chat says it changed", async () => {
      renderGroupChat()

      await screen.findByText("Pizza fredag?")

      const onWsMessage = vi.mocked(chatWs.onMessage).mock.calls.at(-1)![0]

      act(() => {
        onWsMessage({
          type: "poll_updated",

          conversation_id: 2,

          message_id: 1,

          poll: makePoll(1),
        })
      })

      expect(await screen.findByText("1 person har stemt")).toBeInTheDocument()
    })

    it("sends a poll from the composer", async () => {
      const user = userEvent.setup()

      vi.mocked(messagingApi.sendPoll).mockResolvedValue(undefined)

      renderGroupChat()

      await screen.findByText("Pizza fredag?")

      await user.click(screen.getByTitle("Opret afstemning"))

      await user.type(
        await screen.findByPlaceholderText("Stil et spørgsmål..."),
        "Grill lørdag?",
      )

      await user.type(screen.getByPlaceholderText("Valgmulighed 1"), "Ja")

      await user.type(screen.getByPlaceholderText("Valgmulighed 2"), "Nej")

      await user.click(screen.getByRole("button", { name: "Send afstemning" }))

      await waitFor(() => {
        expect(messagingApi.sendPoll).toHaveBeenCalledWith(2, {
          question: "Grill lørdag?",

          allow_multiple_votes: false,

          is_anonymous: false,

          allow_others_to_add_options: false,

          options: [{ text: "Ja" }, { text: "Nej" }],
        })
      })
    })
  })

  describe("Who's in a chat", () => {
    const person = (
      id: number,
      firstName: string,
      houseNumber: string,
    ): Participant => ({
      id,

      first_name: firstName,

      last_name: "Hansen",

      profile_picture: null,

      house_number: houseNumber,
    })

    const lars = person(2, "Lars", "22")

    const mette = person(3, "Mette", "7")

    const groupWith = (others: Participant[]): Conversation => ({
      ...mockGroupConversation,

      participants: [mockGroupConversation.participants[0], ...others],

      other_participants: others,
    })

    const wrote = (id: number, sender: Participant): Message => ({
      id,

      conversation: 2,

      sender,

      content: `Besked ${id}`,

      is_own: false,

      is_read: true,

      is_system_message: false,

      is_deleted: false,

      edited_at: null,

      created_at: `2024-01-15T14:0${id}:00Z`,

      attachments: [],
    })

    const openChat = (conversation: Conversation, messages: Message[]) => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([conversation])

      vi.mocked(messagingApi.getConversation).mockResolvedValue(conversation)

      vi.mocked(messagingApi.getMessages).mockResolvedValue({
        results: messages,

        has_more: false,
      })

      return renderMessagesPage(`/beskeder/${conversation.id}`)
    }

    it("titles a chat without a name by first name and house number", async () => {
      openChat(groupWith([lars, mette]), [])

      expect(
        await screen.findByRole("option", {
          name: /Samtale med Lars \(22\), Mette \(7\)/,
        }),
      ).toBeInTheDocument()
    })

    it("puts whoever wrote last first in the header", async () => {
      // The backend's order is from when the chat was opened; Mette has
      // written since, so the header moves her to the front.
      openChat(groupWith([lars, mette]), [wrote(1, lars), wrote(2, mette)])

      expect(
        await screen.findByText("Mette (7), Lars (22)"),
      ).toBeInTheDocument()
    })

    it("shows a fourth person rather than +1", async () => {
      openChat(
        groupWith([lars, mette, person(4, "Ole", "1"), person(5, "Pia", "2")]),
        [],
      )

      await screen.findAllByText(/^Lars \(22\), Mette \(7\), Ole \(1\), Pia/)

      expect(screen.queryByText("+1")).not.toBeInTheDocument()
    })

    it("counts the rest as +N from two more", async () => {
      openChat(
        groupWith([
          lars,
          mette,
          person(4, "Ole", "1"),
          person(5, "Pia", "2"),
          person(6, "Rasmus", "3"),
        ]),
        [],
      )

      expect((await screen.findAllByText("+2")).length).toBeGreaterThan(0)
    })

    it("says who is in it, the reader included, under the title", async () => {
      openChat(groupWith([lars]), [])

      expect(await screen.findByText("Dig og Lars (22)")).toBeInTheDocument()
    })

    it("counts the others in a group under the title", async () => {
      openChat(groupWith([lars, mette]), [])

      expect(await screen.findByText("Dig og 2 andre")).toBeInTheDocument()
    })

    const listItem = () =>
      screen.findByRole("option", { name: /^Samtale med Lars/ })

    it("shows up to three people in the list", async () => {
      openChat(groupWith([lars, mette, person(4, "Ole", "1")]), [])

      const item = await listItem()

      for (const initial of ["L", "M", "O"]) {
        expect(within(item).getByText(initial)).toBeInTheDocument()
      }

      expect(within(item).queryByLabelText(/flere$/)).not.toBeInTheDocument()
    })

    it("fits four people in the list's three places as two and +2", async () => {
      // The header has room for all four; the list is narrower (bug 24412).
      openChat(
        groupWith([lars, mette, person(4, "Ole", "1"), person(5, "Pia", "2")]),
        [],
      )

      const item = await listItem()

      expect(within(item).getByText("L")).toBeInTheDocument()

      expect(within(item).getByText("M")).toBeInTheDocument()

      expect(within(item).queryByText("O")).not.toBeInTheDocument()

      expect(within(item).getByLabelText("2 flere")).toHaveTextContent("+2")
    })

    it("says when the last message came in a few letters", async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()

      openChat(
        {
          ...groupWith([lars, mette]),

          last_message: {
            id: 2,

            content: "Group message",

            created_at: fiveMinutesAgo,

            sender_id: 2,
          },
        },
        [],
      )

      const item = await listItem()

      expect(within(item).getByText("5 min")).toBeInTheDocument()

      expect(within(item).queryByText(/siden/)).not.toBeInTheDocument()
    })
  })

  describe("Unsent new message", () => {
    beforeEach(() => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUsers })
    })

    it("keeps its recipients and text across a reload", async () => {
      const user = userEvent.setup()

      const first = renderMessagesPage(`/beskeder/ny`)

      await user.click(
        await screen.findByPlaceholderText(/søg efter personer/i),
      )

      await user.click(await screen.findByText("Alice Smith"))

      await waitFor(() => {
        expect(screen.getByText("Ny samtale med Alice")).toBeInTheDocument()
      })

      await saveDraft("msg-new", "Halvt skrevet besked")

      first.unmount()

      renderMessagesPage(`/beskeder/ny`)

      expect(
        await screen.findByText("Ny samtale med Alice"),
      ).toBeInTheDocument()

      expect(
        await screen.findByText("Kladde gendannet automatisk"),
      ).toBeInTheDocument()

      expect(
        screen.getByDisplayValue("Halvt skrevet besked"),
      ).toBeInTheDocument()
    })

    it("clears the recipients too when the reader clears the draft", async () => {
      const user = userEvent.setup()

      const first = renderMessagesPage(`/beskeder/ny`)

      await user.click(
        await screen.findByPlaceholderText(/søg efter personer/i),
      )

      await user.click(await screen.findByText("Alice Smith"))

      await saveDraft("msg-new", "Halvt skrevet besked")

      await waitFor(() => {
        expect(screen.getByText("Ny samtale med Alice")).toBeInTheDocument()
      })

      first.unmount()

      renderMessagesPage(`/beskeder/ny`)

      await screen.findByText("Kladde gendannet automatisk")

      await user.click(screen.getByText("(ryd)"))

      await waitFor(() => {
        expect(
          screen.queryByText("Ny samtale med Alice"),
        ).not.toBeInTheDocument()
      })
    })

    it("opens the compose view from its URL", async () => {
      renderMessagesPage(`/beskeder/ny`)

      expect(await screen.findByText("Til:")).toBeInTheDocument()
    })
  })
})
