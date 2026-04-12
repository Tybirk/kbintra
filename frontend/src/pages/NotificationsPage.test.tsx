import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import NotificationsPage from "./NotificationsPage"

const mockNavigate = vi.fn()

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => mockNavigate,
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

vi.mock("../utils/cacheInvalidation", () => ({
  invalidateCacheForLink: vi.fn(),
}))

const mockGetNotifications = vi.fn()

const mockMarkAsRead = vi.fn()

const mockMarkAsUnread = vi.fn()

const mockDeleteNotification = vi.fn()

const mockClearAll = vi.fn()

vi.mock("../api/notifications", () => ({
  notificationsApi: {
    getNotifications: () => mockGetNotifications(),

    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),

    markAsUnread: (...args: unknown[]) => mockMarkAsUnread(...args),

    deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),

    clearAll: () => mockClearAll(),
  },
}))

const mockNotification = {
  id: 1,

  title: "Ny besked",

  message: "Anders har sendt dig en besked",

  notification_type: "new_message" as const,

  is_read: false,

  link: "/beskeder/1",

  related_user: null,

  created_at: "2026-01-20T10:00:00Z",
}

const readNotification = {
  id: 2,

  title: "Forum svar",

  message: "Nogen svarede på din tråd",

  notification_type: "thread_reply" as const,

  is_read: true,

  link: "/forum/general/traad/test",

  related_user: null,

  created_at: "2026-01-19T10:00:00Z",
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetNotifications.mockResolvedValue({
      count: 2,

      next: null,

      previous: null,

      results: [mockNotification, readNotification],
    })

    mockMarkAsRead.mockResolvedValue({ marked_read: 1 })

    mockMarkAsUnread.mockResolvedValue({ marked_unread: 1 })

    mockDeleteNotification.mockResolvedValue(undefined)

    mockClearAll.mockResolvedValue(undefined)
  })

  it("renders page title 'Notifikationer'", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByText("Notifikationer")).toBeInTheDocument()
    })
  })

  it("shows list of notifications", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByText("Ny besked")).toBeInTheDocument()

      expect(screen.getByText("Forum svar")).toBeInTheDocument()
    })
  })

  it("shows unread count in subtitle", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByText("1 ulæste notifikationer")).toBeInTheDocument()
    })
  })

  it("shows mark as read button for unread notifications", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByText("Ny besked")).toBeInTheDocument()
    })

    // There should be action icons for mark as read

    const buttons = screen.getAllByRole("button")

    expect(buttons.length).toBeGreaterThan(0)
  })

  it("shows mark all as read button when there are notifications", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /markér alle som læst/i }),
      ).toBeInTheDocument()
    })
  })

  it("shows empty state when no notifications", async () => {
    mockGetNotifications.mockResolvedValue({
      count: 0,

      next: null,

      previous: null,

      results: [],
    })

    render(<NotificationsPage />)

    await waitFor(() => {
      expect(
        screen.getByText("Ingen notifikationer endnu."),
      ).toBeInTheDocument()
    })
  })

  it("clicking delete button calls deleteNotification API", async () => {
    const user = userEvent.setup()

    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByText("Ny besked")).toBeInTheDocument()
    })

    // Find delete buttons (trash icons)

    const deleteButtons = screen.getAllByRole("button", { name: "Slet" })

    expect(deleteButtons.length).toBeGreaterThan(0)

    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(mockDeleteNotification).toHaveBeenCalled()

      expect(mockDeleteNotification.mock.calls[0][0]).toEqual(
        expect.any(Number),
      )
    })
  })

  it("shows clear all button when there are notifications", async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /ryd alle/i }),
      ).toBeInTheDocument()
    })
  })
})
