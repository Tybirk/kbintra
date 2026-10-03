// Regression tests for the madhold bug hunt of 2026-10-02 (F1-F7, C3). The
// IDs are the ones in docs/madhold-bughunt-2026-10-02.md.
import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor, within } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { Routes, Route, useLocation, useNavigate } from "react-router-dom"

import dayjs from "dayjs"

import { notifications } from "@mantine/notifications"

import { render, mockUser } from "../test/testUtils"

import FoodTeamsPage from "./FoodTeamsPage"

import { useAuthStore } from "../store/authStore"

import type {
  FoodTeam,
  FoodTeamCycle,
  MyFoodProfile,
  SwapBroadcast,
  TeamGenerationResult,
  TeamSwapRequest,
} from "../types"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
  Notifications: () => null,
}))

const api = vi.hoisted(() => ({
  getMyTeams: vi.fn(),
  getTeams: vi.fn(),
  getHousemateTeams: vi.fn(),
  getSwapRequests: vi.fn(),
  getActiveCycle: vi.fn(),
  getFavours: vi.fn(),
  getSwapBroadcasts: vi.fn(),
  getMyFoodProfile: vi.fn(),
  updateMyFoodProfile: vi.fn(),
  getMyWish: vi.fn(),
  submitWish: vi.fn(),
  getCycles: vi.fn(),
  getFoodRoster: vi.fn(),
  generateTeams: vi.fn(),
  takeover: vi.fn(),
  acceptSwapBroadcast: vi.fn(),
  respondSwapRequest: vi.fn(),
}))

vi.mock("../api/food", () => ({ foodApi: api }))

vi.mock("../api/forum", () => ({ forumApi: { getSubgroups: vi.fn() } }))

const profile: MyFoodProfile = {
  can_be_head_chef: false,
  prefers_cooking_with_housemate: false,
  is_over_50: false,
  has_birthdate: true,
  is_exempt_from_food_teams: false,
  default_cooking_days: [],
  food_team_pause_reason: "",
  housemate_name: "",
}

const cycle: FoodTeamCycle = {
  id: 7,
  name: "Efterår",
  cooking_dates: ["2030-10-14", "2030-10-15"],
  wish_deadline: dayjs().add(3, "day").hour(18).minute(0).toISOString(),
  status: "collecting_wishes",
  is_accepting_wishes: true,
  team_count: 0,
  wish_count: 0,
  my_wish_submitted: false,
  created_at: "2030-09-01T00:00:00Z",
  updated_at: "2030-09-01T00:00:00Z",
}

const anna = {
  id: 2,
  first_name: "Anna",
  last_name: "And",
  profile_picture: null,
}

const me = {
  id: 1,
  first_name: "Test",
  last_name: "User",
  profile_picture: null,
}

const myTeam: FoodTeam = {
  id: 30,
  date: "2030-10-16",
  day_name: "Onsdag",
  notes: "",
  members: [
    { id: 55, user: me, house_number: "3", is_own: true, created_at: "" },
  ],
  member_count: 1,
  is_my_team: true,
  created_at: "",
  updated_at: "",
}

function swapRequest(overrides: Partial<TeamSwapRequest>): TeamSwapRequest {
  return {
    id: 1,
    requester: anna,
    requester_membership: {
      id: 60,
      user: anna,
      house_number: "5",
      team_date: "2030-10-14",
      team_day_name: "Mandag",
    },
    target_membership: {
      id: 55,
      user: me,
      house_number: "3",
      team_date: "2030-10-16",
      team_day_name: "Onsdag",
    },
    status: "pending",
    message: "",
    response_message: "",
    is_incoming: true,
    is_outgoing: false,
    can_accept: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  }
}

const broadcast: SwapBroadcast = {
  id: 9,
  requester: anna,
  requester_membership: {
    id: 60,
    user: anna,
    house_number: "5",
    date: "2030-10-14",
    day_name: "Mandag",
  },
  available_dates: ["2030-10-16"],
  message: "",
  status: "open",
  accepted_by: null,
  is_mine: false,
  can_accept: true,
  created_at: "",
  updated_at: "",
}

const generationResult: TeamGenerationResult = {
  success: true,
  message: "Færdig",
  teams_created: 2,
  unassigned_persons: [],
  warnings: [],
  dropped_dates: [],
}

const notFound = Object.assign(new Error("404"), {
  isAxiosError: true,
  response: { status: 404, data: { detail: "Ingen" } },
})

const networkError = Object.assign(new Error("Network Error"), {
  isAxiosError: true,
})

