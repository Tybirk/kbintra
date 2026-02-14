import { describe, it, expect, vi, beforeEach } from "vitest"
import { authApi } from "./auth"
import { apiClient, setTokens, clearTokens } from "./client"

// Mock the apiClient and token functions
vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}))

describe("authApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("login", () => {
    it("should login and store tokens", async () => {
      const mockTokens = { access: "access-token", refresh: "refresh-token" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTokens })

      const result = await authApi.login({
        email: "test@example.com",
        password: "password123",
      })

      expect(apiClient.post).toHaveBeenCalledWith("/auth/token/", {
        email: "test@example.com",
        password: "password123",
      })
      expect(setTokens).toHaveBeenCalledWith("access-token", "refresh-token")
      expect(result).toEqual(mockTokens)
    })
  })

  describe("register", () => {
    it("should register new user", async () => {
      const mockResponse = {
        message: "User created successfully",
        user: { id: 1, email: "test@example.com" },
      }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse })

      const result = await authApi.register({
        email: "test@example.com",
        password: "password123",
        first_name: "Test",
        last_name: "User",
        invitation_token: "token123",
      })

      expect(apiClient.post).toHaveBeenCalledWith("/auth/register/", {
        email: "test@example.com",
        password: "password123",
        first_name: "Test",
        last_name: "User",
        invitation_token: "token123",
      })
      expect(result).toEqual(mockResponse)
    })
  })

  describe("validateInvitation", () => {
    it("should validate invitation token", async () => {
      const mockResponse = {
        valid: true,
        email: "invited@example.com",
        expires_at: "2025-01-20T00:00:00Z",
      }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse })

      const result = await authApi.validateInvitation("token123")

      expect(apiClient.post).toHaveBeenCalledWith(
        "/auth/validate-invitation/",
        {
          token: "token123",
        },
      )
      expect(result).toEqual(mockResponse)
    })

    it("should return invalid for bad token", async () => {
      const mockResponse = {
        valid: false,
        email: "",
        expires_at: "",
      }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse })

      const result = await authApi.validateInvitation("bad-token")

      expect(result.valid).toBe(false)
    })
  })

  describe("getCurrentUser", () => {
    it("should fetch current user", async () => {
      const mockUser = {
        id: 1,
        email: "test@example.com",
        first_name: "Test",
        last_name: "User",
      }
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser })

      const result = await authApi.getCurrentUser()

      expect(apiClient.get).toHaveBeenCalledWith("/users/me/")
      expect(result).toEqual(mockUser)
    })
  })

  describe("updateProfile", () => {
    it("should update user profile", async () => {
      const mockUser = {
        id: 1,
        email: "test@example.com",
        first_name: "Updated",
        last_name: "Name",
      }
      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockUser })

      const result = await authApi.updateProfile({
        first_name: "Updated",
        last_name: "Name",
      })

      expect(apiClient.patch).toHaveBeenCalledWith("/users/me/", {
        first_name: "Updated",
        last_name: "Name",
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe("updateProfilePicture", () => {
    it("should upload profile picture", async () => {
      const mockUser = {
        id: 1,
        email: "test@example.com",
        profile_picture: "/media/profiles/avatar.jpg",
      }
      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockUser })

      const file = new File(["test"], "avatar.jpg", { type: "image/jpeg" })
      const result = await authApi.updateProfilePicture(file)

      expect(apiClient.patch).toHaveBeenCalledWith(
        "/users/me/",
        expect.any(FormData),
      )
      expect(result).toEqual(mockUser)
    })
  })

  describe("logout", () => {
    it("should clear tokens on logout", () => {
      authApi.logout()

      expect(clearTokens).toHaveBeenCalled()
    })
  })
})
