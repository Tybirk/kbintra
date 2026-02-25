import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import ForgotPasswordPage from "./ForgotPasswordPage"

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

const mockForgotPassword = vi.fn()
vi.mock("../api/auth", () => ({
  authApi: {
    forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
  },
}))

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders email input", () => {
    render(<ForgotPasswordPage />)

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /send nulstillingslink/i }),
    ).toBeInTheDocument()
  })

  it("shows confirmation message after successful submit", async () => {
    const user = userEvent.setup()
    mockForgotPassword.mockResolvedValue({})

    render(<ForgotPasswordPage />)

    await user.type(screen.getByLabelText(/e-mail/i), "bruger@example.com")
    await user.click(
      screen.getByRole("button", { name: /send nulstillingslink/i }),
    )

    await waitFor(() => {
      expect(screen.getByText(/har vi sendt et link/i)).toBeInTheDocument()
    })
  })

  it("calls forgotPassword API with entered email", async () => {
    const user = userEvent.setup()
    mockForgotPassword.mockResolvedValue({})

    render(<ForgotPasswordPage />)

    await user.type(screen.getByLabelText(/e-mail/i), "test@example.com")
    await user.click(
      screen.getByRole("button", { name: /send nulstillingslink/i }),
    )

    await waitFor(() => {
      expect(mockForgotPassword).toHaveBeenCalledOnce()
    })
  })

  it("has link back to login page", () => {
    render(<ForgotPasswordPage />)

    const loginLink = screen.getByRole("link", { name: /log ind her/i })
    expect(loginLink).toBeInTheDocument()
    expect(loginLink).toHaveAttribute("href", "/login")
  })
})