function serverError(detail: string) {
  return Object.assign(new Error("400"), {
    isAxiosError: true,
    response: { status: 400, data: { detail } },
  })
}

/** A promise the test resolves by hand, to hold a save in flight. */
function deferred<T>() {
  let resolve: (value: T) => void

  const promise = new Promise<T>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

/** Where the router is, and a Back button to see what Back leads to. */
function LocationProbe() {
  const location = useLocation()

  const navigate = useNavigate()

  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <button onClick={() => navigate(-1)}>Tilbage</button>
    </>
  )
}

function renderAt(...entries: string[]) {
  return render(
    <>
      <Routes>
        <Route path="/madhold" element={<FoodTeamsPage />} />
        <Route path="/madhold/:tab" element={<FoodTeamsPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: entries },
  )
}

function setUser(isFoodAdmin: boolean) {
  useAuthStore.setState({
    user: { ...mockUser, is_staff: false, is_food_admin: isFoodAdmin } as never,
    isAuthenticated: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setUser(false)
  api.getMyTeams.mockResolvedValue([])
  api.getTeams.mockResolvedValue([])
  api.getHousemateTeams.mockResolvedValue([])
  api.getSwapRequests.mockResolvedValue([])
  api.getActiveCycle.mockRejectedValue(notFound)
  api.getFavours.mockResolvedValue([])
  api.getSwapBroadcasts.mockResolvedValue([])
  api.getMyFoodProfile.mockResolvedValue(profile)
  api.getMyWish.mockRejectedValue(notFound)
  api.getCycles.mockResolvedValue([])
  api.getFoodRoster.mockResolvedValue({ residents: [], cycle: null })
})

describe("tabs from a link", () => {
  it.each([
    ["/madhold/mine-hold", /Mine hold/],
    ["/madhold/bytte", /Bytte/],
    ["/madhold/oensker", /Indsend ønsker/],
    ["/madhold/profil", /Min profil/],
  ])("%s selects its tab", async (path, tabName) => {
    renderAt(path)

    const tab = await screen.findByRole("tab", { name: tabName })

    expect(tab).toHaveAttribute("aria-selected", "true")
  })

  it("F7: /madhold/admin for a non-admin lands on Mine hold, and Back skips it", async () => {
    renderAt("/madhold/bytte", "/madhold/admin")

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/madhold/mine-hold",
      ),
    )

    expect(screen.getByRole("tab", { name: /Mine hold/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    expect(
      await screen.findByText("Du er ikke tildelt nogle kommende madhold."),
    ).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Tilbage" }))

    expect(screen.getByTestId("location")).toHaveTextContent("/madhold/bytte")
  })

  it("F7: an unknown tab slug lands on Mine hold", async () => {
    renderAt("/madhold/findes-ikke")

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/madhold/mine-hold",
      ),
    )

    expect(screen.getByRole("tab", { name: /Mine hold/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("F7: a food admin stays on /madhold/admin", async () => {
    setUser(true)

    renderAt("/madhold/admin")

    const tab = await screen.findByRole("tab", { name: /Admin/ })

    expect(tab).toHaveAttribute("aria-selected", "true")

    expect(screen.getByTestId("location")).toHaveTextContent("/madhold/admin")
  })
})

describe("F1: a failed fetch is not an empty list", () => {
  it("Mine hold says it could not fetch, and Prøv igen fetches again", async () => {
    api.getMyTeams.mockRejectedValueOnce(networkError)

    renderAt("/madhold/mine-hold")

    expect(
      await screen.findByText("Kunne ikke hente dine madhold."),
    ).toBeInTheDocument()

    expect(
      screen.queryByText("Du er ikke tildelt nogle kommende madhold."),
    ).not.toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Prøv igen" }))

    expect(
      await screen.findByText("Du er ikke tildelt nogle kommende madhold."),
    ).toBeInTheDocument()

    expect(api.getMyTeams).toHaveBeenCalledTimes(2)
  })

  it("Mine hold shows the error when only the housemates' days failed", async () => {
    api.getHousemateTeams.mockRejectedValue(networkError)

    renderAt("/madhold/mine-hold")

    expect(
      await screen.findByText("Kunne ikke hente dine madhold."),
    ).toBeInTheDocument()
  })

  it("Alle hold says it could not fetch", async () => {
    api.getTeams.mockRejectedValue(networkError)

    renderAt("/madhold/alle-hold")

    expect(
      await screen.findByText("Kunne ikke hente madholdene."),
    ).toBeInTheDocument()

    expect(
      screen.queryByText("Ingen kommende madhold planlagt."),
    ).not.toBeInTheDocument()
  })

  it("Bytte says it could not fetch instead of 'no requests'", async () => {
    api.getSwapRequests.mockRejectedValue(networkError)

    renderAt("/madhold/bytte")

    expect(
      await screen.findByText(
        "Kunne ikke hente dine maddage og bytteanmodninger.",
      ),
    ).toBeInTheDocument()

    expect(
      screen.queryByText("Ingen indgående bytteanmodninger."),
    ).not.toBeInTheDocument()
  })

  it("Ønsker tells a failed fetch apart from no active period", async () => {
    api.getActiveCycle.mockRejectedValue(networkError)

    renderAt("/madhold/oensker")

    expect(
      await screen.findByText("Kunne ikke hente madholdsperioden."),
    ).toBeInTheDocument()

    expect(
      screen.queryByText(/Der er ingen aktiv madholdsperiode/),
    ).not.toBeInTheDocument()
  })

  it("Admin says it could not fetch the periods instead of 'none yet'", async () => {
    setUser(true)

    api.getCycles.mockRejectedValue(networkError)

    renderAt("/madhold/admin")

    expect(
      await screen.findByText("Kunne ikke hente perioderne."),
    ).toBeInTheDocument()

    expect(
      screen.queryByText(/Der er endnu ikke oprettet nogen perioder/),
    ).not.toBeInTheDocument()
  })

  it("Ønsker still says there is no active period on a 404", async () => {
    renderAt("/madhold/oensker")

    expect(
      await screen.findByText(/Der er ingen aktiv madholdsperiode/),
    ).toBeInTheDocument()
  })
})

describe("F2: weekday taps are not lost", () => {
  it("Min profil: a second tap before the first save returns keeps both days", async () => {
    const firstSave = deferred<MyFoodProfile>()

    api.updateMyFoodProfile
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({ ...profile, default_cooking_days: [0, 1] })

    renderAt("/madhold/profil")

    const panel = await screen.findByRole("tabpanel")

    const user = userEvent.setup()

    await user.click(
      await within(panel).findByRole("checkbox", { name: "Mandag" }),
    )

    await user.click(within(panel).getByRole("checkbox", { name: "Tirsdag" }))

    // Both show at once, and the second save waits for the first.
    expect(
      within(panel).getByRole("checkbox", { name: "Mandag" }),
    ).toBeChecked()

    expect(
      within(panel).getByRole("checkbox", { name: "Tirsdag" }),
    ).toBeChecked()

    expect(api.updateMyFoodProfile).toHaveBeenCalledTimes(1)

    expect(api.updateMyFoodProfile.mock.calls[0][0]).toEqual({
      default_cooking_days: [0],
    })

    firstSave.resolve({ ...profile, default_cooking_days: [0] })

    await waitFor(() =>
      expect(api.updateMyFoodProfile).toHaveBeenCalledTimes(2),
    )

    expect(api.updateMyFoodProfile.mock.calls[1][0]).toEqual({
      default_cooking_days: [0, 1],
    })
  })

  it("Min profil: a refused save shows the server's message and the saved days", async () => {
    api.updateMyFoodProfile.mockRejectedValue(serverError("Ugyldig ugedag."))

    renderAt("/madhold/profil")

    const panel = await screen.findByRole("tabpanel")

    const monday = await within(panel).findByRole("checkbox", {
      name: "Mandag",
    })

    await userEvent.setup().click(monday)

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Ugyldig ugedag.", color: "red" }),
      ),
    )

    expect(
      within(panel).getByRole("checkbox", { name: "Mandag" }),
    ).not.toBeChecked()
  })

  it("Ønsker: a second tap before the first save returns keeps both days", async () => {
    api.getActiveCycle.mockResolvedValue(cycle)

    const firstSave = deferred<MyFoodProfile>()

    api.updateMyFoodProfile
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({ ...profile, default_cooking_days: [0, 1] })

    renderAt("/madhold/oensker")

    const panel = await screen.findByRole("tabpanel")

    const user = userEvent.setup()

    await user.click(
      await within(panel).findByRole("checkbox", { name: "Mandag" }),
    )

    await user.click(within(panel).getByRole("checkbox", { name: "Tirsdag" }))

    expect(
      within(panel).getByRole("checkbox", { name: "Mandag" }),
    ).toBeChecked()

    firstSave.resolve({ ...profile, default_cooking_days: [0] })

    await waitFor(() =>
      expect(api.updateMyFoodProfile).toHaveBeenCalledTimes(2),
    )

    expect(api.updateMyFoodProfile.mock.calls[1][0]).toEqual({
      default_cooking_days: [0, 1],
    })
  })

  it("Ønsker: a refused save shows the server's message and the saved days", async () => {
    api.getActiveCycle.mockResolvedValue(cycle)

    api.updateMyFoodProfile.mockRejectedValue(serverError("Ugyldig ugedag."))

    renderAt("/madhold/oensker")

    const panel = await screen.findByRole("tabpanel")

    await userEvent
      .setup()
      .click(await within(panel).findByRole("checkbox", { name: "Mandag" }))

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Ugyldig ugedag.", color: "red" }),
      ),
    )

    expect(
      within(panel).getByRole("checkbox", { name: "Mandag" }),
    ).not.toBeChecked()
  })
})

describe("F3: a pause reason saved under Min profil survives the wish form", () => {
  it("Ønsker shows the new reason and does not send an untouched one", async () => {
    const paused = { ...profile, is_exempt_from_food_teams: true }

    api.getActiveCycle.mockResolvedValue(cycle)

    api.getMyFoodProfile.mockResolvedValue(paused)

    api.updateMyFoodProfile.mockImplementation(
      async (data: Partial<MyFoodProfile>) => {
        const saved = { ...paused, ...data }

        api.getMyFoodProfile.mockResolvedValue(saved)

        return saved
      },
    )

    api.submitWish.mockResolvedValue({})

    // Ønsker is opened first, so it already holds the old (empty) reason.
    renderAt("/madhold/oensker")

    const user = userEvent.setup()

    await screen.findByText("Jeg er forhindret i hele perioden")

    await user.click(screen.getByRole("tab", { name: /Min profil/ }))

    await user.type(
      await screen.findByRole("textbox", { name: /Hvorfor holder du pause/ }),
      "barsel",
    )

    await user.click(screen.getByRole("button", { name: "Gem begrundelse" }))

    await waitFor(() =>
      expect(api.updateMyFoodProfile).toHaveBeenCalledWith({
        food_team_pause_reason: "barsel",
      }),
    )

    await user.click(screen.getByRole("tab", { name: /Indsend ønsker/ }))

    await user.click(
      await screen.findByRole("switch", {
        name: /Jeg er forhindret i hele perioden/,
      }),
    )

    expect(
      await screen.findByRole("textbox", { name: /Hvad forhindrer dig/ }),
    ).toHaveValue("barsel")

    await user.click(screen.getByRole("button", { name: "Indsend ønsker" }))

    await waitFor(() => expect(api.submitWish).toHaveBeenCalledTimes(1))

    expect(api.submitWish).toHaveBeenCalledWith(7, {
      available_dates: [],
      is_unavailable: true,
    })
  })

  it("Ønsker sends a reason the user typed", async () => {
    api.getActiveCycle.mockResolvedValue(cycle)

    api.submitWish.mockResolvedValue({})

    renderAt("/madhold/oensker")

    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("switch", {
        name: /Jeg er forhindret i hele perioden/,
      }),
    )

    await user.type(
      await screen.findByRole("textbox", { name: /Hvad forhindrer dig/ }),
      "rejse",
    )

    await user.click(screen.getByRole("button", { name: "Indsend ønsker" }))

    await waitFor(() =>
      expect(api.submitWish).toHaveBeenCalledWith(7, {
        available_dates: [],
        is_unavailable: true,
        pause_reason: "rejse",
      }),
    )
  })
})

