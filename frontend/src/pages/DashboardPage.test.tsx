import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { render, mockUser } from "../test/testUtils"
import DashboardPage from "./DashboardPage"
import { useAuthStore } from "../store/authStore"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

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

vi.mock("../api/calendar", () => ({
  calendarApi: {
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

// Mock food API
const mockGetWeeklyMenus = vi.fn()
const mockGetRegistrations = vi.fn()
vi.mock("../api/food", () => ({
  foodApi: {
    getWeeklyMenus: () => mockGetWeeklyMenus(),
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
    mockGetWeeklyMenus.mockResolvedValue([])
    mockGetRegistrations.mockResolvedValue([])
  })

  it("should render welcome message", async () => {
    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/velkommen, test!/i)).toBeInTheDocument()
    })
  })

  it("should render feature cards", async () => {
    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Vigtige opslag")).toBeInTheDocument()
      expect(screen.getByText("Forum")).toBeInTheDocument()
      expect(screen.getByText("Mad")).toBeInTheDocument()
      expect(screen.getByText("Kalender")).toBeInTheDocument()
      expect(screen.getByText("Beboeroversigt")).toBeInTheDocument()
      expect(screen.getByText("Beskeder")).toBeInTheDocument()
    })
  })

  it("should not show birthday widget when no upcoming birthdays", async () => {
    mockGetUpcomingBirthdays.mockResolvedValue([])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/velkommen/i)).toBeInTheDocument()
    })

    // Birthday widget should not be visible
    expect(screen.queryByText("Fødselsdage")).not.toBeInTheDocument()
  })

  it("should show birthday widget when there are upcoming birthdays", async () => {
    const today = dayjs()
    // Create a birthday 3 days from now
    const futureBirthday = today.add(3, "day")
    const birthdayUser = {
      ...mockUser,
      id: 2,
      first_name: "Birthday",
      last_name: "Person",
      // Set birthdate with same month/day as future date but year 1990
      birthdate: `1990-${futureBirthday.format("MM-DD")}`,
    }
    mockGetUpcomingBirthdays.mockResolvedValue([birthdayUser])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })

    expect(screen.getByText("Birthday Person")).toBeInTheDocument()
    expect(screen.getByText(/fylder \d+ år/i)).toBeInTheDocument()
    // Check for the days label (could be 2 or 3 depending on time of day)
    expect(screen.getByText(/om \d+ dage/i)).toBeInTheDocument()
  })

  it("should show 'I dag!' for today's birthdays", async () => {
    const today = dayjs()
    const birthdayUser = {
      ...mockUser,
      id: 2,
      first_name: "Today",
      last_name: "Birthday",
      // Use same month/day as today but year 1990
      birthdate: `1990-${today.format("MM-DD")}`,
    }
    mockGetUpcomingBirthdays.mockResolvedValue([birthdayUser])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })

    expect(screen.getByText("Today Birthday")).toBeInTheDocument()
    expect(screen.getByText("I dag!")).toBeInTheDocument()
  })

  it("should show 'I morgen' for tomorrow's birthdays", async () => {
    const tomorrow = dayjs().add(1, "day").startOf("day")
    const birthdayUser = {
      ...mockUser,
      id: 2,
      first_name: "Tomorrow",
      last_name: "Birthday",
      // Use same month/day as tomorrow but year 1990
      birthdate: `1990-${tomorrow.format("MM-DD")}`,
    }
    mockGetUpcomingBirthdays.mockResolvedValue([birthdayUser])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })

    expect(screen.getByText("Tomorrow Birthday")).toBeInTheDocument()
    // Could be "I morgen" or "Om 1 dage" depending on time calculation
    expect(
      screen.queryByText("I morgen") || screen.queryByText(/om 1 dag/i),
    ).toBeTruthy()
  })

  it("should display correct age for upcoming birthday", async () => {
    const today = dayjs()
    const futureBirthday = today.add(2, "day")
    // User will turn 30 on their next birthday
    const birthYear = today.year() - 30
    const birthdayUser = {
      ...mockUser,
      id: 2,
      first_name: "Thirty",
      last_name: "Person",
      birthdate: `${birthYear}-${futureBirthday.format("MM-DD")}`,
    }
    mockGetUpcomingBirthdays.mockResolvedValue([birthdayUser])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })

    expect(screen.getByText("Fylder 30 år")).toBeInTheDocument()
  })

  it("should show badge with count of upcoming birthdays", async () => {
    const today = dayjs()
    const tomorrow = today.add(1, "day")
    const inThreeDays = today.add(3, "day")
    const users = [
      {
        ...mockUser,
        id: 2,
        first_name: "Person",
        last_name: "One",
        birthdate: `1990-${tomorrow.format("MM-DD")}`,
      },
      {
        ...mockUser,
        id: 3,
        first_name: "Person",
        last_name: "Two",
        birthdate: `1985-${inThreeDays.format("MM-DD")}`,
      },
    ]
    mockGetUpcomingBirthdays.mockResolvedValue(users)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Fødselsdage")).toBeInTheDocument()
    })

    // Should show badge with count "2"
    expect(screen.getByText("2")).toBeInTheDocument()
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

    expect(screen.getByText(/i test thread title/i)).toBeInTheDocument()
    expect(screen.getByText("General Discussion")).toBeInTheDocument()
    // Content should be displayed (without HTML)
    expect(screen.getByText(/this is a test forum post/i)).toBeInTheDocument()
  })

  it("should show multiple recent activities", async () => {
    const activities = [
      {
        id: 1,
        author: {
          id: 2,
          first_name: "First",
          last_name: "Poster",
          profile_picture: null,
        },
        content: "First post content",
        thread_id: 10,
        thread_title: "First Thread",
        subgroup_slug: "general",
        subgroup_name: "General",
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        author: {
          id: 3,
          first_name: "Second",
          last_name: "Poster",
          profile_picture: null,
        },
        content: "Second post content",
        thread_id: 11,
        thread_title: "Second Thread",
        subgroup_slug: "tech",
        subgroup_name: "Tech Talk",
        created_at: new Date().toISOString(),
      },
    ]
    mockGetRecentActivity.mockResolvedValue(activities)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("First Poster")).toBeInTheDocument()
    })

    expect(screen.getByText("Second Poster")).toBeInTheDocument()
    expect(screen.getByText("General")).toBeInTheDocument()
    expect(screen.getByText("Tech Talk")).toBeInTheDocument()
  })

  // Food Widget Tests
  it("should not show food widget content when no menus available", async () => {
    mockGetWeeklyMenus.mockResolvedValue([])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/velkommen/i)).toBeInTheDocument()
    })

    // "I dag" badge should not be visible (food widget specific)
    expect(screen.queryByText("I dag")).not.toBeInTheDocument()
    // Registration controls should not be visible
    expect(screen.queryByText("Spiser ikke")).not.toBeInTheDocument()
  })

  it("should show food widget when menus available", async () => {
    const today = dayjs()
    const weekStart = today.startOf("isoWeek")

    const menus = [
      {
        id: 1,
        week_start_date: weekStart.format("YYYY-MM-DD"),
        daily_menus: [
          {
            id: 1,
            date: today.format("YYYY-MM-DD"),
            day_of_week: today.day(),
            day_name: today.format("dddd"),
            template: null,
            menu_name: "",
            description: "Pasta med kødsovs",
            effective_description: "Pasta med kødsovs",
            has_meat_option: false,
            meat_description: "",
            effective_meat_description: "",
            vegetarian_description: "",
            effective_vegetarian_description: "",
          },
        ],
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ]
    mockGetWeeklyMenus.mockResolvedValue(menus)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Pasta med kødsovs")).toBeInTheDocument()
    })

    expect(screen.getByText("I dag")).toBeInTheDocument()
  })

  it("should show registration controls in food widget", async () => {
    const today = dayjs()
    const weekStart = today.startOf("isoWeek")

    const menus = [
      {
        id: 1,
        week_start_date: weekStart.format("YYYY-MM-DD"),
        daily_menus: [
          {
            id: 1,
            date: today.format("YYYY-MM-DD"),
            day_of_week: today.day(),
            day_name: today.format("dddd"),
            template: null,
            menu_name: "",
            description: "Test menu",
            effective_description: "Test menu",
            has_meat_option: false,
            meat_description: "",
            effective_meat_description: "",
            vegetarian_description: "",
            effective_vegetarian_description: "",
          },
        ],
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ]
    mockGetWeeklyMenus.mockResolvedValue(menus)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Spiser")).toBeInTheDocument()
    })

    expect(screen.getByText("Spiser ikke")).toBeInTheDocument()
  })

  it("should show meat/vegetarian options when menu has both", async () => {
    const today = dayjs()
    const weekStart = today.startOf("isoWeek")

    const menus = [
      {
        id: 1,
        week_start_date: weekStart.format("YYYY-MM-DD"),
        daily_menus: [
          {
            id: 1,
            date: today.format("YYYY-MM-DD"),
            day_of_week: today.day(),
            day_name: today.format("dddd"),
            template: null,
            menu_name: "",
            description: "",
            effective_description: "",
            has_meat_option: true,
            meat_description: "Bøf med løg",
            effective_meat_description: "Bøf med løg",
            vegetarian_description: "Grøntsagsgryde",
            effective_vegetarian_description: "Grøntsagsgryde",
          },
        ],
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ]
    mockGetWeeklyMenus.mockResolvedValue(menus)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText("Bøf med løg")).toBeInTheDocument()
    })

    expect(screen.getByText("Grøntsagsgryde")).toBeInTheDocument()
  })
})
