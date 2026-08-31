import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import SubgroupPage from "./SubgroupPage"

const mockNavigate = vi.fn()

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => mockNavigate,

    useParams: () => ({ slug: "general", folderId: undefined }),

    useLocation: () => ({
      pathname: "/forum/general",

      hash: "",

      search: "",
    }),
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

vi.mock("../components/RichTextEditor", () => ({
  default: () => <div data-testid="rich-editor" />,
}))

vi.mock("../components/FileDropzone", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),

  AttachmentArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("../components/PollCreator", () => ({
  default: () => <div data-testid="poll-creator" />,
}))

vi.mock("../utils/draftStorage", () => ({
  loadDraft: vi.fn().mockResolvedValue(null),

  saveDraft: vi.fn().mockResolvedValue(undefined),

  clearDraft: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../store/authStore", () => ({
  useAuthStore: () => ({
    user: {
      id: 1,

      first_name: "Test",

      last_name: "Bruger",

      is_staff: false,
    },
  }),
}))

const mockGetSubgroup = vi.fn()

const mockGetThreads = vi.fn()

const mockGetEvents = vi.fn()

const mockMarkSubgroupRead = vi.fn()

const mockUpdateSubgroup = vi.fn()

const mockGetOrganisation = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    getSubgroup: (...args: unknown[]) => mockGetSubgroup(...args),

    getThreads: (...args: unknown[]) => mockGetThreads(...args),

    markSubgroupRead: (...args: unknown[]) => mockMarkSubgroupRead(...args),

    updateSubgroup: (...args: unknown[]) => mockUpdateSubgroup(...args),

    getOrganisation: (...args: unknown[]) => mockGetOrganisation(...args),

    getFolders: vi.fn().mockResolvedValue([]),

    getFiles: vi.fn().mockResolvedValue([]),

    getRootFiles: vi.fn().mockResolvedValue([]),

    getAllFolders: vi.fn().mockResolvedValue([]),

    getFolder: vi

      .fn()

      .mockResolvedValue({ id: 1, name: "Mappe", parent: null }),
  },
}))

vi.mock("../api/events", () => ({
  eventsApi: {
    getEvents: () => mockGetEvents(),
  },
}))

const mockSubgroup = {
  id: 1,

  name: "Generalforsamling",

  slug: "general",

  description: "Til generalforsamlinger",

  group_type: "almindelig",

  is_subscribed: true,

  is_default: false,

  is_main: false,

  icon: "",

  parent: null,

  parent_name: null,

  parent_slug: null,

  children: [],

  thread_count: 2,

  unread_thread_count: 1,

  latest_thread_title: "Referat 2026",

  created_at: "2026-01-01T10:00:00Z",

  last_activity_at: "2026-01-20T10:00:00Z",

  established_on: null,

  expires_on: null,

  is_active: true,
}

const mockThreads = [
  {
    id: 1,

    slug: "pinned-thread",

    title: "Fastgjort tråd",

    author: {
      id: 2,

      first_name: "Anders",

      last_name: "Hansen",

      profile_picture: null,
    },

    is_pinned: true,

    is_closed: false,

    is_unread: false,

    post_count: 3,

    last_post_author: null,

    last_post_at: null,

    created_at: "2026-01-10T10:00:00Z",

    updated_at: "2026-01-10T10:00:00Z",
  },

  {
    id: 2,

    slug: "unread-thread",

    title: "Ulæst tråd",

    author: {
      id: 3,

      first_name: "Mette",

      last_name: "Jensen",

      profile_picture: null,
    },

    is_pinned: false,

    is_closed: false,

    is_unread: true,

    post_count: 1,

    last_post_author: null,

    last_post_at: null,

    created_at: "2026-01-15T10:00:00Z",

    updated_at: "2026-01-15T10:00:00Z",
  },

  {
    id: 3,

    slug: "closed-thread",

    title: "Lukket tråd",

    author: {
      id: 4,

      first_name: "Lars",

      last_name: "Andersen",

      profile_picture: null,
    },

    is_pinned: false,

    is_closed: true,

    is_unread: false,

    post_count: 10,

    last_post_author: null,

    last_post_at: null,

    created_at: "2026-01-01T10:00:00Z",

    updated_at: "2026-01-05T10:00:00Z",
  },
]

