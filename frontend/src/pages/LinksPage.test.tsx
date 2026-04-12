import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render, mockUser } from "../test/testUtils"

import LinksPage from "./LinksPage"

import { useAuthStore } from "../store/authStore"

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => vi.fn(),
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

vi.mock("../components/RichTextEditor", () => ({
  default: ({
    content,

    onChange,
  }: {
    content: string

    onChange: (v: string) => void
  }) => (
    <textarea
      data-testid="rich-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

const mockGetLinks = vi.fn()

const mockUpdateLinks = vi.fn()

vi.mock("../api/links", () => ({
  linksApi: {
    getLinks: () => mockGetLinks(),

    updateLinks: (...args: unknown[]) => mockUpdateLinks(...args),
  },
}))

const staffUser = { ...mockUser, is_staff: true }

const regularUser = { ...mockUser, is_staff: false }

describe("LinksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetLinks.mockResolvedValue({
      content: "<p>Nyttige links her</p>",

      updated_at: "2026-01-01T12:00:00Z",
    })
  })

  it("renders page title 'Nyttige links'", async () => {
    useAuthStore.setState({ user: regularUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(screen.getByText("Nyttige links")).toBeInTheDocument()
    })
  })

  it("shows content as rendered HTML", async () => {
    useAuthStore.setState({ user: regularUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(screen.getByText("Nyttige links her")).toBeInTheDocument()
    })
  })

  it("admin sees edit button", async () => {
    useAuthStore.setState({ user: staffUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rediger/i }),
      ).toBeInTheDocument()
    })
  })

  it("non-admin does not see edit button", async () => {
    useAuthStore.setState({ user: regularUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(screen.getByText("Nyttige links")).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("button", { name: /rediger/i }),
    ).not.toBeInTheDocument()
  })

  it("clicking edit shows rich text editor", async () => {
    const user = userEvent.setup()

    useAuthStore.setState({ user: staffUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rediger/i }),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /rediger/i }))

    expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
  })

  it("cancel reverts to view mode", async () => {
    const user = userEvent.setup()

    useAuthStore.setState({ user: staffUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rediger/i }),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /rediger/i }))

    expect(screen.getByTestId("rich-editor")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /annuller/i }))

    expect(screen.queryByTestId("rich-editor")).not.toBeInTheDocument()
  })

  it("save calls updateLinks API", async () => {
    const user = userEvent.setup()

    mockUpdateLinks.mockResolvedValue({
      content: "<p>Opdateret</p>",

      updated_at: "2026-02-01T10:00:00Z",
    })

    useAuthStore.setState({ user: staffUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rediger/i }),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /rediger/i }))

    await user.click(screen.getByRole("button", { name: /^gem$/i }))

    await waitFor(() => {
      expect(mockUpdateLinks).toHaveBeenCalledOnce()
    })
  })

  it("shows empty state when no content", async () => {
    mockGetLinks.mockResolvedValue({
      content: "",

      updated_at: "2026-01-01T12:00:00Z",
    })

    useAuthStore.setState({ user: regularUser, isAuthenticated: true })

    render(<LinksPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/ingen links tilføjet endnu/i),
      ).toBeInTheDocument()
    })
  })
})
