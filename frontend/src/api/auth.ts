/**
 * Authentication API functions
 */

import { apiClient, setTokens, clearTokens } from "./client"

import type {
  AuthTokens,
  ChangePasswordData,
  ForgotPasswordData,
  LoginCredentials,
  RegisterData,
  ResetPasswordData,
  User,
} from "../types"

interface RegisterResponse {
  message: string

  user: User
}

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthTokens> {
    const response = await apiClient.post<AuthTokens>(
      "/auth/token/",

      credentials,
    )

    setTokens(response.data.access, response.data.refresh)

    return response.data
  },

  async register(data: RegisterData): Promise<RegisterResponse> {
    const response = await apiClient.post<RegisterResponse>(
      "/auth/register/",

      data,
    )

    return response.data
  },

  async validateInvitation(token: string): Promise<{
    valid: boolean

    email: string

    expires_at: string
  }> {
    const response = await apiClient.post<{
      valid: boolean

      email: string

      expires_at: string
    }>("/auth/validate-invitation/", { token })

    return response.data
  },

  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<User>("/users/me/")

    return response.data
  },

  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>("/users/me/", data)

    return response.data
  },

  async updateProfilePicture(file: File): Promise<User> {
    const formData = new FormData()

    formData.append("profile_picture", file)

    const response = await apiClient.patch<User>("/users/me/", formData)

    return response.data
  },

  logout(): void {
    // Fire-and-forget: the server destroys the Django session that gates
    // /media/* access. We don't await — clearing local tokens shouldn't
    // depend on the server round-trip. Wrapping with Promise.resolve()
    // tolerates mocks that return undefined synchronously in tests.
    Promise.resolve(apiClient.post("/auth/logout/")).catch(() => {
      // Best-effort; session expires server-side after 30 days anyway.
    })
    clearTokens()
  },

  async changePassword(data: ChangePasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>(
      "/auth/change-password/",

      data,
    )

    return response.data
  },

  async forgotPassword(data: ForgotPasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>(
      "/auth/forgot-password/",

      data,
    )

    return response.data
  },

  async resetPassword(data: ResetPasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>(
      "/auth/reset-password/",

      data,
    )

    return response.data
  },
}