describe("SubgroupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSubgroup.mockResolvedValue(mockSubgroup)
    mockGetThreads.mockImplementation(
      async (_slug: string, options: { isClosed?: boolean } = {}) => {
        const filtered = mockThreads.filter((t) =>
          options.isClosed === undefined
            ? true
            : t.is_closed === options.isClosed,
        )
        return {
          count: filtered.length,
          next: null,
          previous: null,
          results: filtered,
        }
      },
    )
    mockGetEvents.mockResolvedValue([])
    mockUpdateSubgroup.mockResolvedValue(mockSubgroup)
    mockGetOrganisation.mockResolvedValue([])
  })

  it("renders subgroup title", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })
  })

  it("shows all threads including closed", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Fastgjort tråd")).toBeInTheDocument()

      expect(screen.getByText("Ulæst tråd")).toBeInTheDocument()

      expect(screen.getByText("Lukket tråd")).toBeInTheDocument()
    })
  })

  it("shows create thread button", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /ny tråd/i }),
      ).toBeInTheDocument()
    })
  })

  it("shows documents tab", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /dokumenter/i }),
      ).toBeInTheDocument()
    })
  })

  it("does not show a separate closed threads tab", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /tråde/i })).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("tab", { name: /lukkede tråde/i }),
    ).not.toBeInTheDocument()
  })

  it("renders thread row as link to thread page", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Fastgjort tråd")).toBeInTheDocument()
    })

    const threadLink = screen
      .getByRole("link", { name: "Fastgjort tråd" })
      .getAttribute("href")

    expect(threadLink).toBe("/forum/general/traad/pinned-thread")
  })

  it("shows back button to forum", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /tilbage til forumoversigt/i }),
      ).toBeInTheDocument()
    })
  })

  it("shows a parent breadcrumb chip linking to the parent group", async () => {
    mockGetSubgroup.mockResolvedValue({
      ...mockSubgroup,
      parent: 5,
      parent_name: "Bestyrelsen",
      parent_slug: "bestyrelsen",
    })

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Bestyrelsen")).toBeInTheDocument()
    })

    const parentLink = screen
      .getByRole("link", { name: /Bestyrelsen/i })
      .getAttribute("href")

    expect(parentLink).toBe("/forum/bestyrelsen")
  })

  it("shows children as chips linking to the child group", async () => {
    mockGetSubgroup.mockResolvedValue({
      ...mockSubgroup,
      children: [{ id: 7, name: "Festudvalg", slug: "festudvalg" }],
    })

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Festudvalg")).toBeInTheDocument()
    })

    const childLink = screen
      .getByRole("link", { name: "Festudvalg" })
      .getAttribute("href")

    expect(childLink).toBe("/forum/festudvalg")
  })

  it("shows an Afsluttet badge when the group is archived", async () => {
    mockGetSubgroup.mockResolvedValue({
      ...mockSubgroup,
      is_active: false,
    })

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Afsluttet")).toBeInTheDocument()
    })
  })

  it("does not show an Afsluttet badge for an active group", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    expect(screen.queryByText("Afsluttet")).not.toBeInTheDocument()
  })

  it("allows marking an active group as afsluttet via the group menu", async () => {
    const user = userEvent.setup()

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /gruppemenu/i }))

    await user.click(
      await screen.findByRole("menuitem", { name: /markér som afsluttet/i }, {
        timeout: 5000,
      }),
    )

    await waitFor(() => {
      expect(mockUpdateSubgroup).toHaveBeenCalledWith("general", {
        is_active: false,
      })
    })
  })

  it("shows a genåbn action for an archived group", async () => {
    mockGetSubgroup.mockResolvedValue({
      ...mockSubgroup,
      is_active: false,
    })

    const user = userEvent.setup()

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /gruppemenu/i }))

    await user.click(
      await screen.findByRole("menuitem", { name: /genåbn gruppe/i }, {
        timeout: 5000,
      }),
    )

    await waitFor(() => {
      expect(mockUpdateSubgroup).toHaveBeenCalledWith("general", {
        is_active: true,
      })
    })
  })

  it("shows the group type selector for an almindelig group and hides the parent select by default", async () => {
    const user = userEvent.setup()

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /gruppemenu/i }))
    await user.click(
      await screen.findByRole("menuitem", { name: /rediger gruppe/i }, {
        timeout: 5000,
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Almindelig gruppe" }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole("radio", { name: "Almindelig gruppe" }),
    ).toBeChecked()
    expect(screen.queryByLabelText(/^Forælder/)).not.toBeInTheDocument()
  })

  it("converting to Arbejdsgruppe shows the parent select; submitting sends the new group_type", async () => {
    mockGetOrganisation.mockResolvedValue([
      {
        id: 9,
        name: "Bestyrelsen",
        slug: "bestyrelsen",
        group_type: "bestyrelse",
        description: "",
        established_on: null,
        expires_on: null,
        is_active: true,
        member_count: 0,
        members: [],
        children: [],
      },
    ])

    const user = userEvent.setup()

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /gruppemenu/i }))
    await user.click(
      await screen.findByRole("menuitem", { name: /rediger gruppe/i }, {
        timeout: 5000,
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Arbejdsgruppe" }),
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("radio", { name: "Arbejdsgruppe" }))

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /^Forælder/ }),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole("combobox", { name: /^Forælder/ }))
    await user.click(await screen.findByText("Bestyrelsen"))

    await user.click(screen.getByRole("button", { name: "Gem" }))

    await waitFor(() => {
      expect(mockUpdateSubgroup).toHaveBeenCalledWith(
        "general",
        expect.objectContaining({
          group_type: "arbejdsgruppe",
          parent: 9,
        }),
      )
    })
  })

  it("does not show the type selector for an organ group", async () => {
    mockGetSubgroup.mockResolvedValue({
      ...mockSubgroup,
      group_type: "udvalg",
    })

    const user = userEvent.setup()

    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /gruppemenu/i }))
    await user.click(
      await screen.findByRole("menuitem", { name: /rediger gruppe/i }, {
        timeout: 5000,
      }),
    )

    expect(
      screen.queryByRole("radio", { name: "Almindelig gruppe" }),
    ).not.toBeInTheDocument()
  })
})
