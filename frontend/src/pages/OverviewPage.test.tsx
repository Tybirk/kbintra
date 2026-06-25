import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import OverviewPage from "./OverviewPage"

import type { OrgNode } from "../types"

const mockGetOrganisation = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    getOrganisation: (includeInactive?: boolean) =>
      mockGetOrganisation(includeInactive),
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

describe("OverviewPage", () => {
  beforeEach(() => {
    mockGetOrganisation.mockReset()
  })

  it("renders roots in the order returned by the API, with children nested", async () => {
    const tree: OrgNode[] = [
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
      }),
    ]
    mockGetOrganisation.mockResolvedValue(tree)

    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByText("Generalforsamling")).toBeInTheDocument()
    })

    const names = screen
      .getAllByText(/Generalforsamling|Bestyrelsen|Grønt udvalg/)
      .map((el) => el.textContent)
    expect(names).toEqual(["Generalforsamling", "Bestyrelsen", "Grønt udvalg"])

    // The arbejdsgruppe child is nested and rendered (expanded by default).
    expect(screen.getByText("Arrangementsgruppen")).toBeInTheDocument()
  })

  it("toggles include_inactive when the switch is flipped", async () => {
    mockGetOrganisation.mockResolvedValue([makeNode()])

    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByText("Bestyrelsen")).toBeInTheDocument()
    })
    expect(mockGetOrganisation).toHaveBeenCalledWith(false)

    const switchInput = screen.getByLabelText("Vis afsluttede arbejdsgrupper")
    await userEvent.click(switchInput)

    await waitFor(() => {
      expect(mockGetOrganisation).toHaveBeenCalledWith(true)
    })
  })

  it("shows an empty state when there is no organisation structure", async () => {
    mockGetOrganisation.mockResolvedValue([])

    render(<OverviewPage />)

    await waitFor(() => {
      expect(
        screen.getByText("Der er endnu ikke nogen organisationsstruktur."),
      ).toBeInTheDocument()
    })
  })
})
