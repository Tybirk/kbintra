import { useCallback, useEffect, useRef, useState } from "react"

import { Box, Button, Group, Stack, Text } from "@mantine/core"

import { useMediaQuery } from "@mantine/hooks"

import {
  countPaintedHours,
  DAY_LABELS_SHORT,
  DAYS_IN_WEEK,
  emptyGrid,
  fillBlock,
  gridsEqual,
  HOURS_IN_DAY,
  isGridEmpty,
} from "../utils/weekSchedule"

import type { GridCell, HourGrid } from "../utils/weekSchedule"

// Pixel geometry, because the hour axis is positioned against it: the labels have
// to land exactly on the gaps between rows. Derived from one row height so the
// axis cannot drift out of alignment when that height changes.
const ROW_GAP = 2
const DAY_HEADER_HEIGHT = 20
// 20px rows are comfortable with a mouse but a poor touch target, so narrow
// screens get taller ones. (Real touch accuracy has not been measured on a
// device; this is a geometry improvement, not a verified fix.)
const ROW_HEIGHT_DESKTOP = 20
const ROW_HEIGHT_TOUCH = 30

function gridHeight(rowHeight: number): number {
  return HOURS_IN_DAY * rowHeight + (HOURS_IN_DAY - 1) * ROW_GAP
}

interface WeekHourGridProps {
  value: HourGrid
  onChange: (grid: HourGrid) => void
  disabled?: boolean
}

/** Read the day/hour a pointer is currently over, within one grid.
 *
 * Scoped to *within*: a household with two cars renders two grids, and a drag
 * that runs off the bottom of one would otherwise pick up the next grid's cells
 * and apply their coordinates to the car being edited. */
function cellFromPoint(
  x: number,
  y: number,
  within: HTMLElement | null,
): GridCell | null {
  const element = document.elementFromPoint(x, y)
  const cell = element?.closest<HTMLElement>("[data-day][data-hour]")
  if (!cell || (within && !within.contains(cell))) return null
  const day = Number.parseInt(cell.dataset.day ?? "", 10)
  const hour = Number.parseInt(cell.dataset.hour ?? "", 10)
  if (Number.isNaN(day) || Number.isNaN(hour)) return null
  return { day, hour }
}

/**
 * Paint a car's weekly schedule: 7 days × 24 hours, drag to fill.
 *
 * Dragging from an empty cell paints; dragging from a filled one erases, which
 * is what people expect from every other paint tool. A drag fills the block
 * between where it started and where the pointer is now, so dragging down a day
 * sets that day's hours and dragging diagonally covers several days at once.
 */
