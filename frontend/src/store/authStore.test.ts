import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useAuthStore } from "./authStore"
import { authApi } from "../api/auth"
import * as clientModule from "../api/client"

// Mock the API modules
vi.mock("../api/auth", () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}))

vi.mock("../api/client", () => ({
  getAccessToken: vi.fn(),
  clearTokens: vi.fn(),
}))

const mockUser = {
  id: 1,
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
  phone_number: "",
  birthdate: null,
  profile_picture: null,
  bio: "",
  house: 1,
  house_name: "House 1",
  house_inhabitant_count: 2,
  is_staff: false,
  date_joined: "2024-01-01T00:00:00Z",
}

describe("authStore", () => {
  beforeEach(() => {
    // Reset the store state before each test
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("initial state", () => {
    it("should have correct initial state", () => {
      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe("login", () => {
    it("should set loading state while logging in", async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        access: "token",
        refresh: "refresh",
      })
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser)

      const loginPromise = useAuthStore
        .getState()
        .login("test@example.com", "password")

      // Check loading state is set immediately
      expect(useAuthStore.getState().isLoading).toBe(true)

      await loginPromise
    })

    it("should set user and isAuthenticated on successful login", async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        access: "token",
        refresh: "refresh",
      })
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser)

      await useAuthStore.getState().login("test@example.com", "password")

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it("should set error on failed login", async () => {
      vi.mocked(authApi.login).mockRejectedValue(
        new Error("Invalid credentials"),
      )

      await expect(
        useAuthStore.getState().login("test@example.com", "wrong"),
      ).rejects.toThrow("Invalid credentials")

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe("Invalid credentials")
    })
  })

  describe("logout", () => {
    it("should clear user and authentication state", () => {
      // Set up authenticated state
      useAuthStore.setState({
        user: mockUser,
        isAuthenticated: true,
      })

      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.error).toBeNull()
      expect(authApi.logout).toHaveBeenCalled()
    })
  })

  describe("fetchCurrentUser", () => {
    it("should fetch and set user on success", async () => {
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser)

      await useAuthStore.getState().fetchCurrentUser()

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isLoading).toBe(false)
    })

    it("should clear state on fetch failure", async () => {
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(
        new Error("Unauthorized"),
      )

      await useAuthStore.getState().fetchCurrentUser()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
    })
  })

  describe("updateUser", () => {
    it("should update user fields", () => {
      useAuthStore.setState({ user: mockUser })

      useAuthStore.getState().updateUser({ first_name: "Updated" })

      const state = useAuthStore.getState()
      expect(state.user?.first_name).toBe("Updated")
      expect(state.user?.last_name).toBe("User") // Unchanged
    })

    it("should not update if no user is set", () => {
      useAuthStore.setState({ user: null })

      useAuthStore.getState().updateUser({ first_name: "Updated" })

      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  describe("clearError", () => {
    it("should clear the error state", () => {
      useAuthStore.setState({ error: "Some error" })

      useAuthStore.getState().clearError()

      expect(useAuthStore.getState().error).toBeNull()
    })
  })

  describe("checkAuth", () => {
    it("should return false and clear state if no token", async () => {
      vi.mocked(clientModule.getAccessToken).mockReturnValue(null)

      const result = await useAuthStore.getState().checkAuth()

      expect(result).toBe(false)
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(useAuthStore.getState().user).toBeNull()
    })

    it("should return true and set user if token is valid", async () => {
      vi.mocked(clientModule.getAccessToken).mockReturnValue("valid-token")
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser)

      const result = await useAuthStore.getState().checkAuth()

      expect(result).toBe(true)
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useAuthStore.getState().user).toEqual(mockUser)
    })

    it("should return false and clear state if token is invalid", async () => {
      vi.mocked(clientModule.getAccessToken).mockReturnValue("invalid-token")
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(
        new Error("Unauthorized"),
      )

      const result = await useAuthStore.getState().checkAuth()

      expect(result).toBe(false)
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(useAuthStore.getState().user).toBeNull()
    })
  })
})
