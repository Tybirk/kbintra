import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { render } from "../test/testUtils"
import FoodPreferencesPage from "./FoodPreferencesPage"

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

const mockGetPreferences = vi.fn()
const mockCreatePreference = vi.fn()
const mockUpdatePreference = vi.fn()
vi.mock("../api/food", () => ({
  foodApi: {
    getPreferences: () => mockGetPreferences(),
    createPreference: (...args: unknown[]) => mockCreatePreference(...args),
    updatePreference: (...args: unknown[]) => mockUpdatePreference(...args),
  },
}))

const mockPreferences = [
  {
    id: 1,
    day_of_week: 0,
    adults_meat: 0,
    adults_veg: 2,
    children_count: 0,
    dining_option: "eat_in" as const,
    seating_time: "17:30" as const,
  },
]

describe("FoodPreferencesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPreferences.mockResolvedValue(mockPreferences)
    mockCreatePreference.mockResolvedValue({})
    mockUpdatePreference.mockResolvedValue({})
  })

  it("renders 4 cards for Mon-Thu", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByText("Mandag")).toBeInTheDocument()
      expect(screen.getByText("Tirsdag")).toBeInTheDocument()
      expect(screen.getByText("Onsdag")).toBeInTheDocument()
      expect(screen.getByText("Torsdag")).toBeInTheDocument()
    })
  })

  it("shows adults count input", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      const adultInputs = screen.getAllByLabelText(/voksne/i)
      expect(adultInputs.length).toBeGreaterThan(0)
    })
  })

  it("shows dining option selector", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      expect(screen.getAllByText("Spise i fælleshuset").length).toBeGreaterThan(
        0,
      )
    })
  })

  it("shows auto-save indicator for all cards", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      const indicators = screen.getAllByText("Gemmes automatisk ved ændringer")
      expect(indicators.length).toBeGreaterThan(0)
    })
  })

  it("shows back button to food page", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /tilbage til mad/i }),
      ).toBeInTheDocument()
    })
  })

  it("shows page title and description", async () => {
    render(<FoodPreferencesPage />)

    await waitFor(() => {
      expect(screen.getByText("Standardindstillinger")).toBeInTheDocument()
    })
  })
})
