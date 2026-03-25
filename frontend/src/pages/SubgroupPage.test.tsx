import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
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
vi.mock("../api/forum", () => ({
  forumApi: {
    getSubgroup: (...args: unknown[]) => mockGetSubgroup(...args),
    getThreads: (...args: unknown[]) => mockGetThreads(...args),
    markSubgroupRead: (...args: unknown[]) => mockMarkSubgroupRead(...args),
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
  is_committee: false,
  is_subscribed: true,
  is_default: false,
  is_main: false,
  icon: "",
  thread_count: 2,
  unread_thread_count: 1,
  latest_thread_title: "Referat 2026",
  created_at: "2026-01-01T10:00:00Z",
  last_activity_at: "2026-01-20T10:00:00Z",
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
    mockGetThreads.mockResolvedValue(mockThreads)
    mockGetEvents.mockResolvedValue([])
  })

  it("renders subgroup title", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })
  })

  it("shows open thread list", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Fastgjort tråd")).toBeInTheDocument()
      expect(screen.getByText("Ulæst tråd")).toBeInTheDocument()
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

  it("shows closed threads tab when there are closed threads", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /lukkede tråde/i }),
      ).toBeInTheDocument()
    })
  })

  it("clicking thread navigates to thread page", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(screen.getByText("Fastgjort tråd")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Fastgjort tråd"))

    expect(mockNavigate).toHaveBeenCalledWith(
      "/forum/general/traad/pinned-thread",
    )
  })

  it("shows back button to forum", async () => {
    render(<SubgroupPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /tilbage til forum/i }),
      ).toBeInTheDocument()
    })
  })
})
