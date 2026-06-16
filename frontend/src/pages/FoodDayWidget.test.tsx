import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { screen, act, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render, mockUser, renderWithProviders } from "../test/testUtils"

import { FoodDayWidget } from "./DashboardPage"

import { useAuthStore } from "../store/authStore"

import type { MealRegistration, FoodTicket } from "../types"

// ---------------------------------------------------------------------------

// Mocks

// ---------------------------------------------------------------------------

const mockCreateRegistration = vi.fn()

const mockUpdateRegistration = vi.fn()

const mockCreateTicket = vi.fn()

vi.mock("../api/food", () => ({
  foodApi: {
    createRegistration: (...args: unknown[]) => mockCreateRegistration(...args),

    updateRegistration: (...args: unknown[]) => mockUpdateRegistration(...args),

    createTicket: (...args: unknown[]) => mockCreateTicket(...args),

    getRegistrations: vi.fn().mockResolvedValue([]),

    getRegistrationStats: vi.fn().mockResolvedValue({}),

    getMyTickets: vi.fn().mockResolvedValue([]),

    getTickets: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

vi.mock("../utils/errorNotification", () => ({
  showErrorNotification: vi.fn(),
}))

// Control deadline logic from tests

let mockIsDateLocked = false

let mockIsAfterTicketSaleCutoff = false

vi.mock("../utils/foodDeadline", () => ({
  isDateLocked: () => mockIsDateLocked,

  isAfterTicketSaleCutoff: () => mockIsAfterTicketSaleCutoff,
}))

// ---------------------------------------------------------------------------

// Helpers

// ---------------------------------------------------------------------------

/** A pre-deadline Monday far in the future so dayjs never considers it "past". */

const FUTURE_MONDAY = "2026-06-15"

function makeRegistration(
  overrides: Partial<MealRegistration> = {},
): MealRegistration {
  return {
    id: 42,

    date: FUTURE_MONDAY,

    day_of_week: 0,

    day_name: "mandag",

    adults_meat: 0,

    adults_veg: 2,

    children_count: 0,

    dining_option: "eat_in",

    seating_time: "17:30",

    house: { id: 1, name: "House 1" },

    is_active: true,

    total_portions: 2,

    is_locked: false,

    available_portions: { adults_meat: 0, adults_veg: 0, children_count: 0 },

    created_at: "2026-06-10T12:00:00Z",

    updated_at: "2026-06-10T12:00:00Z",

    ...overrides,
  }
}

function makeTicket(overrides: Partial<FoodTicket> = {}): FoodTicket {
  return {
    id: 1,

    owner: {
      id: 1,

      first_name: "Test",

      last_name: "User",

      profile_picture: null,

      phone_number: "12345678",
    },

    date: FUTURE_MONDAY,

    day_of_week: 0,

    day_name: "mandag",

    adults_meat: 0,

    adults_veg: 1,

    children_count: 0,

    price: "26.00",

    is_free: false,

    description: "",

    is_available: true,

    claimed_by: null,

    claimed_at: null,

    total_portions: 1,

    is_own: true,

    created_at: "2026-06-10T12:00:00Z",

    ...overrides,
  }
}

const defaultProps = {
  date: FUTURE_MONDAY,

  dayName: "mandag",

  menuText: "Vegansk curry med ris",

  label: "I morgen",

  isToday: false,
}

function renderWidget(
  overrides: Partial<Parameters<typeof FoodDayWidget>[0]> = {},
) {
  return render(<FoodDayWidget {...defaultProps} {...overrides} />)
}

// ---------------------------------------------------------------------------

// Setup

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })

  // Pin "now" to a fixed point before FUTURE_MONDAY so the widget never treats
  // the test date as past (otherwise the suite breaks once the real clock
  // passes FUTURE_MONDAY).
  vi.setSystemTime(new Date("2026-06-10T12:00:00"))

  vi.clearAllMocks()

  mockIsDateLocked = false

  mockIsAfterTicketSaleCutoff = false

  mockCreateRegistration.mockResolvedValue(makeRegistration())

  mockUpdateRegistration.mockResolvedValue(makeRegistration())

  mockCreateTicket.mockResolvedValue(makeTicket())

  useAuthStore.setState({
    user: mockUser,

    isAuthenticated: true,

    isLoading: false,

    error: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

// Auto-save behaviour

// ---------------------------------------------------------------------------

describe("FoodDayWidget auto-save", () => {
  it("does not save on initial mount when registration is loaded", async () => {
    const reg = makeRegistration()

    renderWidget({ registration: reg })

    await act(() => vi.advanceTimersByTime(1000))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("does not save on initial mount when registration is undefined", async () => {
    renderWidget({ registration: undefined })

    await act(() => vi.advanceTimersByTime(1000))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("does not save when registration values match defaults (eat_in, 17:30, active)", async () => {
    const reg = makeRegistration({
      dining_option: "eat_in",

      seating_time: "17:30",

      is_active: true,
    })

    renderWidget({ registration: reg })

    await act(() => vi.advanceTimersByTime(1000))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("saves via UPDATE when user changes seating time", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ seating_time: "17:30" })

    renderWidget({ registration: reg })

    // Click the "18:30" button

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockUpdateRegistration).toHaveBeenCalledTimes(1)

    const [id, data] = mockUpdateRegistration.mock.calls[0]

    expect(id).toBe(42)

    expect(data.seating_time).toBe("18:30")
  })

  it("saves via UPDATE when user changes dining option", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ dining_option: "eat_in" })

    renderWidget({ registration: reg })

    const takeAway = screen.getByRole("radio", { name: "Tag med" })

    await user.click(takeAway)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockUpdateRegistration).toHaveBeenCalledTimes(1)

    expect(mockUpdateRegistration.mock.calls[0][1].dining_option).toBe(
      "take_away",
    )
  })

  it("saves via UPDATE when user toggles to 'Spiser ikke'", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ is_active: true })

    renderWidget({ registration: reg })

    const notEating = screen.getByRole("radio", { name: "Spiser ikke" })

    await user.click(notEating)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockUpdateRegistration).toHaveBeenCalledTimes(1)

    expect(mockUpdateRegistration.mock.calls[0][1].is_active).toBe(false)
  })

  it("calls createRegistration when registration has no id (pre-deadline)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ id: null, seating_time: "17:30" })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockCreateRegistration).toHaveBeenCalledTimes(1)

    expect(mockUpdateRegistration).not.toHaveBeenCalled()

    expect(mockCreateRegistration.mock.calls[0][0].seating_time).toBe("18:30")
  })

  it("does NOT attempt CREATE for locked dates without registration id", async () => {
    mockIsDateLocked = true

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    // Locked date, registration exists but no id (edge case)

    const reg = makeRegistration({ id: null, seating_time: "17:30" })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("sends portion counts from the registration, not defaults", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({
      adults_meat: 0,

      adults_veg: 3,

      children_count: 1,

      seating_time: "17:30",
    })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    const data = mockUpdateRegistration.mock.calls[0][1]

    expect(data.adults_meat).toBe(0)

    expect(data.adults_veg).toBe(3)

    expect(data.children_count).toBe(1)
  })

  it("does not double-save when switching seating time twice within debounce window", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ seating_time: "17:30" })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    const btn1730 = screen.getByRole("radio", { name: "17:30" })

    // Two quick changes within 500ms debounce

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(200))

    await user.click(btn1730)

    await act(() => vi.advanceTimersByTime(600))

    // Second click set seatingTime back to 17:30 which matches registration

    // → the debounced callback fires but only the last state matters.

    // The debounce ensures at most one API call.

    expect(mockUpdateRegistration.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------

// Sync effect: registration prop changes

// ---------------------------------------------------------------------------

describe("FoodDayWidget sync from server", () => {
  it("does not save when registration prop updates with same values as local state", async () => {
    const reg1 = makeRegistration({ seating_time: "17:30" })

    const { rerender } = renderWithProviders(
      <FoodDayWidget {...defaultProps} registration={reg1} />,
    )

    // Simulate refetch returning identical data (new object, same values)

    const reg2 = makeRegistration({ seating_time: "17:30" })

    rerender(<FoodDayWidget {...defaultProps} registration={reg2} />)

    await act(() => vi.advanceTimersByTime(1000))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("does not save when registration prop updates with different values (sync, not user change)", async () => {
    // Start with 17:30

    const reg1 = makeRegistration({ seating_time: "17:30" })

    const { rerender } = renderWithProviders(
      <FoodDayWidget {...defaultProps} registration={reg1} />,
    )

    await act(() => vi.advanceTimersByTime(100))

    // Another household member changes to 18:30 — refetch updates the prop.

    // The sync effect updates local state to 18:30.

    // Auto-save should NOT fire because local state matches the new registration.

    const reg2 = makeRegistration({ seating_time: "18:30" })

    rerender(<FoodDayWidget {...defaultProps} registration={reg2} />)

    await act(() => vi.advanceTimersByTime(1000))

    expect(mockCreateRegistration).not.toHaveBeenCalled()

    expect(mockUpdateRegistration).not.toHaveBeenCalled()
  })

  it("allows saving after sync — the skip logic does not get stuck", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg1 = makeRegistration({ seating_time: "17:30" })

    const { rerender } = renderWithProviders(
      <FoodDayWidget {...defaultProps} registration={reg1} />,
    )

    // Simulate a refetch (no change)

    const reg2 = makeRegistration({ seating_time: "17:30" })

    rerender(<FoodDayWidget {...defaultProps} registration={reg2} />)

    await act(() => vi.advanceTimersByTime(100))

    // Now the user makes a change — it should save

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockUpdateRegistration).toHaveBeenCalledTimes(1)

    expect(mockUpdateRegistration.mock.calls[0][1].seating_time).toBe("18:30")
  })

  it("saves correctly after multiple refetch cycles", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ seating_time: "17:30" })

    const { rerender } = renderWithProviders(
      <FoodDayWidget {...defaultProps} registration={reg} />,
    )

    // Simulate 3 refetches returning the same data

    for (let i = 0; i < 3; i++) {
      const r = makeRegistration({ seating_time: "17:30" })

      rerender(<FoodDayWidget {...defaultProps} registration={r} />)

      await act(() => vi.advanceTimersByTime(100))
    }

    // User change should still trigger save

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(mockUpdateRegistration).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------

// UI rendering

// ---------------------------------------------------------------------------

describe("FoodDayWidget UI", () => {
  it("renders menu text", () => {
    renderWidget({ registration: makeRegistration() })

    expect(screen.getByText("Vegansk curry med ris")).toBeInTheDocument()
  })

  it("shows placeholder when no menu text", () => {
    renderWidget({ registration: makeRegistration(), menuText: "" })

    expect(screen.getByText("Menu kommer snart")).toBeInTheDocument()
  })

  it("renders the label badge", () => {
    renderWidget({ registration: makeRegistration(), label: "I dag" })

    expect(screen.getByText("I dag")).toBeInTheDocument()
  })

  it("renders day name", () => {
    renderWidget({ registration: makeRegistration() })

    expect(screen.getByText("mandag")).toBeInTheDocument()
  })

  it("shows 'Spiser' and 'Spiser ikke' controls", () => {
    renderWidget({ registration: makeRegistration() })

    expect(screen.getByRole("radio", { name: "Spiser" })).toBeInTheDocument()

    expect(
      screen.getByRole("radio", { name: "Spiser ikke" }),
    ).toBeInTheDocument()
  })

  it("shows dining option controls when eating", () => {
    renderWidget({ registration: makeRegistration({ is_active: true }) })

    expect(
      screen.getByRole("radio", { name: "Fælleshuset" }),
    ).toBeInTheDocument()

    expect(screen.getByRole("radio", { name: "Tag med" })).toBeInTheDocument()
  })

  it("shows seating time controls when dining in", () => {
    renderWidget({
      registration: makeRegistration({
        is_active: true,

        dining_option: "eat_in",
      }),
    })

    expect(screen.getByRole("radio", { name: "17:30" })).toBeInTheDocument()

    expect(screen.getByRole("radio", { name: "18:30" })).toBeInTheDocument()
  })

  it("hides seating time controls when take-away", () => {
    renderWidget({
      registration: makeRegistration({
        is_active: true,

        dining_option: "take_away",
      }),
    })

    expect(screen.queryByRole("radio", { name: "17:30" })).toBeNull()

    expect(screen.queryByRole("radio", { name: "18:30" })).toBeNull()
  })

  it("hides dining/seating controls when not eating", () => {
    renderWidget({ registration: makeRegistration({ is_active: false }) })

    expect(
      screen.queryByRole("radio", { name: "Fælleshuset" }),
    ).not.toBeInTheDocument()

    expect(screen.queryByRole("radio", { name: "17:30" })).toBeNull()
  })

  it("shows registration summary for active registration", () => {
    renderWidget({
      registration: makeRegistration({ adults_veg: 2, is_active: true }),
    })

    expect(screen.getByText(/Tilmeldt:/)).toBeInTheDocument()

    expect(screen.getByText(/2 voksne/)).toBeInTheDocument()
  })

  it("shows 'Spiser ikke' summary for inactive registration", () => {
    renderWidget({ registration: makeRegistration({ is_active: false }) })

    // The summary text and the SegmentedControl label both say "Spiser ikke",

    // so target the paragraph summary specifically.

    const summary = screen.getAllByText("Spiser ikke")

    const paragraph = summary.find((el) => el.tagName === "P")

    expect(paragraph).toBeInTheDocument()
  })

  it("shows 'Ikke tilmeldt endnu' when no registration", () => {
    renderWidget({ registration: undefined })

    expect(screen.getByText("Ikke tilmeldt endnu")).toBeInTheDocument()
  })

  it("shows 'Bestilt' badge when date is locked", () => {
    mockIsDateLocked = true

    renderWidget({ registration: makeRegistration() })

    expect(screen.getByText("Bestilt")).toBeInTheDocument()
  })

  it("does not show 'Bestilt' badge when date is unlocked", () => {
    mockIsDateLocked = false

    renderWidget({ registration: makeRegistration() })

    expect(screen.queryByText("Bestilt")).not.toBeInTheDocument()
  })

  it("disables eating toggle when date is locked", () => {
    mockIsDateLocked = true

    renderWidget({ registration: makeRegistration({ is_active: true }) })

    const spiser = screen.getByRole("radio", { name: "Spiser" })

    expect(spiser).toBeDisabled()
  })

  it("shows 'Ikke tilmeldt' text for locked date with inactive registration", () => {
    mockIsDateLocked = true

    renderWidget({ registration: makeRegistration({ is_active: false }) })

    expect(screen.getByText("Ikke tilmeldt")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

// Sell ticket button

// ---------------------------------------------------------------------------

describe("FoodDayWidget sell ticket", () => {
  it("shows sell button when locked with available portions", () => {
    mockIsDateLocked = true

    renderWidget({
      registration: makeRegistration({
        is_active: true,

        available_portions: {
          adults_meat: 0,

          adults_veg: 1,

          children_count: 0,
        },
      }),
    })

    expect(
      screen.getByRole("button", { name: /sælg billet/i }),
    ).toBeInTheDocument()
  })

  it("hides sell button when no available portions", () => {
    mockIsDateLocked = true

    renderWidget({
      registration: makeRegistration({
        is_active: true,

        available_portions: {
          adults_meat: 0,

          adults_veg: 0,

          children_count: 0,
        },
      }),
    })

    expect(
      screen.queryByRole("button", { name: /sælg billet/i }),
    ).not.toBeInTheDocument()
  })

  it("hides sell button when unlocked (even with portions)", () => {
    mockIsDateLocked = false

    renderWidget({
      registration: makeRegistration({
        is_active: true,

        available_portions: {
          adults_meat: 0,

          adults_veg: 2,

          children_count: 0,
        },
      }),
    })

    expect(
      screen.queryByRole("button", { name: /sælg billet/i }),
    ).not.toBeInTheDocument()
  })

  it("disables sell button after ticket sale cutoff", () => {
    mockIsDateLocked = true

    mockIsAfterTicketSaleCutoff = true

    renderWidget({
      registration: makeRegistration({
        is_active: true,

        available_portions: {
          adults_meat: 0,

          adults_veg: 1,

          children_count: 0,
        },
      }),
    })

    expect(screen.getByRole("button", { name: /sælg billet/i })).toBeDisabled()
  })

  it("opens sell modal on button click", async () => {
    mockIsDateLocked = true

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderWidget({
      registration: makeRegistration({
        is_active: true,

        available_portions: {
          adults_meat: 0,

          adults_veg: 2,

          children_count: 0,
        },
      }),
    })

    await user.click(screen.getByRole("button", { name: /sælg billet/i }))

    await waitFor(() => {
      expect(
        screen.getByText("Sælg billet", { selector: ".mantine-Modal-title" }),
      ).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------

// Tickets display

// ---------------------------------------------------------------------------

describe("FoodDayWidget ticket display", () => {
  it("shows tickets for sale", () => {
    const ticket = makeTicket({ total_portions: 2, price: "52.00" })

    renderWidget({
      registration: makeRegistration({ is_active: true }),

      ticketsForSale: [ticket],
    })

    expect(screen.getByText(/billet til salg/i)).toBeInTheDocument()

    expect(screen.getByText(/2 port/)).toBeInTheDocument()
  })

  it("shows purchased tickets", () => {
    const ticket = makeTicket({
      total_portions: 1,

      price: "26.00",

      is_available: false,

      claimed_by: {
        id: 2,

        first_name: "Anna",

        last_name: "Jensen",

        profile_picture: null,

        phone_number: "",
      },
    })

    renderWidget({
      registration: makeRegistration({ is_active: true }),

      purchasedTickets: [ticket],
    })

    expect(screen.getByText(/købt billet/i)).toBeInTheDocument()
  })

  it("does not show ticket sections when arrays are empty", () => {
    renderWidget({
      registration: makeRegistration({ is_active: true }),

      ticketsForSale: [],

      purchasedTickets: [],
    })

    expect(screen.queryByText(/billet til salg/i)).not.toBeInTheDocument()

    expect(screen.queryByText(/købt billet/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

// Saving indicator

// ---------------------------------------------------------------------------

describe("FoodDayWidget saving indicator", () => {
  it("shows 'Gemmer...' while saving", async () => {
    // Make the mutation hang so we can observe the saving state

    mockUpdateRegistration.mockReturnValue(new Promise(() => {}))

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ seating_time: "17:30" })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    expect(screen.getByText("Gemmer...")).toBeInTheDocument()
  })

  it("shows 'Gemt' after successful save", async () => {
    mockUpdateRegistration.mockResolvedValue(
      makeRegistration({ seating_time: "18:30" }),
    )

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const reg = makeRegistration({ seating_time: "17:30" })

    renderWidget({ registration: reg })

    const btn1830 = screen.getByRole("radio", { name: "18:30" })

    await user.click(btn1830)

    await act(() => vi.advanceTimersByTime(600))

    await waitFor(() => {
      expect(screen.getByText("Gemt")).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------

// Wednesday-specific behaviour

// ---------------------------------------------------------------------------

describe("FoodDayWidget Wednesday", () => {
  // 2026-06-17 is a Wednesday

  const WEDNESDAY = "2026-06-17"

  it("shows meat portion info on Wednesday", () => {
    renderWidget({
      date: WEDNESDAY,

      dayName: "onsdag",

      registration: makeRegistration({
        date: WEDNESDAY,

        day_of_week: 2,

        adults_meat: 1,

        adults_veg: 1,

        is_active: true,
      }),
    })

    expect(screen.getByText(/1 kød/)).toBeInTheDocument()

    expect(screen.getByText(/1 vegetar/)).toBeInTheDocument()
  })
})
