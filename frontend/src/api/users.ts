/**
 * Users API functions
 */

import { apiClient } from "./client"
import type { User, PaginatedResponse, Invitation, MentionUser } from "../types"

export const usersApi = {
  async getUsers(): Promise<PaginatedResponse<User>> {
    const response = await apiClient.get<PaginatedResponse<User>>("/users/")
    return response.data
  },

  async getUpcomingBirthdays(days = 7): Promise<User[]> {
    const response = await apiClient.get<User[]>(
      `/users/birthdays/?days=${days}`,
    )
    return response.data
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

  async mentionSearch(q: string): Promise<MentionUser[]> {
    const params = q ? `?q=${encodeURIComponent(q)}` : ""
    const response = await apiClient.get<MentionUser[]>(
      `/users/mentions/${params}`,
    )
    return response.data
  },
}
