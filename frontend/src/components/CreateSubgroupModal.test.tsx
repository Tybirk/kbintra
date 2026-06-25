import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import CreateSubgroupModal from "./CreateSubgroupModal"

import type { OrgNode } from "../types"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

vi.mock("./RichTextEditor", () => ({
  default: ({
    content,
    onChange,
  }: {
    content: string
    onChange: (v: string) => void
  }) => (
    <textarea
      data-testid="rich-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

const mockCreateSubgroup = vi.fn()

const mockGetOrganisation = vi.fn()

vi.mock("../api/forum", () => ({
  forumApi: {
    createSubgroup: (...args: unknown[]) => mockCreateSubgroup(...args),
    getOrganisation: (...args: unknown[]) => mockGetOrganisation(...args),
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

describe("CreateSubgroupModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrganisation.mockResolvedValue([makeNode()])
  })

  it("hides the parent select and date inputs for Almindelig gruppe (default)", async () => {
    render(<CreateSubgroupModal opened onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^Navn/)).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/^Forælder/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Oprettelsesdato/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Udløbsdato/)).not.toBeInTheDocument()
  })

  it("shows the parent select and date inputs when Arbejdsgruppe is chosen", async () => {
    const user = userEvent.setup()

    render(<CreateSubgroupModal opened onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^Navn/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole("radio", { name: "Arbejdsgruppe" }))

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /^Forælder/ }),
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/^Oprettelsesdato/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Udløbsdato/)).toBeInTheDocument()
  })

  it("preselects Arbejdsgruppe when defaultGroupType is set", async () => {
    render(
      <CreateSubgroupModal
        opened
        onClose={() => {}}
        defaultGroupType="arbejdsgruppe"
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /^Forælder/ }),
      ).toBeInTheDocument()
    })
  })

  it("submits with group_type=almindelig and no parent for the default path", async () => {
    const user = userEvent.setup()
    mockCreateSubgroup.mockResolvedValue({
      id: 1,
      name: "Bogklub",
      slug: "bogklub",
    })

    render(<CreateSubgroupModal opened onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^Navn/)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/^Navn/), "Bogklub")
    await user.click(screen.getByRole("button", { name: "Opret gruppe" }))

    await waitFor(() => {
      expect(mockCreateSubgroup).toHaveBeenCalled()
    })
    expect(mockCreateSubgroup.mock.calls[0][0]).toMatchObject({
      name: "Bogklub",
      group_type: "almindelig",
      parent: null,
    })
  })

  it("prefills Oprettelsesdato with today's date when Arbejdsgruppe is chosen", async () => {
    const user = userEvent.setup()

    render(<CreateSubgroupModal opened onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^Navn/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole("radio", { name: "Arbejdsgruppe" }))

    const expected = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/^Oprettelsesdato/)).toHaveValue(expected)
    })
  })

  it("requires a parent before allowing submit of an arbejdsgruppe", async () => {
    const user = userEvent.setup()

    render(
      <CreateSubgroupModal
        opened
        onClose={() => {}}
        defaultGroupType="arbejdsgruppe"
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /^Forælder/ }),
      ).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/^Navn/), "Bivenner")

    expect(screen.getByRole("button", { name: "Opret gruppe" })).toBeDisabled()
  })
})
