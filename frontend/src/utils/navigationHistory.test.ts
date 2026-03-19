import { describe, it, expect, beforeEach, vi } from "vitest"

// navigationHistory has module-level state, so we reset modules before each
// test to get a clean slate (previousPathname = null, currentPathname = null).

describe("navigationHistory", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function fresh() {
    return import("./navigationHistory?t=" + Date.now())
  }

  it("getPreviousPathname returns null before any navigation", async () => {
    const { getPreviousPathname } = await fresh()
    expect(getPreviousPathname()).toBeNull()
  })

  it("previous remains null after the first navigation", async () => {
    const { trackNavigation, getPreviousPathname } = await fresh()
    trackNavigation("/start")
    expect(getPreviousPathname()).toBeNull()
  })

  it("tracks the previous pathname after navigating to a second path", async () => {
    const { trackNavigation, getPreviousPathname } = await fresh()
    trackNavigation("/forum")
    trackNavigation("/forum/subgruppe")
    expect(getPreviousPathname()).toBe("/forum")
  })

  it("does not update when navigating to the same path twice", async () => {
    const { trackNavigation, getPreviousPathname } = await fresh()
    trackNavigation("/a")
    trackNavigation("/b")
    trackNavigation("/b") // no-op
    expect(getPreviousPathname()).toBe("/a")
  })

  it("keeps updating previous as navigation continues", async () => {
    const { trackNavigation, getPreviousPathname } = await fresh()
    trackNavigation("/a")
    trackNavigation("/b")
    trackNavigation("/c")
    expect(getPreviousPathname()).toBe("/b")
  })
})
