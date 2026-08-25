import { beforeEach, describe, expect, it, vi } from "vitest"

import { screen, waitFor, within } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { render } from "../test/testUtils"

import ReportsPage from "./ReportsPage"

import type { Report, ReportList } from "../types"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },

  Notifications: () => null,
}))

const mockList = vi.fn()

const mockCreate = vi.fn()

const mockSubgroups = vi.fn()

vi.mock("../api/reports", () => ({
  reportsApi: {
    list: (...args: unknown[]) => mockList(...args),

    create: (...args: unknown[]) => mockCreate(...args),

    subgroups: () => mockSubgroups(),

    exportCsv: vi.fn(),
  },
}))

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 1,
    number: 12,
    subgroup: { id: 10, name: "Driftsudvalget", slug: "driftsudvalget" },
    kind: "defect",
    kind_display: "Defekt inventar",
    status: "in_progress",
    status_display: "I gang",
    description: "Defekt støvsugerslange. Falder ud når man bruger den.",
    location: "Depotrummet",
    submitted_by: null,
    reporter_name: "Terkild Testesen",
    legacy_url: "",
    photos: [],
    comment_count: 0,
    can_manage: false,
    can_edit: false,
    url: "/indrapportering/driftsudvalget/12",
    created_at: "2026-08-15T09:18:00Z",
    updated_at: "2026-08-15T09:18:00Z",
    closed_at: null,
    ...overrides,
  }
}

function makeList(results: Report[]): ReportList {
  return {
    results,
    count: results.length,
    page: 1,
    num_pages: 1,
    open_count: results.filter(
      (report) => report.status !== "done" && report.status !== "rejected",
    ).length,
  }
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue(makeList([makeReport()]))
    mockSubgroups.mockResolvedValue([
      { id: 10, name: "Driftsudvalget", slug: "driftsudvalget" },
    ])
  })

  it("renders the page title", async () => {
    render(<ReportsPage />)

    await waitFor(() => {
      expect(screen.getByText("Indrapportering")).toBeInTheDocument()
    })
  })

  it("shows a case with its number, kind and status", async () => {
    render(<ReportsPage />)

    await waitFor(() => {
      expect(screen.getByText("#12")).toBeInTheDocument()
    })
    // Scoped to the card: the status filter chips carry the same labels.
    const card = within(screen.getByRole("link"))
    expect(card.getByText("Defekt inventar")).toBeInTheDocument()
    expect(card.getByText("I gang")).toBeInTheDocument()
    expect(card.getByText(/Defekt støvsugerslange/)).toBeInTheDocument()
    expect(card.getByText("Depotrummet")).toBeInTheDocument()
  })

  it("links a case to its own page", async () => {
    render(<ReportsPage />)

    await waitFor(() => {
      expect(screen.getByText("#12")).toBeInTheDocument()
    })
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "/indrapportering/driftsudvalget/12")
  })

  it("defaults to the open cases", async () => {
    render(<ReportsPage />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    expect(mockList.mock.calls[0][0]).toMatchObject({ status: "open" })
  })

  it("filtering by kind refetches with that kind", async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await user.click(screen.getByText("Forslag"))

    await waitFor(() => {
      const kinds = mockList.mock.calls.map((call) => call[0].kind)
      expect(kinds).toContain("suggestion")
    })
  })

  it("tapping the active kind chip clears the filter again", async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await user.click(screen.getByText("Forslag"))
    await waitFor(() =>
      expect(mockList.mock.calls.some((c) => c[0].kind === "suggestion")).toBe(
        true,
      ),
    )

    await user.click(screen.getByText("Forslag"))

    await waitFor(() => {
      const last = mockList.mock.calls[mockList.mock.calls.length - 1][0]
      expect(last.kind).toBeUndefined()
    })
  })

  it("says '1 åben' rather than '1 åbne'", async () => {
    mockList.mockResolvedValue(makeList([makeReport()]))
    render(<ReportsPage />)

    await waitFor(() => {
      expect(screen.getByText("1 åben")).toBeInTheDocument()
    })
  })

  it("the description prompt follows the chosen type", async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)

    await user.click(
      await screen.findByRole("button", { name: /ny indrapportering/i }),
    )
    expect(
      await screen.findByPlaceholderText(/Hvad er ødelagt\?/),
    ).toBeInTheDocument()

    // Scoped to the dialog: "Forslag" is also a kind filter chip on the page behind.
    const form = within(await screen.findByRole("dialog"))
    await user.click(form.getByText("Forslag"))

    expect(
      await screen.findByPlaceholderText(/Hvad kunne vi ønske os/),
    ).toBeInTheDocument()
  })

  it("only offers images in the photo picker", async () => {
    const user = userEvent.setup()
    const { container } = render(<ReportsPage />)

    await user.click(
      await screen.findByRole("button", { name: /ny indrapportering/i }),
    )
    await screen.findByPlaceholderText(/Hvad er ødelagt\?/)

    const input = document.querySelector('input[type="file"]')
    expect(input).toHaveAttribute("accept", "image/*")
    expect(container).toBeTruthy()
  })

  it("says so when nothing matches", async () => {
    mockList.mockResolvedValue(makeList([]))
    render(<ReportsPage />)

    await waitFor(() => {
      expect(screen.getByText("Ingen sager matcher.")).toBeInTheDocument()
    })
  })

  it("requires a description before sending", async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)

    await user.click(
      await screen.findByRole("button", { name: /ny indrapportering/i }),
    )
    await user.click(await screen.findByRole("button", { name: /send ind/i }))

    expect(
      await screen.findByText("Skriv en beskrivelse af hvad der er sket."),
    ).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("sends a filled-in report to the single udvalg", async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue(makeReport({ number: 14 }))
    render(<ReportsPage />)

    await user.click(
      await screen.findByRole("button", { name: /ny indrapportering/i }),
    )
    await user.type(
      await screen.findByLabelText(/beskrivelse/i),
      "Vandhanen i køkkenet mangler en overdel",
    )
    await user.type(screen.getByLabelText(/hvor\?/i), "Hus 39")
    await user.click(screen.getByRole("button", { name: /send ind/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toEqual({
      subgroup: "driftsudvalget",
      kind: "defect",
      description: "Vandhanen i køkkenet mangler en overdel",
      location: "Hus 39",
    })
  })
})
