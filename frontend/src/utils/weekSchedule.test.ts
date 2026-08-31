import { describe, it, expect } from "vitest"

import {
  blocksToGrid,
  countPaintedHours,
  describeGrid,
  emptyGrid,
  gridToBlocks,
  isGridEmpty,
} from "./weekSchedule"

import type { CarBlock } from "../types"

function block(overrides: Partial<CarBlock>): CarBlock {
  return {
    id: 1,
    car: 1,
    days_of_week: [0],
    days_of_week_display: "Mandag",
    start_time: "07:00:00",
    end_time: "16:00:00",
    ...overrides,
  }
}

function paint(grid: boolean[][], day: number, from: number, to: number) {
  for (let hour = from; hour <= to; hour++) grid[day][hour] = true
}

describe("weekSchedule", () => {
  it("starts empty", () => {
    const grid = emptyGrid()
    expect(grid).toHaveLength(7)
    expect(grid[0]).toHaveLength(24)
    expect(isGridEmpty(grid)).toBe(true)
    expect(gridToBlocks(grid)).toEqual([])
  })

  it("turns a stored block into painted hours, end-exclusive", () => {
    const grid = blocksToGrid([
      block({ start_time: "07:00:00", end_time: "10:00:00" }),
    ])
    expect(grid[0][6]).toBe(false)
    expect(grid[0][7]).toBe(true)
    expect(grid[0][9]).toBe(true)
    // 10:00 is the end, so hour 10 is free.
    expect(grid[0][10]).toBe(false)
  })

  it("turns a painted run back into one block", () => {
    const grid = emptyGrid()
    paint(grid, 0, 7, 9)
    expect(gridToBlocks(grid)).toEqual([
      { days_of_week: [0], start_time: "07:00", end_time: "10:00" },
    ])
  })

  it("collapses days with an identical pattern into one block", () => {
    const grid = emptyGrid()
    for (const day of [0, 1, 2, 3, 4]) paint(grid, day, 7, 15)

    const blocks = gridToBlocks(grid)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].days_of_week).toEqual([0, 1, 2, 3, 4])
    expect(blocks[0].start_time).toBe("07:00")
    expect(blocks[0].end_time).toBe("16:00")
  })

  it("keeps days with different patterns apart", () => {
    const grid = emptyGrid()
    paint(grid, 0, 7, 8)
    paint(grid, 1, 17, 18)

    const blocks = gridToBlocks(grid)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ days_of_week: [0], start_time: "07:00" })
    expect(blocks[1]).toMatchObject({ days_of_week: [1], start_time: "17:00" })
  })

  it("splits a day with a gap into two blocks", () => {
    const grid = emptyGrid()
    paint(grid, 2, 6, 7)
    paint(grid, 2, 16, 18)

    const blocks = gridToBlocks(grid)
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => [b.start_time, b.end_time])).toEqual([
      ["06:00", "08:00"],
      ["16:00", "19:00"],
    ])
    expect(blocks.every((b) => b.days_of_week.length === 1)).toBe(true)
  })

  it("ends at 23:59 for a run reaching the last hour", () => {
    // 24:00 is not a valid TimeField value, so the last hour ends a minute short.
    const grid = emptyGrid()
    paint(grid, 6, 22, 23)

    const blocks = gridToBlocks(grid)
    expect(blocks[0]).toMatchObject({ start_time: "22:00", end_time: "23:59" })
  })

  it("reads 23:59 back as the last hour being painted", () => {
    const grid = blocksToGrid([
      block({
        days_of_week: [6],
        start_time: "22:00:00",
        end_time: "23:59:00",
      }),
    ])
    expect(grid[6][22]).toBe(true)
    expect(grid[6][23]).toBe(true)
  })

  it("round-trips a whole painted week unchanged", () => {
    const grid = emptyGrid()
    for (const day of [0, 1, 2, 3, 4]) paint(grid, day, 7, 15)
    paint(grid, 5, 9, 13)
    paint(grid, 6, 20, 23)

    const asBlocks = gridToBlocks(grid).map((b, index) =>
      block({ id: index, ...b, days_of_week_display: "" }),
    )
    expect(blocksToGrid(asBlocks)).toEqual(grid)
  })

  it("survives a full week painted solid", () => {
    const grid = emptyGrid()
    for (let day = 0; day < 7; day++) paint(grid, day, 0, 23)

    const blocks = gridToBlocks(grid)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].days_of_week).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(countPaintedHours(grid)).toBe(168)

    const restored = blocksToGrid(
      blocks.map((b, index) =>
        block({ id: index, ...b, days_of_week_display: "" }),
      ),
    )
    expect(restored).toEqual(grid)
  })

  it("ignores out-of-range day indexes from the API", () => {
    const grid = blocksToGrid([block({ days_of_week: [0, 9, -1] })])
    expect(grid[0][7]).toBe(true)
    expect(countPaintedHours(grid)).toBe(9)
  })

  it("describes a painted week in Danish", () => {
    const grid = emptyGrid()
    for (const day of [0, 1, 2, 3, 4]) paint(grid, day, 7, 15)
    expect(describeGrid(grid)).toBe("Man, Tir, Ons, Tor, Fre 07:00–16:00")
    expect(describeGrid(emptyGrid())).toContain("Intet skema")
  })
})
