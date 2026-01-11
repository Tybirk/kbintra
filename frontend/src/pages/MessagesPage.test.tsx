import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render, mockUser } from "../test/testUtils"
import MessagesPage from "./MessagesPage"
import { useAuthStore } from "../store/authStore"
import { messagingApi } from "../api/messaging"
import { apiClient } from "../api/client"
import type { Conversation, User } from "../types"

// Mock the messaging API
vi.mock("../api/messaging", () => ({
  messagingApi: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    markAsRead: vi.fn(),
    getUnreadCount: vi.fn(),
  },
  ChatWebSocket: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onConnectionChange: vi.fn().mockReturnValue(vi.fn()),
    onMessage: vi.fn().mockReturnValue(vi.fn()),
    sendMessage: vi.fn(),
    markRead: vi.fn(),
    joinConversation: vi.fn(),
  })),
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

describe("MessagesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    })
    vi.mocked(messagingApi.getConversations).mockResolvedValue([])
  })

  it("should render messages page with new message button", async () => {
    render(<MessagesPage />)

    expect(screen.getByText("Beskeder")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /ny besked/i })).toBeInTheDocument()
  })

  it("should show empty state when no conversations", async () => {
    render(<MessagesPage />)

    await waitFor(() => {
      expect(screen.getByText("Ingen samtaler endnu")).toBeInTheDocument()
    })
  })

  it("should display conversations list", async () => {
    vi.mocked(messagingApi.getConversations).mockResolvedValue([mockConversation])

    render(<MessagesPage />)

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
  })

  describe("Group conversations display", () => {
    it("should display group conversation with multiple names", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([mockGroupConversation])

      render(<MessagesPage />)

      await waitFor(() => {
        expect(screen.getByText("Alice, Bob")).toBeInTheDocument()
      })
    })

    it("should show sender name prefix in group chat message preview", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([mockGroupConversation])

      render(<MessagesPage />)

      await waitFor(() => {
        expect(screen.getByText(/Bob:/)).toBeInTheDocument()
      })
    })

    it("should show unread badge for group conversations", async () => {
      vi.mocked(messagingApi.getConversations).mockResolvedValue([mockGroupConversation])

      render(<MessagesPage />)

      await waitFor(() => {
        expect(screen.getByText("1")).toBeInTheDocument()
      })
    })
  })

  describe("NewMessageModal", () => {
    beforeEach(() => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUsers })
    })

    it("should open modal when clicking new message button", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const dialog = screen.getByRole("dialog")
      expect(within(dialog).getByText("Ny besked")).toBeInTheDocument()
    })

    it("should display users in search results", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
        expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
        expect(screen.getByText("Carol Williams")).toBeInTheDocument()
      })
    })

    it("should filter users by search", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText(/søg brugere/i)
      await user.type(searchInput, "bob")

      expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument()
      expect(screen.getByText("Bob Johnson")).toBeInTheDocument()
    })

    it("should select user and show as badge", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Click to select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Should show as badge
      const dialog = screen.getByRole("dialog")
      const badge = within(dialog).getByText("Alice")
      expect(badge).toBeInTheDocument()
    })

    it("should allow selecting multiple users", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Search for Bob (since user list may be hidden after first selection)
      const searchInput = screen.getByPlaceholderText(/tilføj flere/i)
      await user.type(searchInput, "bob")

      // Select Bob
      await user.click(screen.getByText("Bob Johnson"))

      // Both should appear as badges
      const dialog = screen.getByRole("dialog")
      expect(within(dialog).getByText("Alice")).toBeInTheDocument()
      expect(within(dialog).getByText("Bob")).toBeInTheDocument()
    })

    it("should show group conversation button when multiple users selected", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Should show regular start button
      expect(screen.getByRole("button", { name: /start samtale/i })).toBeInTheDocument()

      // Search for and select Bob
      const searchInput = screen.getByPlaceholderText(/tilføj flere/i)
      await user.type(searchInput, "bob")
      await user.click(screen.getByText("Bob Johnson"))

      // Should now show group conversation button
      expect(screen.getByRole("button", { name: /start gruppesamtale \(2\)/i })).toBeInTheDocument()
    })

    it("should show × on badges for removing users", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Badge should have × button
      const dialog = screen.getByRole("dialog")
      await waitFor(() => {
        expect(within(dialog).getByText("Alice")).toBeInTheDocument()
        expect(within(dialog).getByText("×")).toBeInTheDocument()
      })
    })

    it("should not show already selected users in search results", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Search for alice again
      const searchInput = screen.getByPlaceholderText(/tilføj flere/i)
      await user.type(searchInput, "alice")

      // Alice should not appear in results (already selected)
      await waitFor(() => {
        expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument()
      })
      expect(screen.getByText("Ingen brugere fundet")).toBeInTheDocument()
    })

    it("should close modal and reset state on cancel", async () => {
      const user = userEvent.setup()
      render(<MessagesPage />)

      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })

      // Select Alice
      await user.click(screen.getByText("Alice Smith"))

      // Click cancel
      await user.click(screen.getByRole("button", { name: /annuller/i }))

      // Modal should be closed
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })

      // Open again and verify state is reset
      await user.click(screen.getByRole("button", { name: /ny besked/i }))

      await waitFor(() => {
        // Alice should be back in the list, not as a badge
        expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      })
    })
  })
})
