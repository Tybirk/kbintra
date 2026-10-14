import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import axios, { AxiosError, type AxiosRequestConfig } from "axios"

import {
  apiClient,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "./client"

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}))

vi.mock("@sentry/react", () => ({
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({ setTag: vi.fn(), setLevel: vi.fn() }),
  ),
  addBreadcrumb: vi.fn(),
}))

describe("API Client Token Management", () => {
  const mockLocalStorage: Record<string, string> = {}

  beforeEach(() => {
    // Mock localStorage

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => mockLocalStorage[key] || null,
    )

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (key: string, value: string) => {
        mockLocalStorage[key] = value
      },
    )

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
      (key: string) => {
        delete mockLocalStorage[key]
      },
    )

    // Clear mock storage

    Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("getAccessToken", () => {
    it("should return null when no token is stored", () => {
      expect(getAccessToken()).toBeNull()
    })

    it("should return the stored access token", () => {
      mockLocalStorage["kbintra_access_token"] = "test-access-token"

      expect(getAccessToken()).toBe("test-access-token")
    })
  })

  describe("getRefreshToken", () => {
    it("should return null when no token is stored", () => {
      expect(getRefreshToken()).toBeNull()
    })

    it("should return the stored refresh token", () => {
      mockLocalStorage["kbintra_refresh_token"] = "test-refresh-token"

      expect(getRefreshToken()).toBe("test-refresh-token")
    })
  })

  describe("setTokens", () => {
    it("should store both access and refresh tokens", () => {
      setTokens("new-access", "new-refresh")

      expect(mockLocalStorage["kbintra_access_token"]).toBe("new-access")

      expect(mockLocalStorage["kbintra_refresh_token"]).toBe("new-refresh")
    })
  })

  describe("clearTokens", () => {
    it("should remove both tokens from storage", () => {
      mockLocalStorage["kbintra_access_token"] = "access"

      mockLocalStorage["kbintra_refresh_token"] = "refresh"

      clearTokens()

      expect(mockLocalStorage["kbintra_access_token"]).toBeUndefined()

      expect(mockLocalStorage["kbintra_refresh_token"]).toBeUndefined()
    })
  })
})

describe("Connection toast gating", () => {
  // Drive the real interceptor by swapping the axios adapter to simulate
  // no-response (network) failures and successful round-trips.
  const okAdapter = (config: AxiosRequestConfig) =>
    Promise.resolve({
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config: config as never,
    })

  const networkErrorAdapter = (config: AxiosRequestConfig) =>
    Promise.reject(
      new AxiosError("Network Error", "ERR_NETWORK", config as never),
    )

  let show: ReturnType<typeof vi.fn>

  const fail = async () => {
    apiClient.defaults.adapter = networkErrorAdapter
    await apiClient.get("/ping").catch(() => {})
  }

  const succeed = async () => {
    apiClient.defaults.adapter = okAdapter
    await apiClient.get("/ping")
  }

  beforeEach(async () => {
    const { notifications } = await import("@mantine/notifications")
    show = (notifications.show as ReturnType<typeof vi.fn>)
    // A success resets the module-level failure streak between tests.
    await succeed()
    show.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("stays quiet for fewer than 3 consecutive failures", async () => {
    await fail()
    await fail()

    expect(show).not.toHaveBeenCalled()
  })

  it("shows the toast on the 3rd consecutive failure", async () => {
    await fail()
    await fail()
    await fail()

    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ color: "orange" }),
    )
  })

  it("a successful request resets the streak", async () => {
    await fail()
    await fail()
    await succeed()
    await fail()
    await fail()

    expect(show).not.toHaveBeenCalled()
  })

  it("does not count or toast for skipConnectionToast requests", async () => {
    apiClient.defaults.adapter = networkErrorAdapter
    await apiClient
      .get("/food/drive-menu/", { skipConnectionToast: true })
      .catch(() => {})
    await apiClient
      .get("/food/drive-menu/", { skipConnectionToast: true })
      .catch(() => {})
    await apiClient
      .get("/food/drive-menu/", { skipConnectionToast: true })
      .catch(() => {})

    expect(show).not.toHaveBeenCalled()
  })
})

describe("Token refresh", () => {
  // A token the client can read the expiry of. Nothing here checks signatures.
  const jwt = (expiresInS: number, id: string) =>
    `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInS, jti: id }))}.s`

  const unauthorized = (config?: AxiosRequestConfig) =>
    new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config as never, null, {
      status: 401,
      statusText: "Unauthorized",
      data: {},
      headers: {},
      config: config as never,
    })

  let sent: (string | undefined)[]

  let refresh: ReturnType<typeof vi.spyOn>

  // The API answers 401 to `revoked`, and 200 to anything else.
  const serve = (revoked?: string) => {
    apiClient.defaults.adapter = (config) => {
      const auth = config.headers?.Authorization as string | undefined

      sent.push(auth)

      if (revoked && auth === `Bearer ${revoked}`) {
        return Promise.reject(unauthorized(config))
      }

      return Promise.resolve({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config: config as never,
      })
    }
  }

  beforeEach(() => {
    localStorage.clear()

    sent = []

    refresh = vi.spyOn(axios, "post")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("refreshes an expired token once before sending, however many requests wait", async () => {
    const fresh = jwt(3600, "fresh")

    setTokens(jwt(-60, "old"), "r1")

    refresh.mockResolvedValue({ data: { access: fresh, refresh: "r2" } })

    serve()

    await Promise.all(["/a", "/b", "/c"].map((url) => apiClient.get(url)))

    expect(refresh).toHaveBeenCalledTimes(1)

    expect(sent).toEqual(Array(3).fill(`Bearer ${fresh}`))

    expect(getRefreshToken()).toBe("r2")
  })

  it("leaves a token that is still valid alone", async () => {
    const valid = jwt(3600, "valid")

    setTokens(valid, "r1")

    serve()

    await apiClient.get("/a")

    expect(refresh).not.toHaveBeenCalled()

    expect(sent).toEqual([`Bearer ${valid}`])
  })

  it("refreshes and retries when the server rejects a token that looked valid", async () => {
    const revoked = jwt(3600, "revoked")

    const fresh = jwt(3600, "fresh")

    setTokens(revoked, "r1")

    refresh.mockResolvedValue({ data: { access: fresh, refresh: "r2" } })

    serve(revoked)

    await apiClient.get("/a")

    expect(refresh).toHaveBeenCalledTimes(1)

    expect(sent).toEqual([`Bearer ${revoked}`, `Bearer ${fresh}`])
  })

  it("keeps the session when the refresh fails for want of a connection", async () => {
    const old = jwt(-60, "old")

    setTokens(old, "r1")

    refresh.mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"))

    serve(old)

    await expect(apiClient.get("/a")).rejects.toThrow("Network Error")

    expect(getRefreshToken()).toBe("r1")
  })

  it("ends the session when the server turns the refresh token down", async () => {
    const old = jwt(-60, "old")

    setTokens(old, "r1")

    refresh.mockRejectedValue(unauthorized())

    serve(old)

    await expect(apiClient.get("/a")).rejects.toThrow("Unauthorized")

    expect(getRefreshToken()).toBeNull()
  })
})