describe("F5: moving a shift refreshes every madhold list", () => {
  /** Every list fetched once on load and once more after the action. */
  async function expectAllListsRefetched() {
    await waitFor(() => expect(api.getSwapRequests).toHaveBeenCalledTimes(2))

    await waitFor(() => {
      expect(api.getSwapBroadcasts).toHaveBeenCalledTimes(2)

      expect(api.getMyTeams).toHaveBeenCalledTimes(2)

      expect(api.getTeams).toHaveBeenCalledTimes(2)

      expect(api.getHousemateTeams).toHaveBeenCalledTimes(2)

      expect(api.getFavours).toHaveBeenCalledTimes(2)
    })
  }

  it("Overtag", async () => {
    api.getSwapBroadcasts.mockResolvedValue([broadcast])

    api.takeover.mockResolvedValue({})

    renderAt("/madhold/bytte")

    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: /Jeg tager den/ }),
    )

    await user.click(
      await screen.findByRole("button", { name: "Overtag maddagen" }),
    )

    await waitFor(() => expect(api.takeover).toHaveBeenCalledTimes(1))

    await expectAllListsRefetched()
  })

  it("Accepter byt on a broadcast", async () => {
    api.getMyTeams.mockResolvedValue([myTeam])

    api.getSwapBroadcasts.mockResolvedValue([broadcast])

    api.acceptSwapBroadcast.mockResolvedValue({})

    renderAt("/madhold/bytte")

    const user = userEvent.setup()

    await user.click(await screen.findByPlaceholderText("Vælg en maddag"))

    await user.click(
      await screen.findByRole("option", { name: /Onsdag/, hidden: true }),
    )

    await user.click(screen.getByRole("button", { name: "Accepter byt" }))

    await waitFor(() =>
      expect(api.acceptSwapBroadcast).toHaveBeenCalledWith(9, 55),
    )

    await expectAllListsRefetched()
  })

  it("Accepter on a 1:1 request", async () => {
    api.getSwapRequests.mockResolvedValue([swapRequest({})])

    api.respondSwapRequest.mockResolvedValue({})

    renderAt("/madhold/bytte")

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Accepter" }))

    await waitFor(() => expect(api.respondSwapRequest).toHaveBeenCalledTimes(1))

    await expectAllListsRefetched()
  })
})

