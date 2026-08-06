import { describe, it, expect, vi, beforeEach } from "vitest"

import { fireEvent, screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { notifications } from "@mantine/notifications"

import { render, mockUser } from "../test/testUtils"

import CarSharingPage from "./CarSharingPage"

import { useAuthStore } from "../store/authStore"

import type { Car, CarLoan, CarLoanCandidate, SharedCar } from "../types"

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

const mockGetSharedCars = vi.fn()

const mockGetTerms = vi.fn()

const mockGetLoans = vi.fn()

const mockGetBlocks = vi.fn()

const mockReplaceBlocks = vi.fn()

const mockCompleteLoan = vi.fn()

const mockCancelLoan = vi.fn()

vi.mock("../api/carsharing", async () => {
  const actual =
    await vi.importActual<typeof import("../api/carsharing")>(
      "../api/carsharing",
    )

  return {
    ...actual,

    carSharingApi: {
      getSharedCars: () => mockGetSharedCars(),

      getTerms: () => mockGetTerms(),

      getLoans: () => mockGetLoans(),

      getBlocks: () => mockGetBlocks(),

      getLoan: vi.fn(),

      createBlock: vi.fn(),

      deleteBlock: vi.fn(),

      replaceBlocks: (...args: unknown[]) => mockReplaceBlocks(...args),

      requestLoan: vi.fn(),

      respondToCandidate: vi.fn(),

      completeLoan: (...args: unknown[]) => mockCompleteLoan(...args),

      cancelLoan: (...args: unknown[]) => mockCancelLoan(...args),
    },
  }
})

const mockGetCars = vi.fn()

const mockUpdateCar = vi.fn()

vi.mock("../api/houses", () => ({
  housesApi: {
    getCars: () => mockGetCars(),

    updateCar: (...args: unknown[]) => mockUpdateCar(...args),
  },
}))

function ownCar(overrides: Partial<Car> = {}): Car {
  return {
    id: 7,
    license_plate: "AB12345",
    is_electric: false,
    display_name: "Skoda Octavia",
    is_shared: true,
    rate_per_km: null,
    make: "Skoda",
    model_name: "Octavia",
    color: "blå",
    year: 2020,
    seats: 5,
    has_tow_hitch: false,
    has_isofix: false,
    dogs_allowed: false,
    has_charge_fob: false,
    equipment_note: "",
    practical_note: "",
    terms_accepted_version: "2026-08-01",
    has_accepted_current_terms: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function sharedCar(overrides: Partial<SharedCar> = {}): SharedCar {
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

function candidate(
  overrides: Partial<CarLoanCandidate> = {},
): CarLoanCandidate {
  return {
    id: 7,
    car: 1,
    car_display_name: "Skoda Octavia",
    car_house_name: "Kløverbakkevej 7",
    status: "asked",
    responded_by_name: "",
    responded_at: null,
    is_own_household: true,
    ...overrides,
  }
}

function activeLoan(overrides: Partial<CarLoan> = {}): CarLoan {
  return {
    id: 42,
    borrower: mockUser.id,
    borrower_name: "Test User",
    is_borrower: true,
    viewer_role: "borrower",
    can_cancel: true,
    has_started: true,
    status: "active",
    start_at: "2027-06-12T09:00:00Z",
    end_at: "2027-06-12T14:00:00Z",
    expected_km: 100,
    needs_isofix: false,
    needs_tow_hitch: false,
    min_seats: null,
    note: "",
    terms_version: "2026-08-01",
    owner_terms_version: "2026-08-01",
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

    // The page keeps the selected tab in the URL, and these tests share one
    // jsdom window — without this a test that clicks a tab leaves ?tab= behind
    // and the next one starts on the wrong panel.
    window.history.replaceState({}, "", "/bildeling")

    useAuthStore.setState({ user: mockUser, isAuthenticated: true })

    mockGetTerms.mockResolvedValue({
      version: "2026-08-01",
      title: "Vilkår for lån af bil i delebilparken",
      sections: [
        {
          heading: "Kort fortalt",
          blocks: [
            {
              kind: "paragraph",
              text: "Du er ansvarlig for bilen, mens du har den.",
            },
          ],
        },
        {
          heading: "5. Hvad du betaler, hvis der er sket skade",
          blocks: [
            {
              kind: "bullets",
              items: [
                {
                  lead: "Loft:",
                  text: "dit samlede ansvar er højst 8.000 kr.",
                },
                { lead: "", text: "Prisen er 3,94 kr. pr. kørt km." },
              ],
            },
          ],
        },
      ],
      text: "Vilkår for lån af bil i delebilparken\n\n- Prisen er 3,94 kr. pr. kørt km.",
      default_rate_per_km: "3.94",
      // Consent is per terms version. Most tests borrow as someone who has not
      // accepted yet, so the tick is on screen.
      accepted: false,
      accepted_version: "",
      accepted_at: null,
    })

    mockGetSharedCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      max_loan_days: 30,
      cars: [sharedCar()],
    })

    mockGetLoans.mockResolvedValue([])

    mockGetBlocks.mockResolvedValue([])

    mockGetCars.mockResolvedValue([])
  })

  it("renders the shared car list", async () => {
    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Skoda Octavia")).toBeInTheDocument()
    })
    expect(screen.getByText(/Kløverbakkevej 7/)).toBeInTheDocument()
  })

  it("does not refetch the car list in a loop on mount", async () => {
    render(<CarSharingPage />)

    await waitFor(() => expect(mockGetSharedCars).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(mockGetSharedCars.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("does not refetch in a loop after the 'now' shortcut", async () => {
    render(<CarSharingPage />)

    await waitFor(() => expect(mockGetSharedCars).toHaveBeenCalled())

    await userEvent.click(
      screen.getByRole("button", { name: /Nu og de næste 2 timer/ }),
    )
    const afterClick = mockGetSharedCars.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 400))

    // One fetch for the new window is expected; a storm is not.
    expect(
      mockGetSharedCars.mock.calls.length - afterClick,
    ).toBeLessThanOrEqual(1)
  })

  it("folds the terms away but keeps the consent reachable", async () => {
    render(<CarSharingPage />)

    // The heading and the checkbox are always there; the full agreement runs to a
    // dozen sections and would otherwise push the consent far below the fold.
    await waitFor(() => {
      expect(
        screen.getByText("Vilkår for lån af bil i delebilparken"),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole("checkbox", {
        name: "Jeg har læst og accepterer vilkårene",
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Prisen er 3,94 kr. pr. kørt km."),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Kort fortalt")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Læs vilkårene" }))

    expect(
      await screen.findByText("Prisen er 3,94 kr. pr. kørt km."),
    ).toBeInTheDocument()
    // Section headings and paragraphs survive, not just the points.
    expect(screen.getByText("Kort fortalt")).toBeInTheDocument()
    expect(
      screen.getByText("5. Hvad du betaler, hvis der er sket skade"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Du er ansvarlig for bilen, mens du har den."),
    ).toBeInTheDocument()
    // A bold lead renders as emphasis, not as literal asterisks.
    expect(screen.getByText(/Loft:/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain("**")
  })

  it("marks a car that is normally busy but keeps it selectable", async () => {
    mockGetSharedCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      max_loan_days: 30,
      cars: [
        sharedCar({
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
    mockGetSharedCars.mockResolvedValue({
      start: "2027-06-12T09:00:00Z",
      end: "2027-06-12T11:00:00Z",
      default_rate_per_km: "3.94",
      max_candidates: 5,
      max_loan_days: 30,
      cars: [
        sharedCar({
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
        screen.getByText(/Du spørger 1 husstand om 1 af højst 5 biler/),
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
        viewer_role: "asked",
        can_cancel: false,
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
    // A yes is now the whole decision, so the copy must not promise a later step.
    expect(
      screen.getByText(/er bilen udlånt med det samme/),
    ).toBeInTheDocument()
  })

  it("offers no answer for another household's car in the same request", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        is_borrower: false,
        viewer_role: "asked",
        can_cancel: false,
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

  it("gives the borrower nothing to pick while waiting for a yes", async () => {
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
            status: "asked",
            responded_by_name: "",
            responded_at: null,
            is_own_household: false,
          },
          {
            id: 8,
            car: 2,
            car_display_name: "Toyota Yaris",
            car_house_name: "Kløverbakkevej 8",
            status: "declined",
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
      // Scoped to the loan card: the request form carries similar copy.
      expect(
        screen.getByText(/Afventer svar\. Den første ejer der siger ja/),
      ).toBeInTheDocument()
    })
    // The choose step is gone: a yes settles it without the borrower acting.
    expect(
      screen.queryByRole("button", { name: "Vælg" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Skoda Octavia \(afventer\), Toyota Yaris \(nej\)/),
    ).toBeInTheDocument()
  })

  it("keeps each of my cars collapsed until I open it", async () => {
    mockGetCars.mockResolvedValue([ownCar()])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))

    // The summary identifies the car and says whether it is shared...
    await waitFor(() => {
      expect(screen.getByText("I delebilparken")).toBeInTheDocument()
    })
    // ...but none of the options are reachable yet.
    expect(screen.queryByLabelText("Mærke")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Gem ændringer" }),
    ).not.toBeInTheDocument()
    // A collapsed card has no schedule to fetch.
    expect(mockGetBlocks).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await waitFor(() => {
      expect(screen.getByLabelText("Mærke")).toBeInTheDocument()
    })
    expect(mockGetBlocks).toHaveBeenCalled()

    // One save for the whole card. The fields and the week schedule used to have
    // a button each, which left a household wondering whether to press both.
    expect(screen.getAllByRole("button", { name: /^Gem/ })).toHaveLength(1)
    const save = screen.getByRole("button", { name: "Gem ændringer" })
    expect(save).toBeDisabled()
    expect(screen.getByText("Alt er gemt.")).toBeInTheDocument()
    expect(screen.queryByText("Ikke gemt")).not.toBeInTheDocument()
  })

  /** A save that the car list then reflects, the way the server's would. */
  function updateCarLikeTheServer(overrides: Partial<Car>) {
    mockUpdateCar.mockImplementation(async () => {
      const saved = ownCar(overrides)
      mockGetCars.mockResolvedValue([saved])
      return saved
    })
  }

  it("saves the fields and the painted week in a single press", async () => {
    mockGetCars.mockResolvedValue([ownCar()])
    updateCarLikeTheServer({ color: "sort" })
    mockReplaceBlocks.mockResolvedValue([
      {
        id: 1,
        days_of_week: [0],
        start_time: "07:00:00",
        end_time: "08:00:00",
      },
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await userEvent.clear(await screen.findByLabelText("Farve"))
    await userEvent.type(screen.getByLabelText("Farve"), "sort")
    fireEvent.pointerDown(screen.getByRole("button", { name: "Man 07:00" }))
    fireEvent.pointerUp(window)

    // The card says what the one press covers, and admits it even folded away.
    expect(
      screen.getByText("Bilens oplysninger og ugeskemaet er ændret."),
    ).toBeInTheDocument()
    expect(screen.getByText("Ikke gemt")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Gem ændringer" }))

    await waitFor(() => {
      expect(mockUpdateCar).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ color: "sort" }),
      )
    })
    expect(mockReplaceBlocks).toHaveBeenCalledWith(7, [
      { days_of_week: [0], start_time: "07:00", end_time: "08:00" },
    ])
    await waitFor(() => {
      expect(screen.getByText("Alt er gemt.")).toBeInTheDocument()
    })
  })

  it("only sends the half that changed", async () => {
    // Painting a week must not also re-PATCH fifteen untouched fields, and vice
    // versa — otherwise one button would mean two requests every time.
    mockGetCars.mockResolvedValue([ownCar()])
    mockReplaceBlocks.mockResolvedValue([])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Man 07:00" }),
    )
    fireEvent.pointerUp(window)
    expect(screen.getByText("Ugeskemaet er ændret.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Gem ændringer" }))

    await waitFor(() => {
      expect(mockReplaceBlocks).toHaveBeenCalled()
    })
    expect(mockUpdateCar).not.toHaveBeenCalled()
  })

  it("keeps a painted week when only the schedule fails to save", async () => {
    // Two endpoints behind one button, so a press can land halfway. The week has
    // to survive for "prøv at gemme igen" to be a real instruction.
    mockGetCars.mockResolvedValue([ownCar()])
    updateCarLikeTheServer({ color: "sort" })
    mockReplaceBlocks.mockRejectedValue(new Error("offline"))

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await userEvent.clear(await screen.findByLabelText("Farve"))
    await userEvent.type(screen.getByLabelText("Farve"), "sort")
    fireEvent.pointerDown(screen.getByRole("button", { name: "Man 07:00" }))
    fireEvent.pointerUp(window)

    await userEvent.click(screen.getByRole("button", { name: "Gem ændringer" }))

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Ugeskemaet blev ikke gemt",
          message: expect.stringContaining("Bilens oplysninger er gemt"),
          color: "red",
        }),
      )
    })
    // The refetch that follows a failed save must not wipe the painted hour.
    await waitFor(() => {
      expect(screen.getByText("Ugeskemaet er ændret.")).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: "Man 07:00" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: "Gem ændringer" })).toBeEnabled()
  })

  it("lets me put the whole card back the way it was", async () => {
    mockGetCars.mockResolvedValue([ownCar()])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await userEvent.clear(await screen.findByLabelText("Farve"))
    fireEvent.pointerDown(screen.getByRole("button", { name: "Man 07:00" }))
    fireEvent.pointerUp(window)

    expect(screen.getByRole("button", { name: "Man 07:00" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByText("Ikke gemt")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Fortryd" }))

    expect(screen.getByLabelText("Farve")).toHaveValue("blå")
    expect(screen.getByRole("button", { name: "Man 07:00" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByText("Alt er gemt.")).toBeInTheDocument()
    expect(mockUpdateCar).not.toHaveBeenCalled()
    expect(mockReplaceBlocks).not.toHaveBeenCalled()
  })

  it("marks a car that is not shared and one that cannot be", async () => {
    mockGetCars.mockResolvedValue([
      ownCar({ is_shared: false, license_plate: "", display_name: "Skoda" }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))

    await waitFor(() => {
      expect(screen.getByText("Ikke delt")).toBeInTheDocument()
    })
    expect(screen.getByText("Mangler nummerplade")).toBeInTheDocument()
  })

  it("lets me fill in the missing plate on the car itself", async () => {
    // The card is where the "Mangler nummerplade" warning appears, so it has to
    // be where the plate can be typed — the fix used to live on another page.
    mockGetCars.mockResolvedValue([
      ownCar({ is_shared: false, license_plate: "", display_name: "Skoda" }),
    ])
    mockUpdateCar.mockResolvedValue(ownCar())

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda/ }),
    )

    const plate = await screen.findByLabelText("Nummerplade")
    await userEvent.type(plate, "cd45678")
    // Stored uppercase, so the input does not let two spellings of one plate in.
    expect(plate).toHaveValue("CD45678")

    await userEvent.click(screen.getByRole("button", { name: "Gem ændringer" }))

    await waitFor(() => {
      expect(mockUpdateCar).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ license_plate: "CD45678" }),
      )
    })
  })

  it("will not share a car until it has a plate", async () => {
    mockGetCars.mockResolvedValue([
      ownCar({ is_shared: false, license_plate: "", display_name: "Skoda" }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda/ }),
    )

    // Nothing edited yet, so there is nothing to save either way.
    const save = await screen.findByRole("button", { name: "Gem ændringer" })
    expect(save).toBeDisabled()
    expect(screen.getByText("Alt er gemt.")).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("switch", { name: "Med i delebilparken" }),
    )
    // Now there is something to save, and a reason it cannot be.
    expect(save).toBeDisabled()
    expect(
      screen.getByText(/Udfyld nummerpladen, eller slå/),
    ).toBeInTheDocument()

    // Typing the plate clears both the block and the warning above the form.
    await userEvent.type(screen.getByLabelText("Nummerplade"), "CD45678")

    expect(save).toBeEnabled()
    expect(
      screen.queryByText(
        "Bilen skal have en nummerplade for at kunne være i delebilparken.",
      ),
    ).not.toBeInTheDocument()
    expect(mockUpdateCar).not.toHaveBeenCalled()
  })

  it("will not send a request until the terms are confirmed", async () => {
    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Skoda Octavia")).toBeInTheDocument()
    })
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Vælg Skoda Octavia/ }),
    )

    const send = screen.getByRole("button", { name: /Send forespørgsel/ })
    expect(send).toBeDisabled()

    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Jeg har læst og accepterer vilkårene",
      }),
    )

    expect(send).toBeEnabled()
  })

  it("does not ask a borrower who has already accepted the terms", async () => {
    // Consent belongs to a version of the text, not to a single loan. Asking at
    // every request is what teaches people to tick without reading.
    mockGetTerms.mockResolvedValue({
      version: "2026-08-01",
      title: "Vilkår for lån af bil i delebilparken",
      sections: [],
      text: "Vilkår",
      default_rate_per_km: "3.94",
      accepted: true,
      accepted_version: "2026-08-01",
      accepted_at: "2027-06-01T08:00:00Z",
    })

    render(<CarSharingPage />)

    await waitFor(() => {
      expect(screen.getByText("Skoda Octavia")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("checkbox", {
        name: "Jeg har læst og accepterer vilkårene",
      }),
    ).not.toBeInTheDocument()
    // Silence would look like a form that forgot to ask, so it says why.
    expect(
      screen.getByText(/Du accepterede disse vilkår.*ikke spurgt igen/),
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("checkbox", { name: /Vælg Skoda Octavia/ }),
    )

    // Nothing left to confirm: picking a car is enough to send.
    expect(
      screen.getByRole("button", { name: /Send forespørgsel/ }),
    ).toBeEnabled()
  })

  it("makes an owner accept the terms before sharing a car", async () => {
    mockGetCars.mockResolvedValue([
      ownCar({
        is_shared: true,
        terms_accepted_version: "",
        has_accepted_current_terms: false,
      }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await waitFor(() => {
      expect(screen.getByText("Vilkår mangler accept")).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Gem ændringer" }),
      ).toBeDisabled()
    })
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: /Jeg har læst og accepterer vilkårene for at udlåne min bil/,
      }),
    )

    // The tick is the only thing to save on a car that is already shared, so it
    // has to count as a change of its own.
    expect(screen.getByRole("button", { name: "Gem ændringer" })).toBeEnabled()
  })

  it("does not re-ask an owner who already accepted the current terms", async () => {
    mockGetCars.mockResolvedValue([
      ownCar({ has_accepted_current_terms: true }),
    ])

    render(<CarSharingPage />)

    await userEvent.click(screen.getByRole("tab", { name: "Mine biler" }))
    await userEvent.click(
      screen.getByRole("button", { name: /Indstillinger for Skoda Octavia/ }),
    )

    await waitFor(() => {
      expect(screen.getByLabelText("Mærke")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("checkbox", {
        name: /accepterer vilkårene for at udlåne/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Vilkår mangler accept")).not.toBeInTheDocument()
  })

  // --- What a household that is not party to the loan may see ----------------

  it("shows a closed-out household nothing but the fact that it is closed", async () => {
    // The server withholds the private fields; the card must not imply otherwise.
    mockGetLoans.mockResolvedValue([
      activeLoan({
        is_borrower: false,
        viewer_role: "closed_out",
        can_cancel: false,
        borrower_name: "Bo Låner",
        car_practical_note: "",
        amount_due: null,
        candidates: [candidate({ status: "closed" })],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      // Names the car, so several closed cards in "Tidligere" stay apart.
      expect(
        screen.getByText(
          "En anden ejer var først — du skal ikke gøre mere. (Skoda Octavia)",
        ),
      ).toBeInTheDocument()
    })
    expect(screen.getByText("Lukket")).toBeInTheDocument()
    // No dead button, no other household's key, no settlement.
    expect(
      screen.queryByRole("button", { name: "Aflys" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Nøglen hænger i skabet")).not.toBeInTheDocument()
    expect(screen.queryByText(/Aktivt lån/)).not.toBeInTheDocument()
  })

  it("tells a household that said no that it said no", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        is_borrower: false,
        viewer_role: "declined",
        can_cancel: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [candidate({ status: "declined" })],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    // It used to still read "Afventer svar", as if they owed an answer.
    await waitFor(() => {
      expect(screen.getByText("Du sagde nej")).toBeInTheDocument()
    })
    expect(screen.queryByText("Afventer svar")).not.toBeInTheDocument()
  })

  // --- The card must not describe things that did not happen ----------------

  it("tells a closed-out household who actually ended the request", async () => {
    // The borrower withdrew; there was no rival owner. This card used to say
    // "En anden ejer var først" while the notification beside it said the
    // borrower had cancelled.
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "cancelled",
        is_borrower: false,
        viewer_role: "closed_out",
        can_cancel: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [candidate({ status: "closed" })],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByText(/Bo Låner har aflyst forespørgslen/),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/En anden ejer var først/),
    ).not.toBeInTheDocument()
  })

  it("does not say anyone borrowed a car when nobody did", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "declined",
        is_borrower: true,
        can_cancel: false,
        car: null,
        candidates: [
          candidate({ status: "declined", is_own_household: false }),
        ],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    // "Du lånte" for a request no owner ever accepted.
    await waitFor(() => {
      expect(screen.getByText(/Du ville låne/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Du lånte/)).not.toBeInTheDocument()
  })

  it("marks a loan cancelled after the car went out as unsettled", async () => {
    // Cancelling never settles, so the km bill is silently void — that has to
    // read differently from a request withdrawn before anyone lent anything.
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "cancelled",
        is_borrower: true,
        can_cancel: false,
        activated_at: "2027-06-10T09:00:00Z",
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Aflyst uden afregning")).toBeInTheDocument()
    })
    // A car did go out, so the past tense is right here.
    expect(screen.getByText(/Du lånte/)).toBeInTheDocument()
  })

  it("shows the kilometres actually driven on a settled loan", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "completed",
        is_borrower: true,
        can_cancel: false,
        expected_km: 25,
        actual_km: 29,
        rate_per_km: "3.94",
        amount_due: "114.26",
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    // The estimate used to sit 60px above the bill it disagreed with. Matched
    // on the header line specifically — the breakdown below also says "29 km".
    await waitFor(() => {
      expect(screen.getByText(/Du lånte · 29 km/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/ca\. 25 km/)).not.toBeInTheDocument()
  })

  it("renders an owner's own no instead of silently dropping the row", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "requested",
        is_borrower: false,
        viewer_role: "asked",
        can_cancel: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [
          candidate({
            id: 7,
            status: "declined",
            car_display_name: "Skoda Octavia",
          }),
          candidate({
            id: 8,
            car: 2,
            status: "asked",
            car_display_name: "Toyota Yaris",
          }),
        ],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByText("I har sagt nej til Skoda Octavia."),
      ).toBeInTheDocument()
    })
    // The unanswered car still offers both buttons.
    expect(
      screen.getByRole("button", { name: "Ja, den må lånes" }),
    ).toBeInTheDocument()
  })

  it("offers no answer buttons on a request the borrower withdrew", async () => {
    // The server now reports closed_out here, and the card double-checks the
    // status: an answerable request is by definition still open.
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "cancelled",
        is_borrower: false,
        viewer_role: "closed_out",
        can_cancel: false,
        car: null,
        borrower_name: "Bo Låner",
        candidates: [candidate({ status: "closed" })],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Lukket")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: "Ja, den må lånes" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Nej" }),
    ).not.toBeInTheDocument()
  })

  // --- Cancelling ------------------------------------------------------------

  it("only offers cancel when the server says it is allowed", async () => {
    mockGetLoans.mockResolvedValue([activeLoan({ can_cancel: false })])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Aktivt lån")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: "Aflys" }),
    ).not.toBeInTheDocument()
  })

  it("asks before voiding the km bill, and does nothing if you say no", async () => {
    mockGetLoans.mockResolvedValue([activeLoan({ can_cancel: true })])
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false)

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    const button = await screen.findByRole("button", { name: "Aflys" })
    await userEvent.click(button)

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("uden at afregne"),
    )
    expect(mockCancelLoan).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it("calls the owner's cancel a withdrawal, not a cancellation", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        is_borrower: false,
        viewer_role: "lender",
        can_cancel: true,
        borrower_name: "Bo Låner",
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Træk bilen tilbage" }),
      ).toBeInTheDocument()
    })
  })

  // --- Settlement ------------------------------------------------------------

  it("shows a breakdown the owner can reconcile", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "completed",
        is_borrower: false,
        viewer_role: "lender",
        can_cancel: false,
        borrower_name: "Bo Låner",
        rate_per_km: "3.94",
        actual_km: 120,
        expense_amount: "50.50",
        expense_note: "Ladning i Aarhus",
        amount_due: "422.30",
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    // 120 × 3,94 = 472,80 — unreconcilable without the deduction being shown.
    await waitFor(() => {
      expect(
        screen.getByText(/120 km × 3,94 kr\. − 50,50 kr\. i udgifter/),
      ).toBeInTheDocument()
    })
    expect(screen.getByText(/Ladning i Aarhus/)).toBeInTheDocument()
    expect(
      screen.getByText("Bo Låner skal betale dig 422,30 kr."),
    ).toBeInTheDocument()
  })

  it("invites a message rather than only damage when closing a loan", async () => {
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    // A field that only names damage invites nothing else — most of what people
    // write here is "tak for lån".
    expect(
      await screen.findByLabelText("Besked til ejeren (valgfrit)"),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText("Skader eller ting der ikke virker (valgfrit)"),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Fx\. tak for lån/)).toBeInTheDocument()
  })

  it("presents the borrower's message as a message, not a warning", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "completed",
        is_borrower: false,
        viewer_role: "lender",
        can_cancel: false,
        borrower_name: "Bo Låner",
        actual_km: 40,
        amount_due: "160.00",
        damage_note: "Tak for lån!",
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText("Tak for lån!")).toBeInTheDocument()
    })
    // Labelled, so the owner knows who wrote it — and framed neutrally, because
    // an orange warning triangle turned every courtesy into a claim.
    expect(screen.getByText("Besked fra låneren")).toBeInTheDocument()
  })

  it("prefixes dates with the weekday", async () => {
    // "12. jun." makes an owner count; "lør. 12. jun." does not.
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByText(/^(man|tir|ons|tor|fre|lør|søn)\. \d{1,2}\. /),
      ).toBeInTheDocument()
    })
  })

  // --- The borrow tab --------------------------------------------------------

  it("reports a failure instead of an empty delebilpark", async () => {
    mockGetSharedCars.mockRejectedValue({
      response: { data: { end: ["Et lån kan højst vare 30 dage."] } },
    })

    render(<CarSharingPage />)

    await waitFor(() => {
      expect(
        screen.getByText("Et lån kan højst vare 30 dage."),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByText("Der er ingen biler i delebilparken endnu."),
    ).not.toBeInTheDocument()
  })

  it("says nobody is coming when every household declined", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({
        status: "declined",
        car: null,
        // Two *households*, so the count means what the sentence says. Both
        // candidates used to share one house name, which is the miscount this
        // line now guards against.
        candidates: [
          candidate({ id: 7, status: "declined", is_own_household: false }),
          candidate({
            id: 8,
            car: 2,
            car_house_name: "Kløverbakkevej 9",
            status: "declined",
            is_own_household: false,
          }),
        ],
      }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(
        screen.getByText(/Alle 2 spurgte husstande har sagt nej/),
      ).toBeInTheDocument()
    })
    // And it must not still claim a yes might arrive. Scoped to the card's own
    // phrasing: the borrow tab carries similar copy and is always mounted.
    expect(
      screen.queryByText(/Afventer svar\. Den første ejer der siger ja/),
    ).not.toBeInTheDocument()
  })

  it("does not open the settlement form before the loan starts", async () => {
    mockGetLoans.mockResolvedValue([
      activeLoan({ has_started: false, start_at: "2027-06-12T09:00:00Z" }),
    ])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    await waitFor(() => {
      expect(screen.getByText(/Aftalt · starter/)).toBeInTheDocument()
    })
    expect(screen.queryByLabelText("Kørte kilometer")).not.toBeInTheDocument()

    // Someone who really did drive early can still get at it.
    await userEvent.click(
      screen.getByRole("button", { name: "Afslut alligevel" }),
    )
    expect(await screen.findByLabelText("Kørte kilometer")).toBeInTheDocument()
  })

  it("refuses a garbled expense amount before submitting it", async () => {
    mockGetLoans.mockResolvedValue([activeLoan()])

    render(<CarSharingPage />)
    await userEvent.click(screen.getByRole("tab", { name: "Mine lån" }))

    const expenseInput = await screen.findByLabelText(
      /Dine udgifter til strøm eller brændstof/,
    )
    await userEvent.clear(expenseInput)
    await userEvent.type(expenseInput, "50 kr")

    // It used to preview a tidy total and then fail on the server in English.
    await waitFor(() => {
      expect(screen.getByText(/Skriv kun et beløb/)).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: "Afslut lån" })).toBeDisabled()
  })
})
