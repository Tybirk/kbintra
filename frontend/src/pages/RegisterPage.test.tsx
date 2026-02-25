import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import RegisterPage from "./RegisterPage"

const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams("token=testtoken123"), vi.fn()],
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
  Notifications: () => null,
}))

const mockValidateInvitation = vi.fn()
const mockRegister = vi.fn()
vi.mock("../api/auth", () => ({
  authApi: {
    validateInvitation: (...args: unknown[]) => mockValidateInvitation(...args),
    register: (...args: unknown[]) => mockRegister(...args),
  },
}))

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateInvitation.mockResolvedValue({
      valid: true,
      email: "inviteret@example.com",
      expires_at: "2026-12-31T00:00:00Z",
    })
  })

  it("renders registration form with email pre-filled from invitation", async () => {
    render(<RegisterPage />)

    await waitFor(() => {
      const emailInput = screen.getByLabelText(/e-mail/i)
      expect(emailInput).toHaveValue("inviteret@example.com")
    })
  })

  it("shows first and last name inputs", async () => {
    render(<RegisterPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/fornavn/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/efternavn/i)).toBeInTheDocument()
    })
  })

  it("shows password and confirmation inputs", async () => {
    render(<RegisterPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^adgangskode/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/bekræft adgangskode/i)).toBeInTheDocument()
    })
  })

  it("shows validation error on password mismatch", async () => {
    const user = userEvent.setup()
    render(<RegisterPage />)

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/opret en adgangskode/i),
      ).toBeInTheDocument()
    })

    // Use placeholder to get the actual <input> elements inside Mantine's PasswordInput
    await user.type(
      screen.getByPlaceholderText(/opret en adgangskode/i),
      "password123",
    )
    await user.type(
      screen.getByPlaceholderText(/bekræft din adgangskode/i),
      "differentpassword",
    )
    await user.click(screen.getByRole("button", { name: /opret konto/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/adgangskoderne matcher ikke/i),
      ).toBeInTheDocument()
    })
  })

  it("shows error for invalid invitation token", async () => {
    mockValidateInvitation.mockRejectedValue(new Error("Invalid token"))

    render(<RegisterPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/ugyldig eller udløbet invitationskode/i),
      ).toBeInTheDocument()
    })
  })

  it("calls register API and navigates on successful registration", async () => {
    mockRegister.mockResolvedValue({ message: "OK", user: { id: 1 } })

    render(<RegisterPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/fornavn/i)).toBeInTheDocument()
    })

    // Use fireEvent to avoid React concurrent mode issues with e.currentTarget
    const firstNameInput = screen.getByLabelText(/fornavn/i)
    const lastNameInput = screen.getByLabelText(/efternavn/i)
    const passwordInput = screen.getByLabelText(/^adgangskode/i)
    const confirmInput = screen.getByLabelText(/bekræft adgangskode/i)

    fireEvent.change(firstNameInput, { target: { value: "Anders" } })
    fireEvent.change(lastNameInput, { target: { value: "Jensen" } })
    fireEvent.change(passwordInput, { target: { value: "sikkertkodeord" } })
    fireEvent.change(confirmInput, { target: { value: "sikkertkodeord" } })

    fireEvent.click(screen.getByRole("button", { name: /opret konto/i }))

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledOnce()
      expect(mockNavigate).toHaveBeenCalledWith("/login")
    })
  })
})