describe("F6: the Bytte badge counts what you can answer", () => {
  it("leaves out your own requests and those you can no longer accept", async () => {
    api.getSwapRequests.mockResolvedValue([
      swapRequest({ id: 1 }),
      swapRequest({
        id: 2,
        is_incoming: false,
        is_outgoing: true,
        can_accept: false,
      }),
      swapRequest({ id: 3, can_accept: false }),
    ])

    api.getSwapBroadcasts.mockResolvedValue([broadcast])

    renderAt("/madhold/mine-hold")

    const tab = await screen.findByRole("tab", { name: /Bytte/ })

    // One answerable request and one open broadcast.
    expect(await within(tab).findByText("2")).toBeInTheDocument()
  })

  it("shows no Accepter on an incoming request you can no longer accept", async () => {
    api.getSwapRequests.mockResolvedValue([swapRequest({ can_accept: false })])

    renderAt("/madhold/bytte")

    expect(
      await screen.findByText("Byttet kan ikke længere gennemføres."),
    ).toBeInTheDocument()

    expect(
      screen.queryByRole("button", { name: "Accepter" }),
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole("button", { name: "Afvis" }),
    ).not.toBeInTheDocument()
  })
})

describe("C3: Generer hold asks first", () => {
  beforeEach(() => {
    setUser(true)

    api.generateTeams.mockResolvedValue(generationResult)
  })

  it("before the deadline: warns, and sends before_deadline once confirmed", async () => {
    api.getCycles.mockResolvedValue([cycle])

    renderAt("/madhold/admin")

    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: "Generer hold" }),
    )

    const dialog = await screen.findByRole("dialog")

    expect(
      within(dialog).getByText(/alle kokke får besked/),
    ).toBeInTheDocument()

    expect(
      within(dialog).getByText(
        dayjs(cycle.wish_deadline).format("D. MMMM YYYY [kl.] HH:mm"),
        { exact: false },
      ),
    ).toBeInTheDocument()

    expect(api.generateTeams).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole("button", { name: "Ja, generer før deadline" }),
    )

    await waitFor(() =>
      expect(api.generateTeams).toHaveBeenCalledWith(7, false, true),
    )
  })

  it("after the deadline: no warning, and no before_deadline", async () => {
    api.getCycles.mockResolvedValue([
      { ...cycle, wish_deadline: dayjs().subtract(1, "day").toISOString() },
    ])

    renderAt("/madhold/admin")

    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: "Generer hold" }),
    )

    const dialog = await screen.findByRole("dialog")

    expect(
      within(dialog).queryByText("Deadline for ønsker er ikke nået"),
    ).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole("button", { name: "Ja, generer hold" }),
    )

    await waitFor(() =>
      expect(api.generateTeams).toHaveBeenCalledWith(7, false, false),
    )
  })

  it("Forhåndsvisning runs at once, without asking", async () => {
    api.getCycles.mockResolvedValue([cycle])

    renderAt("/madhold/admin")

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Forhåndsvisning" }))

    await waitFor(() => expect(api.generateTeams).toHaveBeenCalledTimes(1))

    expect(api.generateTeams.mock.calls[0].slice(0, 2)).toEqual([7, true])

    expect(api.generateTeams.mock.calls[0][2]).toBeFalsy()
  })
})
