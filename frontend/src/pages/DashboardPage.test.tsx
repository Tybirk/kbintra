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
    getNotifications: vi

      .fn()

      .mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
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

const mockGetSubgroups = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    getRecentActivity: () => mockGetRecentActivity(),

    getSubgroups: () => mockGetSubgroups(),
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

    // Default: no subgroups

    mockGetSubgroups.mockResolvedValue([])

    // Default: no food menus/registrations

    mockGetDriveMenu.mockResolvedValue(null)

    mockGetRegistrations.mockResolvedValue([])
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

  // Fælles shortcut buttons

  it("should show both 'Skriv på Fælles' and 'Se Fælles' shortcuts", async () => {
    mockGetSubgroups.mockResolvedValue([
      {
        id: 1,
        name: "Fælles",
        slug: "faelles",
        is_member: false,
        is_subscribed: false,
        unread_thread_count: 0,
        last_activity_at: null,
      },
    ])

    render(<DashboardPage />)

    const writeLink = await screen.findByRole("link", {
      name: /skriv på fælles/i,
    })
    const viewLink = await screen.findByRole("link", { name: /se fælles/i })

    // "Skriv på Fælles" opens the new-thread composer (?nytraad=1)
    expect(writeLink).toHaveAttribute("href", "/forum/faelles?nytraad=1")

    // "Se Fælles" opens the group's thread list (no ?nytraad=1)
    expect(viewLink).toHaveAttribute("href", "/forum/faelles")
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
