import { describe, it, expect, vi, beforeEach } from "vitest"
import { foodApi } from "./food"
import { apiClient } from "./client"

// Mock the apiClient
vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

describe("foodApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Menu Templates", () => {
    it("should fetch templates", async () => {
      const mockTemplates = [{ id: 1, name: "Test Template" }]
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockTemplates },
      })

      const result = await foodApi.getTemplates()

      expect(apiClient.get).toHaveBeenCalledWith("/food/templates/")
      expect(result).toEqual(mockTemplates)
    })

    it("should create template", async () => {
      const mockTemplate = { id: 1, name: "New Template" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTemplate })

      const result = await foodApi.createTemplate({ name: "New Template" })

      expect(apiClient.post).toHaveBeenCalledWith("/food/templates/", {
        name: "New Template",
      })
      expect(result).toEqual(mockTemplate)
    })

    it("should update template", async () => {
      const mockTemplate = { id: 1, name: "Updated" }
      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockTemplate })

      const result = await foodApi.updateTemplate(1, { name: "Updated" })

      expect(apiClient.patch).toHaveBeenCalledWith("/food/templates/1/", {
        name: "Updated",
      })
      expect(result).toEqual(mockTemplate)
    })

    it("should delete template", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await foodApi.deleteTemplate(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/food/templates/1/")
    })
  })

  describe("Weekly Menus", () => {
    it("should fetch weekly menus", async () => {
      const mockMenus = [{ id: 1, week_start_date: "2025-01-13" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMenus })

      const result = await foodApi.getWeeklyMenus()

      expect(apiClient.get).toHaveBeenCalledWith("/food/menus/")
      expect(result).toEqual(mockMenus)
    })

    it("should fetch current week menu", async () => {
      const mockMenu = { id: 1, week_start_date: "2025-01-13" }
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMenu })

      const result = await foodApi.getCurrentWeekMenu()

      expect(apiClient.get).toHaveBeenCalledWith("/food/menus/current/")
      expect(result).toEqual(mockMenu)
    })

    it("should create weekly menu", async () => {
      const mockMenu = { id: 1, week_start_date: "2025-01-20" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockMenu })

      const result = await foodApi.createWeeklyMenu("2025-01-20")

      expect(apiClient.post).toHaveBeenCalledWith("/food/menus/", {
        week_start_date: "2025-01-20",
      })
      expect(result).toEqual(mockMenu)
    })
  })

  describe("Meal Registrations", () => {
    it("should fetch registrations", async () => {
      const mockRegistrations = [{ id: 1, date: "2025-01-13" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockRegistrations })

      const result = await foodApi.getRegistrations("2025-01-13")

      expect(apiClient.get).toHaveBeenCalledWith("/food/registrations/", {
        params: { week_start: "2025-01-13" },
      })
      expect(result).toEqual(mockRegistrations)
    })

    it("should create registration", async () => {
      const mockRegistration = { id: 1, date: "2025-01-13", adults_count: 2 }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockRegistration })

      const result = await foodApi.createRegistration({
        date: "2025-01-13",
        adults_count: 2,
        children_count: 0,
        meal_type: "meat",
        dining_option: "eat_in",
        seating_time: "17:30",
        house_id: null,
      })

      expect(apiClient.post).toHaveBeenCalled()
      expect(result).toEqual(mockRegistration)
    })
  })

  describe("Food Tickets", () => {
    it("should fetch available tickets", async () => {
      const mockTickets = [{ id: 1, date: "2025-01-15" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockTickets })

      const result = await foodApi.getTickets()

      expect(apiClient.get).toHaveBeenCalledWith("/food/tickets/", {
        params: {},
      })
      expect(result).toEqual(mockTickets)
    })

    it("should fetch my tickets", async () => {
      const mockTickets = [{ id: 1, date: "2025-01-15" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockTickets })

      const result = await foodApi.getMyTickets()

      expect(apiClient.get).toHaveBeenCalledWith("/food/tickets/my/")
      expect(result).toEqual(mockTickets)
    })

    it("should create ticket", async () => {
      const mockTicket = { id: 1, date: "2025-01-15", price: "50.00" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTicket })

      const result = await foodApi.createTicket({
        date: "2025-01-15",
        adults_count: 2,
        children_count: 0,
        meal_type: "meat",
        price: 50,
        description: "Test",
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        "/food/tickets/",
        expect.any(Object),
      )
      expect(result).toEqual(mockTicket)
    })

    it("should claim ticket", async () => {
      const mockTicket = { id: 1, is_available: false }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTicket })

      const result = await foodApi.claimTicket(1)

      expect(apiClient.post).toHaveBeenCalledWith("/food/tickets/1/claim/")
      expect(result).toEqual(mockTicket)
    })

    it("should release ticket", async () => {
      const mockTicket = { id: 1, is_available: true }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTicket })

      const result = await foodApi.releaseTicket(1)

      expect(apiClient.post).toHaveBeenCalledWith("/food/tickets/1/release/")
      expect(result).toEqual(mockTicket)
    })

    it("should delete ticket", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await foodApi.deleteTicket(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/food/tickets/1/")
    })
  })

  describe("Food Team Cycles", () => {
    it("should fetch cycles", async () => {
      const mockCycles = [{ id: 1, name: "January Cycle" }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockCycles })

      const result = await foodApi.getCycles()

      expect(apiClient.get).toHaveBeenCalledWith("/food/cycles/")
      expect(result).toEqual(mockCycles)
    })

    it("should create cycle", async () => {
      const mockCycle = { id: 1, name: "New Cycle" }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockCycle })

      const result = await foodApi.createCycle({
        name: "New Cycle",
        cooking_dates: ["2025-01-13", "2025-01-14"],
        wish_deadline: "2025-01-10T18:00:00Z",
      })

      expect(apiClient.post).toHaveBeenCalled()
      expect(result).toEqual(mockCycle)
    })
  })

  describe("Default Cooking Days", () => {
    it("should fetch default cooking days", async () => {
      const mockData = { default_cooking_days: [0, 1, 2] }
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })

      const result = await foodApi.getDefaultCookingDays()

      expect(apiClient.get).toHaveBeenCalledWith("/food/default-cooking-days/")
      expect(result).toEqual(mockData)
    })

    it("should update default cooking days", async () => {
      const mockData = { default_cooking_days: [0, 2, 3] }
      vi.mocked(apiClient.put).mockResolvedValue({ data: mockData })

      const result = await foodApi.updateDefaultCookingDays([0, 2, 3])

      expect(apiClient.put).toHaveBeenCalledWith(
        "/food/default-cooking-days/",
        {
          default_cooking_days: [0, 2, 3],
        },
      )
      expect(result).toEqual(mockData)
    })
  })

  describe("Monthly Food Cost", () => {
    it("should fetch monthly food cost report", async () => {
      const mockReport = {
        year: 2025,
        month: 1,
        month_name: "January",
        total_cost: "500.00",
        houses: [],
      }
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockReport })

      const result = await foodApi.getMonthlyFoodCost(2025, 1)

      expect(apiClient.get).toHaveBeenCalledWith("/food/admin/monthly-cost/", {
        params: { year: 2025, month: 1 },
      })
      expect(result).toEqual(mockReport)
    })
  })
})
