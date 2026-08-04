import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render, mockUser } from "../test/testUtils"

import CarSharingPage from "./CarSharingPage"

import { useAuthStore } from "../store/authStore"

import type { CarLoan, PoolCar } from "../types"

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,

    useNavigate: () => vi.fn(),

    useParams: () => ({}),
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

const mockGetPoolCars = vi.fn()

const mockGetTerms = vi.fn()

const mockGetLoans = vi.fn()

const mockGetBlocks = vi.fn()

const mockCompleteLoan = vi.fn()

vi.mock("../api/carsharing", async () => {
  const actual =
    await vi.importActual<typeof import("../api/carsharing")>(
      "../api/carsharing",
    )

  return {
    ...actual,

    carSharingApi: {
      getPoolCars: () => mockGetPoolCars(),

      getTerms: () => mockGetTerms(),

      getLoans: () => mockGetLoans(),

      getBlocks: () => mockGetBlocks(),

      getLoan: vi.fn(),

      createBlock: vi.fn(),

      deleteBlock: vi.fn(),

      requestLoan: vi.fn(),

      respondToCandidate: vi.fn(),

      chooseCandidate: vi.fn(),

      completeLoan: (...args: unknown[]) => mockCompleteLoan(...args),

      cancelLoan: vi.fn(),
    },
  }
})

vi.mock("../api/houses", () => ({
  housesApi: {
    getCars: () => Promise.resolve([]),

    updateCar: vi.fn(),
  },
}))

function poolCar(overrides: Partial<PoolCar> = {}): PoolCar {
  return {
    id: 1,
    display_name: "Skoda Octavia",
    license_plate: "AB12345",
    house_name: "Kløverbakkevej 7",
    house_slug: "7",
    is_electric: true,
    make: "Skoda",
    model_name: "Octavia",
    color: "blå",
    year: 2020,
    seats: 5,
    has_tow_hitch: false,
    has_isofix: true,
    dogs_allowed: false,
    has_charge_fob: true,
    equipment_note: "",
    practical_note: "Nøglen hænger i skabet",
    effective_rate_per_km: "3.94",
    blocks: [],
    conflict: null,
    conflict_note: "",
    meets_requirements: true,
    selectable: true,
    ...overrides,
  }
}

function activeLoan(overrides: Partial<CarLoan> = {}): CarLoan {
  return {
    id: 42,
    borrower: mockUser.id,
    borrower_name: "Test User",
    is_borrower: true,
    status: "active",
    start_at: "2027-06-12T09:00:00Z",
    end_at: "2027-06-12T14:00:00Z",
    expected_km: 100,
    needs_isofix: false,
    needs_tow_hitch: false,
    min_seats: null,
    note: "",
    terms_version: "2026-08-01",
    car: 1,
    car_display_name: "Skoda Octavia",
    car_house_name: "Kløverbakkevej 7",
    car_practical_note: "Nøglen hænger i skabet",
    rate_per_km: "4.00",
    activated_at: "2027-06-11T09:00:00Z",
    actual_km: null,
    expense_amount: "0.00",
    expense_note: "",
    damage_note: "",
    amount_due: null,
    completed_at: null,
    candidates: [],
    created_at: "2027-06-10T09:00:00Z",
    ...overrides,
  }
}

