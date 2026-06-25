import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import ForumPage from "./ForumPage"

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

const mockGetSubgroups = vi.fn()

const mockSubscribe = vi.fn()

const mockUnsubscribe = vi.fn()

const mockMarkAllRead = vi.fn()

const mockCreateSubgroup = vi.fn()

const mockGetOrganisation = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    getSubgroups: (...args: unknown[]) => mockGetSubgroups(...args),

    subscribe: (...args: unknown[]) => mockSubscribe(...args),

    unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),

    markAllRead: () => mockMarkAllRead(),

    createSubgroup: (...args: unknown[]) => mockCreateSubgroup(...args),

    getOrganisation: (...args: unknown[]) => mockGetOrganisation(...args),
  },
}))

const mockSubgroups = [
  {
    id: 1,

    name: "Fællesgruppe",

    slug: "faellesgruppe",

    description: "Generel tråd",

    is_subscribed: false,

    group_type: "almindelig",

    is_default: true,

    is_main: false,

    icon: "",

    thread_count: 5,

    unread_thread_count: 0,

    latest_thread_title: "Velkommen",

    last_activity_at: "2026-01-20T10:00:00Z",
  },

  {
    id: 2,

    name: "Madudvalg",

    slug: "madudvalg",

    description: "Mad og drikke",

    is_subscribed: true,

    group_type: "udvalg",

    is_default: false,

    is_main: false,

    icon: "\uD83C\uDF73",

    thread_count: 3,

    unread_thread_count: 2,

    latest_thread_title: "Menuplan uge 4",

    last_activity_at: "2026-01-21T12:00:00Z",
  },
]

const mockArchivedSubgroup = {
  id: 3,

  name: "Gammelt udvalg",

  slug: "gammelt-udvalg",

  description: "Nedlagt udvalg",

  is_subscribed: false,

  group_type: "almindelig",

  is_default: false,

  is_main: false,

  icon: "",

  thread_count: 1,

  unread_thread_count: 0,

  latest_thread_title: "Sidste møde",

  last_activity_at: "2025-01-01T10:00:00Z",

  is_active: false,
}

describe("ForumPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSubgroups.mockResolvedValue(mockSubgroups)

    mockGetOrganisation.mockResolvedValue([])
  })

  it("renders page title 'Forum'", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Forum")).toBeInTheDocument()
    })
  })

  it("shows list of subgroups", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()

      expect(screen.getByText("Madudvalg")).toBeInTheDocument()
    })
  })

  it("shows unread count indicator on subgroups with unread threads", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      // Madudvalg has 2 unread threads - shown as red dot badge

      expect(screen.getByText("2")).toBeInTheDocument()
    })
  })

  it("search filters subgroups by name", async () => {
    const user = userEvent.setup()

    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()
    })

    await user.type(screen.getByPlaceholderText(/søg i grupper/i), "mad")

    await waitFor(() => {
      expect(screen.queryByText("Fællesgruppe")).not.toBeInTheDocument()

      expect(screen.getByText("Madudvalg")).toBeInTheDocument()
    })
  })

  it("mark all read button appears when there are unread threads", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /markér alt som læst/i }),
      ).toBeInTheDocument()
    })
  })

  it("mark all read button calls markAllRead API", async () => {
    const user = userEvent.setup()

    mockMarkAllRead.mockResolvedValue(undefined)

    render(<ForumPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /markér alt som læst/i }),
      ).toBeInTheDocument()
    })

    await user.click(
      screen.getByRole("button", { name: /markér alt som læst/i }),
    )

    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledOnce()
    })
  })

  it("renders subgroup card as link to subgroup page", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()
    })

    const cardLink = screen
      .getByRole("link", { name: "Fællesgruppe" })
      .getAttribute("href")

    expect(cardLink).toBe("/forum/faellesgruppe")
  })

  it("shows subscribed groups section for subscribed subgroups", async () => {
    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Grupper du abonnerer på")).toBeInTheDocument()
    })
  })

  it("shows empty state when no groups match search", async () => {
    const user = userEvent.setup()

    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()
    })

    await user.type(
      screen.getByPlaceholderText(/søg i grupper/i),

      "XYZ ingen match",
    )

    await waitFor(() => {
      expect(screen.getByText("Ingen grupper fundet.")).toBeInTheDocument()
    })
  })

  it("hides archived groups by default and shows them when Vis arkiverede is toggled on", async () => {
    const user = userEvent.setup()

    mockGetSubgroups.mockImplementation(
      async (options: { includeArchived?: boolean } = {}) =>
        options.includeArchived
          ? [...mockSubgroups, mockArchivedSubgroup]
          : mockSubgroups,
    )

    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()
    })

    expect(screen.queryByText("Gammelt udvalg")).not.toBeInTheDocument()

    await user.click(screen.getByRole("switch", { name: /vis arkiverede/i }))

    await waitFor(() => {
      expect(screen.getByText("Gammelt udvalg")).toBeInTheDocument()

      expect(screen.getByText("Afsluttet")).toBeInTheDocument()
    })
  })
})
