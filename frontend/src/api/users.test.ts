import { describe, it, expect, vi, beforeEach } from "vitest"

import { usersApi } from "./users"

import { apiClient } from "./client"

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),

    patch: vi.fn(),

    put: vi.fn(),

    delete: vi.fn(),
  },
}))

describe("usersApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getUsers calls GET /users/", async () => {
    const mockData = { results: [], count: 0 }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })

    const result = await usersApi.getUsers()

    expect(apiClient.get).toHaveBeenCalledWith("/users/")

    expect(result).toEqual(mockData)
  })

  it("getUpcomingBirthdays calls GET /users/birthdays/?days=7 by default", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

    await usersApi.getUpcomingBirthdays()

    expect(apiClient.get).toHaveBeenCalledWith("/users/birthdays/?days=7")
  })

  it("getUpcomingBirthdays passes custom days parameter", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

    await usersApi.getUpcomingBirthdays(14)

    expect(apiClient.get).toHaveBeenCalledWith("/users/birthdays/?days=14")
  })

  it("getUser calls GET /users/{id}/", async () => {
    const mockUser = { id: 42, first_name: "Anders" }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser })

    const result = await usersApi.getUser(42)

    expect(apiClient.get).toHaveBeenCalledWith("/users/42/")

    expect(result).toEqual(mockUser)
  })

  it("getCurrentUser calls GET /users/me/", async () => {
    const mockUser = { id: 1, first_name: "Mig" }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser })

    const result = await usersApi.getCurrentUser()

    expect(apiClient.get).toHaveBeenCalledWith("/users/me/")

    expect(result).toEqual(mockUser)
  })

  it("updateProfile patches /users/me/ with data", async () => {
    const mockUser = { id: 1, bio: "Min bio" }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockUser })

    const result = await usersApi.updateProfile({ bio: "Min bio" })

    expect(apiClient.patch).toHaveBeenCalledWith("/users/me/", {
      bio: "Min bio",
    })

    expect(result).toEqual(mockUser)
  })

  it("updateProfilePicture patches /users/me/ with FormData", async () => {
    const mockUser = { id: 1 }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockUser })

    const file = new File(["img"], "profilbillede.jpg", { type: "image/jpeg" })

    await usersApi.updateProfilePicture(file)

    expect(apiClient.patch).toHaveBeenCalledWith(
      "/users/me/",

      expect.any(FormData),
    )
  })

  it("getInvitations calls GET /auth/invitations/", async () => {
    const mockData = { results: [], count: 0 }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })

    const result = await usersApi.getInvitations()

    expect(apiClient.get).toHaveBeenCalledWith("/auth/invitations/")

    expect(result).toEqual(mockData)
  })

  it("createInvitation posts to /auth/invitations/", async () => {
    const mockInvitation = { id: 1, email: "ny@example.com" }

    vi.mocked(apiClient.post).mockResolvedValue({ data: mockInvitation })

    const result = await usersApi.createInvitation("ny@example.com", 3)

    expect(apiClient.post).toHaveBeenCalledWith("/auth/invitations/", {
      email: "ny@example.com",

      house: 3,
    })

    expect(result).toEqual(mockInvitation)
  })

  it("requestEmailChange posts to /auth/request-email-change/", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({})

    await usersApi.requestEmailChange("ny@example.com", "mittpassword")

    expect(apiClient.post).toHaveBeenCalledWith("/auth/request-email-change/", {
      new_email: "ny@example.com",

      current_password: "mittpassword",
    })
  })

  it("confirmEmailChange posts to /auth/confirm-email-change/", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({})

    await usersApi.confirmEmailChange("abc123token")

    expect(apiClient.post).toHaveBeenCalledWith("/auth/confirm-email-change/", {
      token: "abc123token",
    })
  })

  it("mentionSearch calls GET /users/mentions/?q=... with query", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

    await usersApi.mentionSearch("peter")

    expect(apiClient.get).toHaveBeenCalledWith("/users/mentions/?q=peter")
  })

  it("mentionSearch calls GET /users/mentions/ without query when empty", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] })

    await usersApi.mentionSearch("")

    expect(apiClient.get).toHaveBeenCalledWith("/users/mentions/")
  })
})
