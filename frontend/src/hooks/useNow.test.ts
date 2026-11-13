import { describe, it, expect, vi, afterEach } from "vitest"

import { act, renderHook } from "@testing-library/react"

import { useNow } from "./useNow"

describe("useNow", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("moves on every half minute, so '3 min' becomes '4 min' in time", () => {
    vi.useFakeTimers()

    vi.setSystemTime(new Date(2026, 10, 13, 15, 0))

    const { result } = renderHook(() => useNow())

    expect(result.current.format("HH:mm:ss")).toBe("15:00:00")

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(result.current.format("HH:mm:ss")).toBe("15:00:30")
  })
})
