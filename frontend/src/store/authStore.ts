/**
 * Auth state management using Zustand
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { User } from "../types"
import { authApi } from "../api/auth"
import { getAccessToken } from "../api/client"

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  fetchCurrentUser: () => Promise<void>
  updateUser: (user: Partial<User>) => void
  clearError: () => void
  checkAuth: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          await authApi.login({ email, password })
          const user = await authApi.getCurrentUser()
          set({ user, isAuthenticated: true, isLoading: false })
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Login failed"
          set({ error: message, isLoading: false })
          throw error
        }
      },

      logout: () => {
        authApi.logout()
        set({ user: null, isAuthenticated: false, error: null })
      },

      fetchCurrentUser: async () => {
        set({ isLoading: true })
        try {
          const user = await authApi.getCurrentUser()
          set({ user, isAuthenticated: true, isLoading: false })
        } catch {
          set({ user: null, isAuthenticated: false, isLoading: false })
        }
      },

      updateUser: (userData: Partial<User>) => {
        const currentUser = get().user
        if (currentUser) {
          set({ user: { ...currentUser, ...userData } })
        }
      },

      clearError: () => set({ error: null }),

      checkAuth: async () => {
        const token = getAccessToken()
        if (!token) {
          set({ isAuthenticated: false, user: null })
          return false
        }

        try {
          const user = await authApi.getCurrentUser()
          set({ user, isAuthenticated: true })
          return true
        } catch {
          set({ isAuthenticated: false, user: null })
          return false
        }
      },
    }),
    {
      name: "auth-storage-v2", // Changed key to invalidate old persisted data
      // Only persist user data, not isAuthenticated
      // isAuthenticated should be validated on each app load via checkAuth()
      partialize: (state) => ({
        user: state.user,
      }),
    },
  ),
)
