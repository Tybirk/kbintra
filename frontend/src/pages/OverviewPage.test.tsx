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
      }),
    ]
  }

  it("defaults to the org chart view, showing root and nested names", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByTestId("org-chart")).toBeInTheDocument()
    })

    // "Generalforsamling" matches both the node name and the type badge, so
    // scope to the link element rendering the node's name.
    expect(
      screen.getByRole("link", { name: "Generalforsamling" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Bestyrelsen")).toBeInTheDocument()
    expect(screen.getByText("Grønt udvalg")).toBeInTheDocument()
    // The arbejdsgruppe child is nested and rendered.
    expect(screen.getByText("Arrangementsgruppen")).toBeInTheDocument()
  })

  it("switches to the tree view and back via the segmented control", async () => {
    mockGetOrganisation.mockResolvedValue(makeSampleTree())

    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByTestId("org-chart")).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText("Træ"))

    await waitFor(() => {
      expect(screen.queryByTestId("org-chart")).not.toBeInTheDocument()
    })

    const names = screen
      .getAllByText(/Generalforsamling|Bestyrelsen|Grønt udvalg/)
      .map((el) => el.textContent)
    expect(names).toEqual(["Generalforsamling", "Bestyrelsen", "Grønt udvalg"])
    // The arbejdsgruppe child is nested and rendered (expanded by default).
    expect(screen.getByText("Arrangementsgruppen")).toBeInTheDocument()

    await userEvent.click(screen.getByText("Diagram"))

    await waitFor(() => {
      expect(screen.getByTestId("org-chart")).toBeInTheDocument()
    })
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
