import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { reportsApi } from "./reports"

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getAccessToken: vi.fn(() => "test-token"),
}))

// exportCsv goes through bare fetch rather than apiClient, because it needs the
// raw body as a blob — so the JWT is attached by hand and nothing else covers it.
describe("reportsApi.exportCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("downloads the udvalg's queue as a .csv file", async () => {
    URL.createObjectURL = vi.fn().mockReturnValue("blob:test")
    URL.revokeObjectURL = vi.fn()
    const anchor = { href: "", download: "", click: vi.fn() }
    vi.spyOn(document, "createElement").mockReturnValue(
      anchor as unknown as HTMLElement,
    )
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["Nr.;Dato"], { type: "text/csv" }),
      }))

    await reportsApi.exportCsv("driftsudvalget")

    expect(fetch).toHaveBeenCalledWith(
      "/api/reports/export/?subgroup=driftsudvalget",
      { headers: { Authorization: "Bearer test-token" } },
    )
    expect(anchor.download).toMatch(
      /^indrapporteringer_driftsudvalget_\d{4}-\d{2}-\d{2}\.csv$/,
    )
    expect(anchor.click).toHaveBeenCalled()
  })

  it("throws when the udvalg is not the caller's to export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    )

    await expect(reportsApi.exportCsv("bestyrelsen")).rejects.toThrow(
      "Eksport fejlede",
    )
  })
})
