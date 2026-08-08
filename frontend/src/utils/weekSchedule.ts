/**
 * Conversion between the painted week grid and the CarBlock rows the API stores.
 *
 * The grid is 7 days × 24 hours of booleans (day 0 = Monday, matching
 * bookings.RecurringBooking.days_of_week and CarBlock.days_of_week). A painted
 * week becomes as few blocks as possible: contiguous hour runs per day, then
 * days sharing an identical set of runs collapse into one row.
 */

import type { CarBlock } from "../types"

export const DAYS_IN_WEEK = 7
export const HOURS_IN_DAY = 24

/** Danish day labels, Monday first. */
export const DAY_LABELS_SHORT = [
  "Man",
  "Tir",
  "Ons",
  "Tor",
  "Fre",
  "Lør",
  "Søn",
]

export interface BlockInput {
  days_of_week: number[]
  start_time: string
  end_time: string
}

export type HourGrid = boolean[][]

/** One cell of the grid. Named, not inline: oxfmt strips semicolons from inline
 * object types inside signatures, which breaks the build (see CLAUDE.md). */
export interface GridCell {
  day: number
  hour: number
}

export function emptyGrid(): HourGrid {
  return Array.from({ length: DAYS_IN_WEEK }, () =>
    Array.from({ length: HOURS_IN_DAY }, () => false),
  )
}

export function cloneGrid(grid: HourGrid): HourGrid {
  return grid.map((day) => [...day])
}

export function isGridEmpty(grid: HourGrid): boolean {
  return grid.every((day) => day.every((hour) => !hour))
}

export function gridsEqual(a: HourGrid, b: HourGrid): boolean {
  return a.every((day, dayIndex) =>
    day.every((hour, hourIndex) => hour === b[dayIndex]?.[hourIndex]),
  )
}

/**
 * A copy of *base* with the block spanned by two cells set to *filled*.
 *
 * Painting spans a rectangle from where the gesture started to wherever the
 * pointer is now, rather than following the pointer's path: a quick drag only
 * produces a few pointermove samples, and a path would leave the skipped cells
 * unpainted. Recomputing from *base* every move also lets a drag shrink again
 * when the pointer comes back.
 */
export function fillBlock(
  base: HourGrid,
  from: GridCell,
  to: GridCell,
  filled: boolean,
): HourGrid {
  const next = cloneGrid(base)
  const dayFrom = Math.min(from.day, to.day)
  const dayTo = Math.max(from.day, to.day)
  const hourFrom = Math.min(from.hour, to.hour)
  const hourTo = Math.max(from.hour, to.hour)

  for (
    let day = Math.max(0, dayFrom);
    day <= Math.min(DAYS_IN_WEEK - 1, dayTo);
    day++
  ) {
    for (
      let hour = Math.max(0, hourFrom);
      hour <= Math.min(HOURS_IN_DAY - 1, hourTo);
      hour++
    ) {
      next[day][hour] = filled
    }
  }
  return next
}

export function countPaintedHours(grid: HourGrid): number {
  return grid.reduce((total, day) => total + day.filter(Boolean).length, 0)
}

/** "07:00" / "07:00:00" → 7. Minutes round down, so 23:59 → 23. */
function hourOf(time: string): number {
  const [hours] = time.split(":")
  return Number.parseInt(hours, 10) || 0
}

/** Whether a stored time has minutes past the hour (e.g. the 23:59 end). */
function hasMinutes(time: string): boolean {
  const parts = time.split(":")
  return Number.parseInt(parts[1] ?? "0", 10) > 0
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * A run of hours [from..to] inclusive becomes from:00 → (to+1):00.
 *
 * A run reaching hour 23 would need 24:00, which no TimeField accepts, so it
 * ends at 23:59 instead — one minute short of midnight, which no weekly
 * schedule cares about, and hourOf() maps it back to hour 23 on the way in.
 */
function runToTimes(from: number, to: number): [string, string] {
  const start = `${pad(from)}:00`
  const end = to >= HOURS_IN_DAY - 1 ? "23:59" : `${pad(to + 1)}:00`
  return [start, end]
}

export function blocksToGrid(blocks: CarBlock[]): HourGrid {
  const grid = emptyGrid()
  for (const block of blocks) {
    const from = hourOf(block.start_time)
    // An end of 16:00 covers up to hour 15; an end of 23:59 covers hour 23.
    const endHour = hourOf(block.end_time)
    const to = hasMinutes(block.end_time) ? endHour : endHour - 1
    for (const day of block.days_of_week) {
      if (day < 0 || day >= DAYS_IN_WEEK) continue
      for (
        let hour = Math.max(0, from);
        hour <= Math.min(HOURS_IN_DAY - 1, to);
        hour++
      ) {
        grid[day][hour] = true
      }
    }
  }
  return grid
}

interface HourRun {
  from: number
  to: number
}

function runsForDay(hours: boolean[]): HourRun[] {
  const runs: HourRun[] = []
  let start: number | null = null
  for (let hour = 0; hour < HOURS_IN_DAY; hour++) {
    if (hours[hour] && start === null) start = hour
    if (!hours[hour] && start !== null) {
      runs.push({ from: start, to: hour - 1 })
      start = null
    }
  }
  if (start !== null) runs.push({ from: start, to: HOURS_IN_DAY - 1 })
  return runs
}

function runSignature(runs: HourRun[]): string {
  return runs.map((run) => `${run.from}-${run.to}`).join(",")
}

/**
 * Grid → the fewest blocks that describe it. Days with an identical pattern
 * share one block, so a Mon–Fri commute is one row rather than five.
 */
export function gridToBlocks(grid: HourGrid): BlockInput[] {
  const bySignature = new Map<string, number[]>()
  const runsBySignature = new Map<string, HourRun[]>()

  for (let day = 0; day < DAYS_IN_WEEK; day++) {
    const runs = runsForDay(grid[day] ?? [])
    if (runs.length === 0) continue
    const signature = runSignature(runs)
    runsBySignature.set(signature, runs)
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), day])
  }

  const blocks: BlockInput[] = []
  for (const [signature, days] of bySignature) {
    for (const run of runsBySignature.get(signature) ?? []) {
      const [start_time, end_time] = runToTimes(run.from, run.to)
      blocks.push({
        days_of_week: [...days].sort((a, b) => a - b),
        start_time,
        end_time,
      })
    }
  }

  // Stable order: earliest day, then earliest hour.
  blocks.sort(
    (a, b) =>
      a.days_of_week[0] - b.days_of_week[0] ||
      a.start_time.localeCompare(b.start_time),
  )
  return blocks
}

/** "Man–Fre 07–16" style summary of a painted week, for a compact recap. */
export function describeGrid(grid: HourGrid): string {
  const blocks = gridToBlocks(grid)
  if (blocks.length === 0) return "Intet skema — bilen vises som fri hele ugen."
  return blocks
    .map((block) => {
      const days = block.days_of_week
        .map((day) => DAY_LABELS_SHORT[day])
        .join(", ")
      const from = block.start_time.slice(0, 5)
      const to = block.end_time.slice(0, 5)
      return `${days} ${from}–${to}`
    })
    .join(" · ")
}
