import { describe, it, expect, vi, beforeEach } from "vitest"

import { waitFor } from "@testing-library/react"

import { render } from "../test/testUtils"

import ThreadPage from "./ThreadPage"

import { forumApi } from "../api/forum"

import { notificationsApi } from "../api/notifications"

// Mock navigation — useParams provides the slug-based route params,

// useLocation simulates the browser with a percent-encoded pathname

// (æ → %C3%A6), which is what window.location.pathname returns for

// threads whose slugs contain Danish characters.

const mockNavigate = vi.fn()

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => mockNavigate,

    useParams: () => ({
      slug: "bugs",

      threadSlug: "notifikationer-bliver-hængende",
    }),

    useLocation: () => ({
      pathname: "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende",

      hash: "",

      search: "",

      state: null,

      key: "default",
    }),
  }
})

vi.mock("../api/forum", () => ({
  forumApi: {
    getThread: vi.fn(),

    getThreadBySlug: vi.fn(),

    createPost: vi.fn(),

    updatePost: vi.fn(),

    deletePost: vi.fn(),

    deleteThread: vi.fn(),

    toggleThreadClose: vi.fn(),

    reactToPost: vi.fn(),

    removeReaction: vi.fn(),

    createDirectMessageFromThread: vi.fn(),
  },
}))

vi.mock("../api/notifications", () => ({
  notificationsApi: {
    markReadByLink: vi.fn().mockResolvedValue({ marked_read: 1 }),
  },
}))

vi.mock("../api/messaging", () => ({
  messagingApi: {
    createConversation: vi.fn(),
  },
}))

vi.mock("../store/authStore", () => ({
  useAuthStore: () => ({
    user: {
      id: 1,

      first_name: "Test",

      last_name: "User",

      profile_picture: null,

      is_staff: false,
    },
  }),
}))

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

// Tiptap/RichTextEditor requires a real DOM with contenteditable — mock it

vi.mock("../components/RichTextEditor", () => ({
  default: () => <div data-testid="rich-editor" />,
}))

vi.mock("../components/FileDropzone", () => ({
  default: () => <div data-testid="file-dropzone" />,

  AttachmentArea: () => <div data-testid="attachment-area" />,
}))

const mockThread = {
  id: 42,

  subgroup: 1,

  title: "Notifikationer hænger",

  slug: "notifikationer-bliver-hængende",

  subgroup_name: "Bugs",

  subgroup_slug: "bugs",

  author: {
    id: 2,

    first_name: "Author",

    last_name: "User",

    profile_picture: null,
  },

  is_pinned: false,

  is_closed: false,

  is_own: false,

  can_edit: false,

  can_close: false,

  event_id: null,

  post_count: 0,

  last_post_at: null,

  last_post_author: null,

  is_unread: false,

  posts: [],

  created_at: "2024-01-01T00:00:00Z",

  updated_at: "2024-01-01T00:00:00Z",
}

describe("ThreadPage — notification auto-marking", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(forumApi.getThreadBySlug).mockResolvedValue(mockThread)
  })

  it("calls markReadByLink with location.pathname once the thread data loads", async () => {
    render(<ThreadPage />)

    await waitFor(() => {
      expect(notificationsApi.markReadByLink).toHaveBeenCalledTimes(1)
    })

    // The path passed is the raw location.pathname (percent-encoded for non-ASCII).

    // The backend's MarkNotificationsByLinkView decodes it before matching.

    expect(notificationsApi.markReadByLink).toHaveBeenCalledWith(
      "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende",
    )
  })

  it("does not call markReadByLink before thread data has loaded", async () => {
    // Make the query hang — simulate slow network

    vi.mocked(forumApi.getThreadBySlug).mockReturnValue(new Promise(() => {}))

    render(<ThreadPage />)

    // Give React a moment to run any synchronous effects

    await new Promise((r) => setTimeout(r, 50))

    expect(notificationsApi.markReadByLink).not.toHaveBeenCalled()
  })
})
