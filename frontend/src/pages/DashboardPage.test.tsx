import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { render, mockUser } from "../test/testUtils"
import DashboardPage from "./DashboardPage"
import { useAuthStore } from "../store/authStore"

// Mock the navigation
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

// Mock the API modules
vi.mock("../api/announcements", () => ({
  announcementsApi: {
    getAnnouncements: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("../api/events", () => ({
  eventsApi: {
    getUpcomingEvents: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("../api/notifications", () => ({
  notificationsApi: {
    getNotifications: vi.fn().mockResolvedValue([]),
  },
}))

// We'll mock usersApi per test
const mockGetUpcomingBirthdays = vi.fn()
vi.mock("../api/users", () => ({
  usersApi: {
    getUpcomingBirthdays: () => mockGetUpcomingBirthdays(),
  },
}))

// Mock forum API
const mockGetRecentActivity = vi.fn()
vi.mock("../api/forum", () => ({
  forumApi: {
    getRecentActivity: () => mockGetRecentActivity(),
  },
}))

// Mock food API - now uses DriveMenu
const mockGetDriveMenu = vi.fn()
const mockGetRegistrations = vi.fn()
vi.mock("../api/food", () => ({
  foodApi: {
    getDriveMenu: (...args: unknown[]) => mockGetDriveMenu(...args),
    getRegistrations: () => mockGetRegistrations(),
    createRegistration: vi.fn().mockResolvedValue({}),
    updateRegistration: vi.fn().mockResolvedValue({}),
  },
}))

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set authenticated user
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    })
    // Default: no birthdays
    mockGetUpcomingBirthdays.mockResolvedValue([])
    // Default: no recent activity
    mockGetRecentActivity.mockResolvedValue([])
    // Default: no food menus/registrations
    mockGetDriveMenu.mockResolvedValue(null)
    mockGetRegistrations.mockResolvedValue([])
  })

  it("should render welcome message", async () => {
    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/velkommen, test!/i)).toBeInTheDocument()
    })
  })

  it("should render the page structure", async () => {
    render(<DashboardPage />)

    await waitFor(() => {
      // Welcome message should always be there
      expect(screen.getByText(/velkommen/i)).toBeInTheDocument()
    })
    // Subtitle question
    expect(screen.getByText(/hvad vil du lave i dag/i)).toBeInTheDocument()
  })

  // Recent Forum Activity Tests
  it("should show empty message when no forum activity", async () => {
    mockGetRecentActivity.mockResolvedValue([])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(
        screen.getByText("Ingen forumaktivitet endnu."),
      ).toBeInTheDocument()
    })
  })

  it("should show recent forum activity when available", async () => {
    const activity = [
      {
        id: 1,
        author: {
          id: 2,
          first_name: "Forum",
          last_name: "Poster",
          profile_picture: null,
        },
        content: "<p>This is a test forum post</p>",
        thread_id: 10,
        thread_slug: "test-thread-title",
        thread_title: "Test Thread Title",
        subgroup_slug: "general",
        subgroup_name: "General Discussion",
        created_at: new Date().toISOString(),
      },
    ]
    mockGetRecentActivity.mockResolvedValue(activity)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Forum Poster")).toBeInTheDocument()
    })

    expect(screen.getByText(/test thread title/i)).toBeInTheDocument()
    expect(screen.getByText("General Discussion")).toBeInTheDocument()
    // Content should be displayed (without HTML)
    expect(screen.getByText(/this is a test forum post/i)).toBeInTheDocument()
  })

  // Birthday Tests
  it("should show birthday section", async () => {
    mockGetUpcomingBirthdays.mockResolvedValue([])

    render(<DashboardPage />)

    // Birthday section is always rendered
    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })
  })
})