describe("CarSharingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({ user: mockUser, isAuthenticated: true })

    mockGetTerms.mockResolvedValue({
      version: "2026-08-01",
      title: "Vilkår for lån af bil i bilpølen",
      bullets: [
        "Du er ansvarlig for bilen, mens du har den.",
        "Prisen er 3,94 kr. pr. kørt km.",
      ],
      text: "Vilkår for lån af bil i bilpølen\n\n- Prisen er 3,94 kr. pr. kørt km.",
      default_rate_per_km: "3.94",
    })

    mockGetPoolCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      cars: [poolCar()],
    })

    mockGetLoans.mockResolvedValue([])

    mockGetBlocks.mockResolvedValue([])
  })

  it("renders the pool list", async () => {
    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Skoda Octavia")).toBeInTheDocument()
    })
    expect(screen.getByText(/Kløverbakkevej 7/)).toBeInTheDocument()
  })

  it("does not refetch the pool in a loop on mount", async () => {
    render(<CarSharingPage />)

    await waitFor(() => expect(mockGetPoolCars).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(mockGetPoolCars.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("does not refetch in a loop after the 'now' shortcut", async () => {
    render(<CarSharingPage />)

    await waitFor(() => expect(mockGetPoolCars).toHaveBeenCalled())

    await userEvent.click(
      screen.getByRole("button", { name: /Nu og de næste 2 timer/ }),
    )
    const afterClick = mockGetPoolCars.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 400))

    // One fetch for the new window is expected; a storm is not.
    expect(mockGetPoolCars.mock.calls.length - afterClick).toBeLessThanOrEqual(
      1,
    )
  })

  it("shows the terms as a list, with no markdown leaking through", async () => {
    render(<CarSharingPage />)

    await waitFor(() => {
      expect(
        screen.getByText("Prisen er 3,94 kr. pr. kørt km."),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText("Vilkår for lån af bil i bilpølen"),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).not.toContain("**")
  })

  it("marks a car that is normally busy but keeps it selectable", async () => {
    mockGetPoolCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      cars: [
        poolCar({
          conflict: "schedule",
          conflict_note: "Normalt optaget (pendler)",
        }),
      ],
    })

    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Normalt optaget")).toBeInTheDocument()
    })
    expect(
      screen.getByRole("checkbox", { name: /Vælg Skoda Octavia/ }),
    ).toBeEnabled()
  })

  it("disables selection for a car that is already lent out", async () => {
    mockGetPoolCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      cars: [
        poolCar({
          conflict: "loan",
          conflict_note: "Udlånt i tidsrummet",
          selectable: false,
        }),
      ],
    })

    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Udlånt")).toBeInTheDocument()
    })
    expect(
      screen.getByRole("checkbox", { name: /Vælg Skoda Octavia/ }),
    ).toBeDisabled()
  })

  it("counts the households being asked", async () => {
    render(<CarSharingPage />)

    const checkbox = await screen.findByRole("checkbox", {
      name: /Vælg Skoda Octavia/,
    })
    await userEvent.click(checkbox)

    await waitFor(() => {
      expect(
        screen.getByText(/Du spørger 1 husstand om 1 bil/),
      ).toBeInTheDocument()
    })
  })

  it("calculates the amount due in the completion form", async () => {
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    const kmInput = await screen.findByLabelText("Kørte kilometer")
    await userEvent.clear(kmInput)
    await userEvent.type(kmInput, "100")

    // 100 km × 4,00 kr = 400,00 kr
    await waitFor(() => {
      expect(screen.getByText(/Du skal betale 400,00 kr./)).toBeInTheDocument()
    })
  })

  it("states plainly when the owner owes the borrower", async () => {
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    const kmInput = await screen.findByLabelText("Kørte kilometer")
    await userEvent.clear(kmInput)
    await userEvent.type(kmInput, "10")

    const expenseInput = screen.getByLabelText(
      /Dine udgifter til strøm eller brændstof/,
    )
    await userEvent.clear(expenseInput)
    await userEvent.type(expenseInput, "200")

    // 10 km × 4,00 kr − 200 kr = −160,00 kr
    await waitFor(() => {
      expect(
        screen.getByText(/Ejeren skylder dig 160,00 kr./),
      ).toBeInTheDocument()
    })
  })

  it("shows the practical note on an active loan", async () => {
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Nøglen hænger i skabet")).toBeInTheDocument()
    })
  })

  it("lets an owner accept a request for their own car", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        is_borrower: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [
          {
            id: 7,
            car: 1,
            car_display_name: "Skoda Octavia",
            car_house_name: "Kløverbakkevej 7",
            status: "asked",
            responded_by_name: "",
            responded_at: null,
            is_own_household: true,
          },
        ],
      }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Ja, den må lånes" }),
      ).toBeInTheDocument()
    })
    expect(screen.getByText(/Dit ja er et tilbud/)).toBeInTheDocument()
  })

  it("offers no answer for another household's car in the same request", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        is_borrower: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [
          {
            id: 7,
            car: 1,
            car_display_name: "Skoda Octavia",
            car_house_name: "Kløverbakkevej 7",
            status: "asked",
            responded_by_name: "",
            responded_at: null,
            is_own_household: true,
          },
          {
            id: 9,
            car: 3,
            car_display_name: "Toyota Yaris",
            car_house_name: "Kløverbakkevej 47",
            status: "asked",
            responded_by_name: "",
            responded_at: null,
            is_own_household: false,
          },
        ],
      }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Ja, den må lånes" }),
      ).toHaveLength(1)
    })
    // The owner is told they are one of several asked, while the other
    // household's car stays out of their hands.
    expect(screen.getByText(/Låneren har spurgt 2 biler/)).toBeInTheDocument()
  })

  it("lets the borrower choose between accepted offers", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        car: null,
        candidates: [
          {
            id: 7,
            car: 1,
            car_display_name: "Skoda Octavia",
            car_house_name: "Kløverbakkevej 7",
            status: "accepted",
            responded_by_name: "Ove",
            responded_at: "2027-06-11T10:00:00Z",
            is_own_household: false,
          },
          {
            id: 8,
            car: 2,
            car_display_name: "Toyota Yaris",
            car_house_name: "Kløverbakkevej 8",
            status: "accepted",
            responded_by_name: "Bodil",
            responded_at: "2027-06-11T11:00:00Z",
            is_own_household: false,
          },
        ],
      }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Vælg den bil du vil låne:")).toBeInTheDocument()
    })
    expect(screen.getAllByRole("button", { name: "Vælg" })).toHaveLength(2)
  })
})
