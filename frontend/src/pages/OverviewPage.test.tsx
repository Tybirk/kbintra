import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { Route, Routes } from "react-router-dom"

import { render } from "../test/testUtils"

import OverviewPage from "./OverviewPage"

import type { OrgNode, Subgroup } from "../types"

const mockGetOrganisation = vi.fn()

const mockGetSubgroup = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    getOrganisation: (includeInactive?: boolean) =>
      mockGetOrganisation(includeInactive),

    getSubgroup: (slug: string) => mockGetSubgroup(slug),
  },
}))

function makeNode(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: 1,
    name: "Bestyrelsen",
    slug: "bestyrelsen",
    group_type: "bestyrelse",
    description: "",
    established_on: null,
    expires_on: null,
    is_active: true,
    member_count: 0,
    members: [],
    children: [],
    ...overrides,
  }
}

function makeDetail(overrides: Partial<Subgroup> = {}): Partial<Subgroup> {
  return {
    id: 1,
    name: "Bestyrelsen",
    slug: "bestyrelsen",
    description: "",
    group_type: "bestyrelse",
    established_on: null,
    expires_on: null,
    is_active: true,
    thread_count: 12,
    latest_thread_title: null,
    latest_thread_activity_at: null,
    members: [],
    ...overrides,
  }
}

/** The page reads its selection from the URL, so it always needs the two routes
 * registered rather than being rendered bare. */
function renderPage(path = "/overblik") {
  return render(
    <Routes>
      <Route path="/overblik" element={<OverviewPage />} />
      <Route path="/overblik/:slug" element={<OverviewPage />} />
    </Routes>,
    { initialEntries: [path] },
  )
}

/** The shared setup mock answers `false` to every query, so the page always
 * takes the mobile path. Call this to make the desktop breakpoint match. */
function matchDesktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("62em"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const mobileMatchMedia = window.matchMedia

describe("OverviewPage", () => {
  beforeEach(() => {
    mockGetOrganisation.mockReset()
    mockGetSubgroup.mockReset()
    mockGetSubgroup.mockResolvedValue(makeDetail())
    window.matchMedia = mobileMatchMedia
  })

  function makeSampleTree(): OrgNode[] {
    return [
      makeNode({
        id: 1,
        name: "Generalforsamling",
        slug: "generalforsamling",
        group_type: "generalforsamling",
      }),
      makeNode({
        id: 2,
        name: "Bestyrelsen",
        slug: "bestyrelsen",
        group_type: "bestyrelse",
        children: [
          makeNode({
            id: 3,
            name: "Arrangementsgruppen",
            slug: "arrangementsgruppen",
            group_type: "arbejdsgruppe",
          }),
        ],
      }),
      makeNode({
        id: 4,
        name: "Grønt udvalg",
        slug: "groent-udvalg",
        group_type: "udvalg",
        description: "<p>Havearbejde og biodiversitet.</p>",
      }),
    ]
  }

  it("shows every organ and nested arbejdsgruppe in the tree", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    renderPage()

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Generalforsamling/ }),
      ).toBeInTheDocument()
    })

    expect(
      screen.getByRole("link", { name: /Bestyrelsen/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Grønt udvalg/ }),
    ).toBeInTheDocument()
    // Nested under Bestyrelsen, and visible because nothing starts collapsed.
    expect(
      screen.getByRole("link", { name: /Arrangementsgruppen/ }),
    ).toBeInTheDocument()
  })

  it("opens the detail panel for the group that was clicked", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())
    mockGetSubgroup.mockResolvedValue(
      makeDetail({ slug: "groent-udvalg", thread_count: 187 }),
    )

    renderPage()

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Grønt udvalg/ }),
      ).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole("link", { name: /Grønt udvalg/ }))

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Grønt udvalg" }),
      ).toBeInTheDocument()
    })

    expect(
      screen.getByText("Havearbejde og biodiversitet."),
    ).toBeInTheDocument()
    expect(mockGetSubgroup).toHaveBeenCalledWith("groent-udvalg")
  })

  it("links from the panel to the group's forum page", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    renderPage("/overblik/groent-udvalg")

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Åbn forumgruppen" }),
      ).toHaveAttribute("href", "/forum/groent-udvalg")
    })
  })

  it("shows the mandate chain for a nested group", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    renderPage("/overblik/arrangementsgruppen")

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Arrangementsgruppen" }),
      ).toBeInTheDocument()
    })

    expect(screen.getByText("Mandat fra Bestyrelsen")).toBeInTheDocument()
  })

  it("folds a branch away without changing the selection", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    renderPage("/overblik/groent-udvalg")

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Arrangementsgruppen/ }),
      ).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole("button", { name: "Fold Bestyrelsen sammen" }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Arrangementsgruppen/ }),
      ).not.toBeInTheDocument()
    })

    // The panel is untouched by folding a different branch.
    expect(
      screen.getByRole("heading", { name: "Grønt udvalg" }),
    ).toBeInTheDocument()
  })

  it("toggles include_inactive when the switch is flipped", async () => {
    mockGetOrganisation.mockResolvedValue([makeNode()])

    renderPage()

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Bestyrelsen/ }),
      ).toBeInTheDocument()
    })
    expect(mockGetOrganisation).toHaveBeenCalledWith(false)

    const switchInput = screen.getByLabelText("Vis afsluttede arbejdsgrupper")
    await userEvent.click(switchInput)

    await waitFor(() => {
      expect(mockGetOrganisation).toHaveBeenCalledWith(true)
    })
  })

  it("reports a slug that no longer resolves instead of crashing", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())
    mockGetSubgroup.mockRejectedValue(new Error("404"))

    renderPage("/overblik/findes-ikke")

    await waitFor(() => {
      expect(
        screen.getByText("Gruppen findes ikke længere."),
      ).toBeInTheDocument()
    })
  })

  it("selects the first organ on desktop so the panel column is never empty", async () => {
    matchDesktop()
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    renderPage()

    // Falls back to the first root without being asked, and without navigating
    // there — the URL stays on /overblik.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Generalforsamling" }),
      ).toBeInTheDocument()
    })

    expect(mockGetSubgroup).toHaveBeenCalledWith("generalforsamling")
    // The panel is a column here, not the drawer.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("explains an archived group reached by URL while the switch is off", async () => {
    // The tree omits it, because include_inactive defaults to false.
    mockGetOrganisation.mockResolvedValue(makeSampleTree())
    mockGetSubgroup.mockResolvedValue(
      makeDetail({
        name: "Vedtægtsgruppen",
        slug: "vedtaegtsgruppen",
        group_type: "arbejdsgruppe",
        is_active: false,
      }),
    )

    renderPage("/overblik/vedtaegtsgruppen")

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Vedtægtsgruppen" }),
      ).toBeInTheDocument()
    })

    expect(
      screen.getByText(/Slå »Vis afsluttede arbejdsgrupper« til/),
    ).toBeInTheDocument()
  })

  it("shows an empty state when there is no organisation structure", async () => {
    mockGetOrganisation.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(
        screen.getByText("Der er endnu ikke nogen organisationsstruktur."),
      ).toBeInTheDocument()
    })
  })
})
