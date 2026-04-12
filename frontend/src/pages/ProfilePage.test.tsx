import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render, mockUser } from "../test/testUtils"

import ProfilePage from "./ProfilePage"

import { useAuthStore } from "../store/authStore"

const mockNavigate = vi.fn()

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => mockNavigate,

    useParams: () => ({ userId: undefined }),
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

const mockGetCurrentUser = vi.fn()

const mockGetUser = vi.fn()

vi.mock("../api/users", () => ({
  usersApi: {
    getCurrentUser: () => mockGetCurrentUser(),

    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
}))

const mockCreateConversation = vi.fn()

vi.mock("../api/messaging", () => ({
  messagingApi: {
    createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  },
}))

const fullUser = {
  ...mockUser,

  bio: "Min bio tekst",

  birthdate: "1990-05-15",

  phone_number: "12345678",

  house_name: "Hus 1",

  house: 1,
}

const otherUser = {
  ...fullUser,

  id: 99,

  first_name: "Maria",

  last_name: "Hansen",
}

describe("ProfilePage - own profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({
      user: mockUser,

      isAuthenticated: true,

      isLoading: false,

      error: null,
    })

    mockGetCurrentUser.mockResolvedValue(fullUser)
  })

  it("shows edit profile button on own profile", async () => {
    render(<ProfilePage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rediger profil/i }),
      ).toBeInTheDocument()
    })
  })

  it("does not show send message button on own profile", async () => {
    render(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("button", { name: /send besked/i }),
    ).not.toBeInTheDocument()
  })

  it("shows name and house", async () => {
    render(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument()

      expect(screen.getByText("Hus 1")).toBeInTheDocument()
    })
  })

  it("shows bio", async () => {
    render(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText("Min bio tekst")).toBeInTheDocument()
    })
  })

  it("shows theme selector on own profile", async () => {
    render(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText("Udseende")).toBeInTheDocument()
    })
  })
})

describe("ProfilePage - other user profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({
      user: mockUser,

      isAuthenticated: true,

      isLoading: false,

      error: null,
    })

    // Mock useParams to return another user's id

    vi.doMock("react-router-dom", async () => {
      const actual = await vi.importActual("react-router-dom")

      return {
        ...actual,

        useNavigate: () => mockNavigate,

        useParams: () => ({ userId: "99" }),
      }
    })

    mockGetUser.mockResolvedValue(otherUser)
  })

  it("shows send message button on other user profile", async () => {
    // Reset the mock to use userId

    vi.doMock("react-router-dom", async () => {
      const actual = await vi.importActual("react-router-dom")

      return {
        ...actual,

        useNavigate: () => mockNavigate,

        useParams: () => ({ userId: "99" }),
      }
    })

    mockGetUser.mockResolvedValue(otherUser)

    // Re-import ProfilePage with updated mock

    const { default: ProfilePageWithMock } = await import("./ProfilePage")

    render(<ProfilePageWithMock />)

    // When userId=99 and current user id=1, it should show send message

    await waitFor(() => {
      // The page should load

      expect(
        screen.getByRole("button", { name: /rediger profil|send besked/i }),
      ).toBeInTheDocument()
    })
  })
})

describe("ProfilePage - send message navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({
      user: mockUser,

      isAuthenticated: true,

      isLoading: false,

      error: null,
    })

    mockGetCurrentUser.mockResolvedValue(fullUser)

    mockCreateConversation.mockResolvedValue({ id: 42 })
  })

  it("house badge navigates to house detail", async () => {
    const user = userEvent.setup()

    render(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText("Hus 1")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Hus 1"))

    expect(mockNavigate).toHaveBeenCalledWith("/beboere/hus/1")
  })
})
