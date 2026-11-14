import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor, within } from "@testing-library/react"

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

vi.mock("../api/forum", () => ({
  forumApi: {
    getSubgroups: () => mockGetSubgroups(),

    subscribe: (...args: unknown[]) => mockSubscribe(...args),

    unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),

    markAllRead: () => mockMarkAllRead(),

    createSubgroup: (...args: unknown[]) => mockCreateSubgroup(...args),
  },
}))

const mockSubgroups = [
  {
    id: 1,

    name: "Fællesgruppe",

    slug: "faellesgruppe",

    description: "Generel tråd",

    is_subscribed: false,

    is_committee: false,

    is_default: true,

    is_main: false,

    icon: "",

    thread_count: 5,

    unread_thread_count: 0,

    latest_thread_title: "Velkommen",
  },

  {
    id: 2,

    name: "Madudvalg",

    slug: "madudvalg",

    description: "Mad og drikke",

    is_subscribed: true,

    is_committee: true,

    is_default: false,

    is_main: false,

    icon: "\uD83C\uDF73",

    thread_count: 3,

    unread_thread_count: 2,

    latest_thread_title: "Menuplan uge 4",
  },
]

describe("ForumPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSubgroups.mockResolvedValue(mockSubgroups)
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

  it("marks a secret group on its card", async () => {
    mockGetSubgroups.mockResolvedValue([
      ...mockSubgroups,
      {
        ...mockSubgroups[0],

        id: 3,

        name: "Bandet",

        slug: "bandet-3fa9c1",

        is_default: false,

        is_member: true,

        is_secret: true,
      },
    ])

    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Bandet")).toBeInTheDocument()
    })

    expect(screen.getAllByLabelText("Hemmelig gruppe")).toHaveLength(1)
  })

  it("creates a secret group, which always has members", async () => {
    const user = userEvent.setup()

    mockCreateSubgroup.mockResolvedValue({
      ...mockSubgroups[0],

      id: 3,

      name: "Bandet",

      slug: "bandet-3fa9c1",

      is_secret: true,
    })

    render(<ForumPage />)

    await waitFor(() => {
      expect(screen.getByText("Fællesgruppe")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: "Opret gruppe" }))

    await user.type(await screen.findByLabelText(/Navn/), "Bandet")

    await user.click(screen.getByLabelText("Hemmelig"))

    const allowsMembers = screen.getByLabelText("Tillad medlemskab")

    expect(allowsMembers).toBeChecked()

    expect(allowsMembers).toBeDisabled()

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Opret gruppe",
      }),
    )

    await waitFor(() => {
      expect(mockCreateSubgroup).toHaveBeenCalled()
    })

    expect(mockCreateSubgroup.mock.calls[0][0]).toMatchObject({
      name: "Bandet",

      allows_members: true,

      is_secret: true,
    })

    expect(mockNavigate).toHaveBeenCalledWith("/forum/bandet-3fa9c1")
  })
})
