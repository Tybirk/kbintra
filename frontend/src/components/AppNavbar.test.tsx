import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import AppNavbar from "./AppNavbar"
import { messagingApi } from "../api/messaging"
import { notificationsApi } from "../api/notifications"

// Mock the APIs
vi.mock("../api/messaging", () => ({
  messagingApi: {
    getUnreadCount: vi.fn(),
  },
}))

vi.mock("../api/notifications", () => ({
  notificationsApi: {
    getUnreadCount: vi.fn(),
  },
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/" }),
  }
})

describe("AppNavbar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(messagingApi.getUnreadCount).mockResolvedValue({
      unread_count: 0,
    })
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue({
      unread_count: 0,
    })
  })

  it("should render all navigation items", async () => {
    render(<AppNavbar />)

    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Notifications")).toBeInTheDocument()
    expect(screen.getByText("Announcements")).toBeInTheDocument()
    expect(screen.getByText("Forum")).toBeInTheDocument()
    expect(screen.getByText("Food")).toBeInTheDocument()
    expect(screen.getByText("Food Teams")).toBeInTheDocument()
    expect(screen.getByText("Calendar")).toBeInTheDocument()
    expect(screen.getByText("Directory")).toBeInTheDocument()
    expect(screen.getByText("Messages")).toBeInTheDocument()
  })

  it("should navigate when clicking on nav item", async () => {
    const user = userEvent.setup()
    render(<AppNavbar />)

    await user.click(screen.getByText("Forum"))

    expect(mockNavigate).toHaveBeenCalledWith("/forum")
  })

  it("should call onNavigate callback when provided", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<AppNavbar onNavigate={onNavigate} />)

    await user.click(screen.getByText("Calendar"))

    expect(onNavigate).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith("/calendar")
  })

  it("should show unread messages badge", async () => {
    vi.mocked(messagingApi.getUnreadCount).mockResolvedValue({
      unread_count: 5,
    })

    render(<AppNavbar />)

    await waitFor(() => {
      // Find the Messages nav item and check for badge
      const messagesLink = screen.getByText("Messages").closest("a, button")
      expect(messagesLink).toBeInTheDocument()
    })

    // Badge should show the count
    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument()
    })
  })

  it("should show 9+ for more than 9 unread messages", async () => {
    vi.mocked(messagingApi.getUnreadCount).mockResolvedValue({
      unread_count: 15,
    })

    render(<AppNavbar />)

    await waitFor(() => {
      expect(screen.getByText("9+")).toBeInTheDocument()
    })
  })

  it("should show unread notifications badge", async () => {
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue({
      unread_count: 3,
    })

    render(<AppNavbar />)

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument()
    })
  })

  it("should not show badges when counts are zero", async () => {
    vi.mocked(messagingApi.getUnreadCount).mockResolvedValue({
      unread_count: 0,
    })
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue({
      unread_count: 0,
    })

    render(<AppNavbar />)

    await waitFor(() => {
      // Dashboard should be rendered, meaning API calls completed
      expect(screen.getByText("Dashboard")).toBeInTheDocument()
    })

    // No badge elements should be present
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })
})
