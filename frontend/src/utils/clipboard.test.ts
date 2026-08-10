import { describe, it, expect, vi, afterEach } from "vitest"

import { copyToClipboard } from "./clipboard"

const originalClipboard = navigator.clipboard

const originalExecCommand = (document as unknown as { execCommand?: unknown })
  .execCommand

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  })
}

function setExecCommand(value: unknown) {
  Object.defineProperty(document, "execCommand", {
    value,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  setClipboard(originalClipboard)
  setExecCommand(originalExecCommand)
  vi.restoreAllMocks()
})

describe("copyToClipboard", () => {
  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    const ok = await copyToClipboard("123")

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith("123")
  })

  it("falls back to execCommand when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    setClipboard({ writeText })
    const execCommand = vi.fn().mockReturnValue(true)
    setExecCommand(execCommand)

    const ok = await copyToClipboard("abc")

    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("falls back to execCommand when the Clipboard API is missing", async () => {
    setClipboard(undefined)
    const execCommand = vi.fn().mockReturnValue(true)
    setExecCommand(execCommand)

    const ok = await copyToClipboard("xyz")

    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("returns false when both the API and execCommand fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    setClipboard({ writeText })
    setExecCommand(vi.fn().mockReturnValue(false))

    const ok = await copyToClipboard("nope")

    expect(ok).toBe(false)
  })
})
