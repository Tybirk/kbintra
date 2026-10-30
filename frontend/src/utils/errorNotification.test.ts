import { describe, it, expect, vi } from "vitest"

import { extractErrorMessage } from "./errorNotification"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}))

function drfError(data: unknown) {
  return { isAxiosError: true, response: { status: 400, data } }
}

describe("extractErrorMessage", () => {
  it("prefers detail", () => {
    expect(extractErrorMessage(drfError({ detail: "Nej." }), "x")).toBe("Nej.")
  })

  it("joins field errors", () => {
    expect(extractErrorMessage(drfError({ a: ["En."], b: "To." }), "x")).toBe(
      "En. To.",
    )
  })

  it("reads errors from a nested list, one object per row", () => {
    const error = drfError({
      incoming: [{}, { email: ["Emailadressen er ikke gyldig."] }],
    })

    expect(extractErrorMessage(error, "x")).toBe(
      "Emailadressen er ikke gyldig.",
    )
  })

  it("reads errors from a nested object", () => {
    const error = drfError({ address: { street: ["Mangler."] } })

    expect(extractErrorMessage(error, "x")).toBe("Mangler.")
  })

  it("falls back on a body that isn't DRF's", () => {
    expect(extractErrorMessage(drfError("<html>Bad Gateway</html>"), "x")).toBe(
      "x",
    )
  })
})
