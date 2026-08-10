import { describe, it, expect, vi, beforeEach } from "vitest"

import { expensesApi } from "./expenses"

import { apiClient } from "./client"

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

describe("expensesApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("listMine calls GET /expenses/", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] })
    const result = await expensesApi.listMine()
    expect(apiClient.get).toHaveBeenCalledWith("/expenses/")
    expect(result).toEqual([])
  })

  it("create posts multipart FormData with fields and files", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 1 } })
    const file = new File(["x"], "bon.pdf", { type: "application/pdf" })
    await expensesApi.create(
      {
        reg_nr: "1234",
        account_number: "9876543",
        amount: "250.50",
        description: "Maling",
        approval_reference: "",
      },
      [file],
    )
    expect(apiClient.post).toHaveBeenCalledTimes(1)
    const [url, body] = vi.mocked(apiClient.post).mock.calls[0]
    expect(url).toBe("/expenses/")
    expect(body).toBeInstanceOf(FormData)
    const fd = body as FormData
    expect(fd.get("reg_nr")).toBe("1234")
    expect(fd.get("amount")).toBe("250.50")
    expect(fd.getAll("files")).toHaveLength(1)
  })

  it("setStatus patches the status endpoint with note", async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { id: 3, status: "paid" },
    })
    await expensesApi.setStatus(3, "paid", "")
    expect(apiClient.patch).toHaveBeenCalledWith("/expenses/3/status/", {
      status: "paid",
      admin_note: "",
    })
  })

  it("listAll builds a filtered query string", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { results: [], total: "0.00" },
    })
    await expensesApi.listAll({
      status: "paid",
      user: 7,
      from: "2026-01-01",
      to: "2026-02-01",
    })
    expect(apiClient.get).toHaveBeenCalledWith(
      "/expenses/admin/?status=paid&user=7&from=2026-01-01&to=2026-02-01",
    )
  })

  it("listAll omits the query string when no filters are set", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { results: [], total: "0.00" },
    })
    await expensesApi.listAll({})
    expect(apiClient.get).toHaveBeenCalledWith("/expenses/admin/")
  })

  it("removeAttachment deletes the attachment endpoint", async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: null })
    await expensesApi.removeAttachment(42)
    expect(apiClient.delete).toHaveBeenCalledWith("/expenses/attachments/42/")
  })
})
