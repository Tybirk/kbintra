import { describe, it, expect, vi, beforeAll } from "vitest"

import { screen, fireEvent } from "@testing-library/react"

import { render } from "../test/testUtils"

import { WeekHourGrid } from "./WeekHourGrid"

import { countPaintedHours, emptyGrid } from "../utils/weekSchedule"

import type { HourGrid } from "../utils/weekSchedule"

function cell(day: string, hour: string) {
  return screen.getByRole("button", { name: `${day} ${hour}` })
}

/** Render with internal state so a drag accumulates like it does in the app. */
function renderGrid(initial: HourGrid = emptyGrid()) {
  const state = { grid: initial }
  const onChange = vi.fn((next: HourGrid) => {
    state.grid = next
    rerender(<WeekHourGrid value={next} onChange={onChange} />)
  })
  const { rerender } = render(
    <WeekHourGrid value={state.grid} onChange={onChange} />,
  )
  return { state, onChange }
}

describe("WeekHourGrid", () => {
  beforeAll(() => {
    // jsdom does no layout, so it leaves elementFromPoint unimplemented — it has
    // to exist before the tests can stub what the pointer is over.
    Object.defineProperty(document, "elementFromPoint", {
      value: () => null,
      writable: true,
      configurable: true,
    })
  })

  it("renders 7 days × 24 hours of cells", () => {
    renderGrid()
    expect(
      screen.getAllByRole("button", {
        name: /^(Man|Tir|Ons|Tor|Fre|Lør|Søn) \d\d:00$/,
      }),
    ).toHaveLength(7 * 24)
  })

  it("paints a single cell on click", () => {
    const { state } = renderGrid()

    fireEvent.pointerDown(cell("Man", "07:00"))
    fireEvent.pointerUp(window)

    expect(state.grid[0][7]).toBe(true)
    expect(countPaintedHours(state.grid)).toBe(1)
  })

  it("paints a run of hours when dragging down a day", () => {
    const { state } = renderGrid()

    const start = cell("Tir", "08:00")
    fireEvent.pointerDown(start)
    for (const hour of ["09:00", "10:00"]) {
      const target = cell("Tir", hour)
      // The component resolves the cell under the pointer via elementFromPoint,
      // because touch drags never fire pointerenter on the cells they cross.
      vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
      fireEvent.pointerMove(target, { clientX: 1, clientY: 1 })
    }
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(state.grid[1].slice(8, 11)).toEqual([true, true, true])
    expect(countPaintedHours(state.grid)).toBe(3)
  })

  it("leaves no gaps when a fast drag skips cells", () => {
    // A quick drag only produces a few pointermove samples. Painting the
    // pointer's path would leave the skipped hours unpainted; the block between
    // the anchor and the pointer must be filled instead.
    const { state } = renderGrid()

    fireEvent.pointerDown(cell("Ons", "15:00"))
    const far = cell("Ons", "20:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(far)
    fireEvent.pointerMove(far, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(state.grid[2].slice(15, 21)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it("covers several days when the drag goes diagonally", () => {
    const { state } = renderGrid()

    fireEvent.pointerDown(cell("Man", "07:00"))
    const corner = cell("Fre", "09:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(corner)
    fireEvent.pointerMove(corner, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(countPaintedHours(state.grid)).toBe(5 * 3)
    for (const day of [0, 1, 2, 3, 4]) {
      expect(state.grid[day].slice(7, 10)).toEqual([true, true, true])
    }
    expect(state.grid[5][7]).toBe(false)
  })

  it("shrinks again when the drag comes back toward the anchor", () => {
    const { state } = renderGrid()

    fireEvent.pointerDown(cell("Tor", "10:00"))
    const far = cell("Tor", "18:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(far)
    fireEvent.pointerMove(far, { clientX: 1, clientY: 1 })
    expect(countPaintedHours(state.grid)).toBe(9)

    const back = cell("Tor", "12:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(back)
    fireEvent.pointerMove(back, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(countPaintedHours(state.grid)).toBe(3)
    expect(state.grid[3].slice(10, 13)).toEqual([true, true, true])
    expect(state.grid[3][13]).toBe(false)
  })

  it("keeps hours painted before the gesture started", () => {
    const filled = emptyGrid()
    filled[6][22] = true
    const { state } = renderGrid(filled)

    fireEvent.pointerDown(cell("Man", "07:00"))
    const target = cell("Man", "09:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
    fireEvent.pointerMove(target, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(state.grid[6][22]).toBe(true)
    expect(countPaintedHours(state.grid)).toBe(4)
  })

  it("ignores cells belonging to another grid on the page", () => {
    // A household with two cars renders two grids. A drag that leaves one must
    // not pick up the other's cells and apply them to the car being edited.
    const first = { grid: emptyGrid() }
    const onChangeFirst = vi.fn((next: HourGrid) => {
      first.grid = next
    })
    const { container } = render(
      <>
        <WeekHourGrid value={first.grid} onChange={onChangeFirst} />
        <WeekHourGrid value={emptyGrid()} onChange={vi.fn()} />
      </>,
    )

    const grids = container.querySelectorAll("[data-day='0'][data-hour='0']")
    expect(grids).toHaveLength(2)

    const cellsOfFirst = screen.getAllByRole("button", { name: "Man 07:00" })[0]
    const cellOfSecond = screen.getAllByRole("button", { name: "Man 09:00" })[1]

    fireEvent.pointerDown(cellsOfFirst)
    vi.spyOn(document, "elementFromPoint").mockReturnValue(cellOfSecond)
    fireEvent.pointerMove(cellsOfFirst, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    // Only the anchor of the first grid is painted; the stray cell is ignored.
    expect(countPaintedHours(first.grid)).toBe(1)
    expect(first.grid[0][7]).toBe(true)
    expect(first.grid[0][9]).toBe(false)
  })

  it("erases when the drag starts on a painted cell", () => {
    const filled = emptyGrid()
    filled[0][7] = true
    filled[0][8] = true
    const { state } = renderGrid(filled)

    fireEvent.pointerDown(cell("Man", "07:00"))
    const next = cell("Man", "08:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(next)
    fireEvent.pointerMove(next, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(window)
    vi.restoreAllMocks()

    expect(countPaintedHours(state.grid)).toBe(0)
  })

  it("stops painting once the pointer is released", () => {
    const { state } = renderGrid()

    fireEvent.pointerDown(cell("Ons", "12:00"))
    fireEvent.pointerUp(window)

    const other = cell("Ons", "13:00")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(other)
    fireEvent.pointerMove(other, { clientX: 1, clientY: 1 })
    vi.restoreAllMocks()

    expect(state.grid[2][13]).toBe(false)
    expect(countPaintedHours(state.grid)).toBe(1)
  })

  it("marks painted cells as pressed for screen readers", () => {
    const filled = emptyGrid()
    filled[4][15] = true
    renderGrid(filled)

    expect(cell("Fre", "15:00")).toHaveAttribute("aria-pressed", "true")
    expect(cell("Fre", "16:00")).toHaveAttribute("aria-pressed", "false")
  })

  it("fills weekdays 07–16 from the preset", () => {
    const { state } = renderGrid()

    fireEvent.click(screen.getByRole("button", { name: "Hverdage 07–16" }))

    expect(countPaintedHours(state.grid)).toBe(5 * 9)
    expect(state.grid[0][7]).toBe(true)
    expect(state.grid[0][16]).toBe(false)
    expect(state.grid[5][7]).toBe(false)
  })

  it("clears everything with Ryd", () => {
    const filled = emptyGrid()
    filled[3][9] = true
    const { state } = renderGrid(filled)

    fireEvent.click(screen.getByRole("button", { name: "Ryd" }))

    expect(countPaintedHours(state.grid)).toBe(0)
  })

  it("counts the painted hours in the hint text", () => {
    const filled = emptyGrid()
    filled[0][7] = true
    filled[0][8] = true
    renderGrid(filled)

    expect(screen.getByText(/2 timer markeret/)).toBeInTheDocument()
  })
})
