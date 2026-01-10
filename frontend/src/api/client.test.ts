import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "./client"

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
