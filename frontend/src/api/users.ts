/**
 * Users API functions
 */

import { apiClient } from "./client"
import { asArray } from "./helpers"

import type { User, PaginatedResponse, Invitation, MentionUser } from "../types"

export const usersApi = {
  async getUsers(): Promise<PaginatedResponse<User>> {
    const response = await apiClient.get<PaginatedResponse<User>>("/users/")

    return response.data
  },

  // The /users/ endpoint is not paginated (community is ~90 users), so it
  // returns a plain array. asArray tolerates both shapes defensively.
  async getAllUsers(): Promise<User[]> {
    const response = await apiClient.get("/users/")

    return asArray(response.data)
  },

  async getUpcomingBirthdays(days = 7): Promise<User[]> {
    const response = await apiClient.get(`/users/birthdays/?days=${days}`)

    return asArray(response.data)
  },

  async getUser(id: number): Promise<User> {
    const response = await apiClient.get<User>(`/users/${id}/`)

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

  async getInvitations(): Promise<PaginatedResponse<Invitation>> {
    const response =
      await apiClient.get<PaginatedResponse<Invitation>>("/auth/invitations/")

    return response.data
  },

  async createInvitation(email: string, house: number): Promise<Invitation> {
    const response = await apiClient.post<Invitation>("/auth/invitations/", {
      email,

      house,
    })

    return response.data
  },

  async requestEmailChange(
    newEmail: string,

    currentPassword: string,
  ): Promise<void> {
    await apiClient.post("/auth/request-email-change/", {
      new_email: newEmail,

      current_password: currentPassword,
    })
  },

  async confirmEmailChange(token: string): Promise<void> {
    await apiClient.post("/auth/confirm-email-change/", { token })
  },

  async mentionSearch(q: string): Promise<MentionUser[]> {
    const params = q ? `?q=${encodeURIComponent(q)}` : ""

    const response = await apiClient.get(`/users/mentions/${params}`)

    return asArray(response.data)
  },

  async deleteAccount(password: string): Promise<void> {
    await apiClient.post("/auth/delete-account/", { password })
  },

  async exportData(): Promise<void> {
    const response = await apiClient.get("/auth/me/export/", {
      responseType: "blob",
    })

    const url = URL.createObjectURL(
      new Blob([response.data], { type: "application/json" }),
    )

    const a = document.createElement("a")

    a.href = url

    a.download = "mine-data.json"

    a.click()

    URL.revokeObjectURL(url)
  },
}