export function WeekHourGrid({
  value,
  onChange,
  disabled = false,
}: WeekHourGridProps) {
  // "paint" or "erase" for the gesture in progress; null when not dragging.
  // useMediaQuery returns undefined on the first render, so the falsy branch has
  // to be the desktop default (same caveat as FilePreview.tsx).
  const narrow = useMediaQuery("(max-width: 48em)")
  const rowHeight = narrow ? ROW_HEIGHT_TOUCH : ROW_HEIGHT_DESKTOP
  const height = gridHeight(rowHeight)

  const modeRef = useRef<"paint" | "erase" | null>(null)
  // Where the gesture started, and the grid as it was then: every move
  // recomputes the block from these, so dragging back shrinks the selection.
  const anchorRef = useRef<GridCell | null>(null)
  const baseRef = useRef<HourGrid>(value)
  const gridRef = useRef<HourGrid>(value)
  // The cell container of *this* grid, so a drag cannot stray into another one.
  const cellsRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    gridRef.current = value
  }, [value])

  const applyTo = useCallback(
    (cell: GridCell) => {
      const mode = modeRef.current
      const anchor = anchorRef.current
      if (!mode || !anchor) return

      const next = fillBlock(baseRef.current, anchor, cell, mode === "paint")
      if (gridsEqual(next, gridRef.current)) return
      gridRef.current = next
      onChange(next)
    },
    [onChange],
  )

  const endDrag = useCallback(() => {
    modeRef.current = null
    anchorRef.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    // Release outside the grid still has to end the gesture, or the next hover
    // would keep painting without the pointer being down.
    window.addEventListener("pointerup", endDrag)
    window.addEventListener("pointercancel", endDrag)
    return () => {
      window.removeEventListener("pointerup", endDrag)
      window.removeEventListener("pointercancel", endDrag)
    }
  }, [dragging, endDrag])

  function handlePointerDown(
    event: React.PointerEvent,
    day: number,
    hour: number,
  ) {
    if (disabled) return
    // Keep the page from scrolling under a touch drag.
    event.preventDefault()
    modeRef.current = value[day]?.[hour] ? "erase" : "paint"
    anchorRef.current = { day, hour }
    baseRef.current = value
    setDragging(true)
    applyTo({ day, hour })
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (disabled || !modeRef.current) return
    event.preventDefault()
    // elementFromPoint rather than per-cell pointerenter: during a touch drag
    // all events go to the element the touch started on, so enter never fires.
    const cell = cellFromPoint(event.clientX, event.clientY, cellsRef.current)
    if (cell) applyTo(cell)
  }

  const painted = countPaintedHours(value)

  return (
    <Stack gap="xs">
      <Box style={{ display: "flex", gap: 4, maxWidth: "100%" }}>
        {/* Hour axis. The numbers sit on the lines *between* the cells, not
            beside them, so a filled 07 cell plainly runs from 07 to 08 — with
            labels centred on rows you cannot tell whether 07 is the start or
            the end. That needs 25 labels for 24 rows. */}
        <Box
          style={{
            position: "relative",
            width: "2rem",
            height,
            marginTop: DAY_HEADER_HEIGHT,
            flex: "none",
          }}
        >
          {Array.from({ length: HOURS_IN_DAY + 1 }, (_, boundary) => (
            <Text
              key={boundary}
              size="10px"
              c="dimmed"
              ta="right"
              style={{
                position: "absolute",
                right: 0,
                top: boundary * (rowHeight + ROW_GAP) - ROW_GAP / 2,
                transform: "translateY(-50%)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {String(boundary).padStart(2, "0")}
            </Text>
          ))}
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${DAYS_IN_WEEK}, 1fr)`,
              gap: ROW_GAP,
              height: DAY_HEADER_HEIGHT,
              // Which day a cell belongs to is the one thing you cannot infer
              // once the header has scrolled past.
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: "var(--mantine-color-body)",
            }}
          >
            {DAY_LABELS_SHORT.map((label) => (
              <Text
                key={label}
                size="xs"
                fw={600}
                ta="center"
                style={{ lineHeight: 1.2 }}
              >
                {label}
              </Text>
            ))}
          </Box>

          <Box
            ref={cellsRef}
            onPointerMove={handlePointerMove}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${DAYS_IN_WEEK}, 1fr)`,
              gridTemplateRows: `repeat(${HOURS_IN_DAY}, ${rowHeight}px)`,
              gap: ROW_GAP,
              touchAction: "none",
              userSelect: "none",
            }}
          >
            {Array.from({ length: HOURS_IN_DAY }, (_, hour) =>
              Array.from({ length: DAYS_IN_WEEK }, (_, day) => {
                const filled = value[day]?.[hour] ?? false
                return (
                  <Box
                    key={`${day}-${hour}`}
                    component="button"
                    type="button"
                    data-day={day}
                    data-hour={hour}
                    aria-pressed={filled}
                    aria-label={`${DAY_LABELS_SHORT[day]} ${String(hour).padStart(2, "0")}:00`}
                    disabled={disabled}
                    onPointerDown={(event: React.PointerEvent) =>
                      handlePointerDown(event, day, hour)
                    }
                    style={{
                      gridColumn: day + 1,
                      gridRow: hour + 1,
                      border: "1px solid var(--mantine-color-gray-3)",
                      borderRadius: 2,
                      padding: 0,
                      cursor: disabled ? "default" : "pointer",
                      background: filled
                        ? "var(--mantine-color-yellow-4)"
                        : "var(--mantine-color-body)",
                    }}
                  />
                )
              }),
            )}
          </Box>
        </Box>
      </Box>

      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          {painted === 0
            ? "Tryk eller træk over felterne for at markere hvornår bilen normalt er i brug."
            : `${painted} time${
                painted === 1 ? "" : "r"
              } markeret. Tryk igen for at fjerne.`}
        </Text>
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            disabled={disabled}
            onClick={() => {
              const next = emptyGrid()
              for (const day of [0, 1, 2, 3, 4]) {
                for (let hour = 7; hour < 16; hour++) next[day][hour] = true
              }
              gridRef.current = next
              onChange(next)
            }}
          >
            Hverdage 07–16
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            disabled={disabled || isGridEmpty(value)}
            onClick={() => {
              const next = emptyGrid()
              gridRef.current = next
              onChange(next)
            }}
          >
            Ryd
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}

export default WeekHourGrid
