import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import NotificationPreferencesPage from "./NotificationPreferencesPage"

const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
  Notifications: () => null,
}))

vi.mock("../utils/pushNotifications", () => ({
  isPushSupported: vi.fn().mockReturnValue(true),
  getNotificationPermission: vi.fn().mockReturnValue("default"),
  isPushSubscribed: vi.fn().mockResolvedValue(false),
  isPushConfigured: vi.fn().mockResolvedValue(true),
  subscribeToPushNotificationsWithReason: vi.fn(),
  unsubscribeFromPushNotifications: vi.fn(),
}))

const mockGetPreferences = vi.fn()
const mockUpdatePreferences = vi.fn()
vi.mock("../api/notifications", () => ({
  notificationsApi: {
    getPreferences: () => mockGetPreferences(),
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
  },
}))

const mockPreferences = {
  notify_announcements: true,
  notify_forum_subscriptions: true,
  notify_thread_replies: true,
  notify_post_reactions: false,
  notify_event_reminders: true,
  notify_events: true,
  notify_mentions: true,
  email_messages: false,
  email_announcements: true,
  email_forum_subscriptions: false,
  email_thread_replies: false,
  email_post_reactions: false,
  email_event_reminders: false,
  email_events: false,
  email_mentions: false,
  push_messages: false,
  push_announcements: false,
  push_forum_subscriptions: false,
  push_thread_replies: false,
  push_post_reactions: false,
  push_event_reminders: false,
  push_events: false,
  push_mentions: false,
}

describe("NotificationPreferencesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPreferences.mockResolvedValue(mockPreferences)
    mockUpdatePreferences.mockResolvedValue(mockPreferences)
  })

  it("renders three tabs: I appen, E-mail, Push", async () => {
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /i appen/i })).toBeInTheDocument()
      expect(screen.getByRole("tab", { name: /e-mail/i })).toBeInTheDocument()
      expect(screen.getByRole("tab", { name: /push/i })).toBeInTheDocument()
    })
  })

  it("shows toggles for in-app notification types", async () => {
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      // "Vigtig post" only appears in in-app tab, so getByText is safe here
      expect(screen.getByText("Vigtig post")).toBeInTheDocument()
      // Some labels appear in both in-app and email tabs, use getAllByText
      expect(screen.getAllByText("Forum-abonnementer").length).toBeGreaterThan(
        0,
      )
      expect(screen.getAllByText("Trådsvar").length).toBeGreaterThan(0)
    })
  })

  it("toggling a switch calls updatePreferences", async () => {
    const user = userEvent.setup()
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByText("Vigtig post")).toBeInTheDocument()
    })

    // Find the first switch for "Reaktioner" (in the in-app tab which is active)
    const reaktionerLabels = screen.getAllByText("Reaktioner")
    const reaktionerSwitch = reaktionerLabels[0]
      .closest(".mantine-Switch-root")
      ?.querySelector("input")

    if (reaktionerSwitch) {
      await user.click(reaktionerSwitch)

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ notify_post_reactions: true }),
          expect.anything(),
        )
      })
    }
  })

  it("email tab shows email notification toggles", async () => {
    const user = userEvent.setup()
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /e-mail/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("tab", { name: /e-mail/i }))

    await waitFor(() => {
      expect(screen.getByText("Nye beskeder")).toBeInTheDocument()
    })
  })

  it("push tab shows subscribe button when not subscribed", async () => {
    const user = userEvent.setup()
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /push/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("tab", { name: /push/i }))

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /aktivér push-notifikationer/i }),
      ).toBeInTheDocument()
    })
  })

  it("shows back button to notifications page", async () => {
    render(<NotificationPreferencesPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /tilbage til notifikationer/i }),
      ).toBeInTheDocument()
    })
  })
})
