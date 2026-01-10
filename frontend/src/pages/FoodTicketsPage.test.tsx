import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import FoodTicketsPage from "./FoodTicketsPage"
import { foodApi } from "../api/food"

// Mock the food API
vi.mock("../api/food", () => ({
  foodApi: {
    getTickets: vi.fn(),
    getMyTickets: vi.fn(),
    createTicket: vi.fn(),
    claimTicket: vi.fn(),
    releaseTicket: vi.fn(),
    deleteTicket: vi.fn(),
  },
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock notifications
vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
  Notifications: () => null,
}))

const mockAvailableTicket = {
  id: 1,
  owner: {
    id: 2,
    first_name: "John",
    last_name: "Doe",
    profile_picture: null,
    phone_number: "123456789",
  },
  date: "2025-01-15",
  day_name: "Wednesday",
  day_of_week: 2,
  adults_count: 2,
  children_count: 0,
  total_portions: 2,
  meal_type: "meat",
  price: "50.00",
  is_free: false,
  description: "Test ticket",
  is_available: true,
  is_own: false,
  claimed_by: null,
  claimed_at: null,
  created_at: "2025-01-10T10:00:00Z",
}

const mockOwnTicket = {
  ...mockAvailableTicket,
  id: 2,
  is_own: true,
  owner: {
    id: 1,
    first_name: "Me",
    last_name: "User",
    profile_picture: null,
    phone_number: "987654321",
  },
}

const mockClaimedTicket = {
  ...mockAvailableTicket,
  id: 3,
  is_available: false,
  claimed_by: {
    id: 3,
    first_name: "Jane",
    last_name: "Smith",
  },
  claimed_at: "2025-01-11T10:00:00Z",
}

describe("FoodTicketsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(foodApi.getTickets).mockResolvedValue([])
    vi.mocked(foodApi.getMyTickets).mockResolvedValue([])
  })

  it("should render page title and tabs", async () => {
    render(<FoodTicketsPage />)

    expect(screen.getByText("Food Tickets")).toBeInTheDocument()
    expect(screen.getByText(/available/i)).toBeInTheDocument()
    expect(screen.getByText(/my tickets/i)).toBeInTheDocument()
  })

  it("should show back button that navigates to food page", async () => {
    const user = userEvent.setup()
    render(<FoodTicketsPage />)

    const backButton = screen.getByRole("button", { name: /back to food/i })
    await user.click(backButton)

    expect(mockNavigate).toHaveBeenCalledWith("/food")
  })

  it("should show empty state when no available tickets", async () => {
    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText(/no tickets available/i)).toBeInTheDocument()
    })
  })

  it("should display available tickets", async () => {
    vi.mocked(foodApi.getTickets).mockResolvedValue([mockAvailableTicket])

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument()
    })
    expect(screen.getByText("50.00 DKK")).toBeInTheDocument()
    expect(screen.getByText(/2 portions/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /claim/i })).toBeInTheDocument()
  })

  it("should show free badge for free tickets", async () => {
    const freeTicket = { ...mockAvailableTicket, is_free: true, price: "0.00" }
    vi.mocked(foodApi.getTickets).mockResolvedValue([freeTicket])

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText("Free")).toBeInTheDocument()
    })
  })

  it("should allow claiming a ticket", async () => {
    const user = userEvent.setup()
    vi.mocked(foodApi.getTickets).mockResolvedValue([mockAvailableTicket])
    vi.mocked(foodApi.claimTicket).mockResolvedValue({
      ...mockAvailableTicket,
      is_available: false,
    })

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /claim/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /claim/i }))

    await waitFor(() => {
      expect(foodApi.claimTicket).toHaveBeenCalledWith(mockAvailableTicket.id)
    })
  })

  it("should show my tickets tab content", async () => {
    const user = userEvent.setup()
    vi.mocked(foodApi.getMyTickets).mockResolvedValue([mockOwnTicket])

    render(<FoodTicketsPage />)

    // Click on My Tickets tab
    const myTicketsTab = screen.getByRole("tab", { name: /my tickets/i })
    await user.click(myTicketsTab)

    await waitFor(() => {
      expect(screen.getByText("Me User")).toBeInTheDocument()
    })
  })

  it("should show claimed badge for claimed tickets", async () => {
    vi.mocked(foodApi.getTickets).mockResolvedValue([mockClaimedTicket])

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText("Claimed")).toBeInTheDocument()
    })
    expect(screen.getByText(/claimed by jane smith/i)).toBeInTheDocument()
  })

  it("should not show claim button for own tickets", async () => {
    vi.mocked(foodApi.getTickets).mockResolvedValue([
      {
        ...mockAvailableTicket,
        is_own: true,
      },
    ])

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: /claim/i }),
    ).not.toBeInTheDocument()
  })

  it("should have offer ticket button", async () => {
    render(<FoodTicketsPage />)

    expect(
      screen.getByRole("button", { name: /offer ticket/i }),
    ).toBeInTheDocument()
  })

  it("should display ticket counts in tabs", async () => {
    vi.mocked(foodApi.getTickets).mockResolvedValue([
      mockAvailableTicket,
      mockClaimedTicket,
    ])
    vi.mocked(foodApi.getMyTickets).mockResolvedValue([mockOwnTicket])

    render(<FoodTicketsPage />)

    await waitFor(() => {
      expect(screen.getByText(/available \(2\)/i)).toBeInTheDocument()
      expect(screen.getByText(/my tickets \(1\)/i)).toBeInTheDocument()
    })
  })
})
