import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import LoginPage from "./LoginPage"
import { useAuthStore } from "../store/authStore"

// Mock the navigation
const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null }),
  }
})

// Mock notifications
vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
  Notifications: () => null,
}))

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset auth store
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    })
  })

  it("should render login form", () => {
    render(<LoginPage />)

    expect(screen.getByText("KB Intra")).toBeInTheDocument()
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/adgangskode/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /log ind/i }),
    ).toBeInTheDocument()
  })

  it("should allow user to enter email and password", async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    const emailInput = screen.getByLabelText(/e-mail/i)
    const passwordInput = screen.getByLabelText(/adgangskode/i)

    await user.type(emailInput, "test@example.com")
    await user.type(passwordInput, "password123")

    expect(emailInput).toHaveValue("test@example.com")
    expect(passwordInput).toHaveValue("password123")
  })

  it("should show loading state from store", () => {
    // Set loading state in store
    useAuthStore.setState({ isLoading: true })

    render(<LoginPage />)

    const submitButton = screen.getByRole("button", { name: /log ind/i })
    // Mantine Button with loading prop adds data-loading attribute
    expect(submitButton).toHaveAttribute("data-loading", "true")
  })

  it("should display error when login fails", async () => {
    // Set error in store
    useAuthStore.setState({ error: "Invalid credentials" })

    render(<LoginPage />)

    expect(
      screen.getByText(/forkert e-mail eller adgangskode/i),
    ).toBeInTheDocument()
  })

  it("should have link to forgot password page", () => {
    render(<LoginPage />)

    const forgotLink = screen.getByRole("link", { name: /glemt adgangskode/i })
    expect(forgotLink).toBeInTheDocument()
    expect(forgotLink).toHaveAttribute("href", "/forgot-password")
  })

  it("should call login with email and password on submit", async () => {
    const user = userEvent.setup()
    const loginMock = vi.fn().mockResolvedValue(undefined)
    useAuthStore.setState({ login: loginMock })

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/e-mail/i), "test@example.com")
    await user.type(screen.getByLabelText(/adgangskode/i), "password123")
    await user.click(screen.getByRole("button", { name: /log ind/i }))

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith("test@example.com", "password123")
    })
  })

  it("should navigate to home after successful login", async () => {
    const user = userEvent.setup()
    const loginMock = vi.fn().mockResolvedValue(undefined)
    useAuthStore.setState({ login: loginMock })

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/e-mail/i), "test@example.com")
    await user.type(screen.getByLabelText(/adgangskode/i), "password123")
    await user.click(screen.getByRole("button", { name: /log ind/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true })
    })
  })
})
