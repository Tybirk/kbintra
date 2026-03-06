import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { render, mockUser } from "../test/testUtils"
import FoodPage from "./FoodPage"
import { useAuthStore } from "../store/authStore"

const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tab: undefined }),
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
  Notifications: () => null,
}))

vi.mock("../api/notifications", () => ({
  notificationsApi: {
    markReadByLink: vi.fn().mockResolvedValue(undefined),
  },
}))

const mockGetDriveMenu = vi.fn()
const mockGetRegistrations = vi.fn()
const mockGetMyTickets = vi.fn()
const mockGetTickets = vi.fn()
vi.mock("../api/food", () => ({
  foodApi: {
    getDriveMenu: (...args: unknown[]) => mockGetDriveMenu(...args),
    refreshDriveMenu: vi.fn().mockResolvedValue({}),
    getRegistrations: () => mockGetRegistrations(),
    getMyTickets: () => mockGetMyTickets(),
    getTickets: () => mockGetTickets(),
    createRegistration: vi.fn().mockResolvedValue({}),
    updateRegistration: vi.fn().mockResolvedValue({}),
    deleteRegistration: vi.fn().mockResolvedValue(undefined),
  },
}))

describe("FoodPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    })
    mockGetDriveMenu.mockResolvedValue(null)
    mockGetRegistrations.mockResolvedValue([])
    mockGetMyTickets.mockResolvedValue([])
    mockGetTickets.mockResolvedValue([])
  })

  it("renders page title 'Mad'", async () => {
    render(<FoodPage />)

    await waitFor(() => {
      expect(screen.getByText("Mad")).toBeInTheDocument()
    })
  })

  it("renders Menu og Tilmelding and Billetter tabs", async () => {
    render(<FoodPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /menu og tilmelding/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("tab", { name: /billetter/i }),
      ).toBeInTheDocument()
    })
  })

  it("does not show admin tab for regular user", async () => {
    render(<FoodPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /menu og tilmelding/i }),
      ).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("tab", { name: /admin/i }),
    ).not.toBeInTheDocument()
  })

  it("shows admin tab for staff user", async () => {
    useAuthStore.setState({
      user: { ...mockUser, is_staff: true },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    })
    render(<FoodPage />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /admin/i })).toBeInTheDocument()
    })
  })

  it("shows preferences navigation button", async () => {
    render(<FoodPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^præferencer$/i }),
      ).toBeInTheDocument()
    })
  })

  it("clicking preferences navigates to preferences page", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<FoodPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^præferencer$/i }),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /^præferencer$/i }))

    expect(mockNavigate).toHaveBeenCalledWith("/mad/praeferencer")
  })
})
