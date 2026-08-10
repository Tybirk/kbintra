import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { AxiosError, type AxiosRequestConfig } from "axios"

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
