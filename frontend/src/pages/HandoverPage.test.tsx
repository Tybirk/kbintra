import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor, fireEvent } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import HandoverPage from "./HandoverPage"

import type { Handover, House } from "../types"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

const mockList = vi.fn()

const mockCreate = vi.fn()

const mockGetHouses = vi.fn()

vi.mock("../api/houses", () => ({
  handoversApi: {
    list: () => mockList(),

    create: (...args: unknown[]) => mockCreate(...args),

    invitationPreview: vi.fn(),

    resendInvitation: vi.fn(),

    cancel: vi.fn(),

    updateDates: vi.fn(),
  },

  housesApi: {
    getHouses: () => mockGetHouses(),
  },
}))

const house40: House = {
  id: 26,

  slug: "40",

  name: "Kløverbakkevej 40",

  description: "",

  address: "",

  profile_picture: null,

  inhabitant_count: 2,

  inhabitants: [
    {
      id: 70,

      first_name: "Gammel",

      last_name: "Et",

      profile_picture: null,

      bio: "",
    },
    {
      id: 81,

      first_name: "Gammel",

      last_name: "To",

      profile_picture: null,

      bio: "",
    },
  ],

  children: [],

  cars: [],

  created_at: "2026-01-01T00:00:00Z",
}

const planned: Handover = {
  id: 1,

  house: 26,

  house_name: "Kløverbakkevej 40",

  house_slug: "40",

  handover_date: "2026-11-15",

  invite_on: "2026-11-13",

  access_until: "2026-12-15",

  reset_household: true,

  outgoing: [
    {
      id: 70,

      first_name: "Gammel",

      last_name: "Et",

      is_active: true,

      moved_out_on: null,

      upcoming_food_shifts: ["2026-11-20"],
    },
  ],

  invitations: [
    {
      id: 5,

      first_name: "Ny",

      last_name: "Beboer",

      email: "ny@example.com",

      phone_number: "12345678",

      send_on: "2026-11-13",

      sent_at: null,

      used_at: null,

      expires_at: "2026-11-27T00:00:00Z",

      status: "scheduled",
    },
  ],

  created_by_name: "Admin",

  created_at: "2026-10-30T10:00:00Z",

  household_reset_at: null,

  moved_out_at: null,

  access_ended_at: null,

  can_cancel: true,
}

describe("HandoverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockList.mockResolvedValue([planned])

    mockGetHouses.mockResolvedValue([house40])

    mockCreate.mockResolvedValue(planned)
  })

  it("lists a planned handover with who moves and the maddag to cover", async () => {
    render(<HandoverPage />)

    // The handover's badge, and the invitation's.
    expect(await screen.findAllByText("Planlagt")).toHaveLength(2)

    expect(screen.getByText("ny@example.com")).toBeInTheDocument()

    expect(screen.getByText("12345678")).toBeInTheDocument()

    expect(screen.getByText(/Står på madhold 20\/11/)).toBeInTheDocument()

    expect(screen.getByRole("button", { name: "Annullér" })).toBeInTheDocument()
  })

  it("moves the whole house out by default and sends the new residents", async () => {
    render(<HandoverPage />)

    fireEvent.click(await screen.findByRole("button", { name: /Ny$/ }))

    const user = userEvent.setup()

    await user.click(await screen.findByPlaceholderText("Vælg hus"))

    await user.click(
      await screen.findByRole("option", {
        name: "Kløverbakkevej 40",
        hidden: true,
      }),
    )

    expect(await screen.findByLabelText("Gammel Et")).toBeChecked()

    expect(screen.getByLabelText("Gammel To")).toBeChecked()

    expect(screen.getByLabelText(/Nulstil husets oplysninger/)).toBeChecked()

    fireEvent.change(screen.getByLabelText("Fornavn"), {
      target: { value: "Ny" },
    })

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " ny@example.com " },
    })

    fireEvent.click(screen.getByRole("button", { name: "Gem" }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())

    const payload = mockCreate.mock.calls[0][0]

    expect(payload).toMatchObject({
      house: "40",

      reset_household: true,

      outgoing: [70, 81],

      incoming: [
        {
          first_name: "Ny",

          last_name: "",

          email: "ny@example.com",

          phone_number: "",
        },
      ],
    })
  })
})
