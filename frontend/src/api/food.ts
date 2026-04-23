/**
 * Food API functions
 */

import { apiClient } from "./client"

import type {
  MealPreference,
  CreateMealPreferenceData,
  MealRegistration,
  CreateMealRegistrationData,
  FoodTicket,
  CreateFoodTicketData,
  ClaimFoodTicketData,
  ClosedFoodDay,
  DailyRegistrationStats,
  WeeklyRegistrationStats,
  FoodTeam,
  FoodTeamListItem,
  TeamSwapRequest,
  CreateSwapRequestData,
  RespondSwapRequestData,
  FoodTeamCycle,
  CreateCycleData,
  FoodTeamWish,
  CreateWishData,
  TeamGenerationResult,
  DriveMenu,
} from "../types"

export interface ExpenseDay {
  date: string

  day_name: string

  adults_meat: number

  adults_veg: number

  children_count: number

  cost: string
}

export interface ExpenseWeek {
  year: number

  week_number: number

  week_start: string

  week_end: string

  total_cost: string

  days: ExpenseDay[]
}

export interface ExpenseTicket {
  id: number

  date: string

  direction: "sold" | "bought"

  adults_meat: number

  adults_veg: number

  children_count: number

  price: string | null

  counterparty_house: string
}

export interface MyFoodExpensesResponse {
  start_date: string

  end_date: string

  house_name: string

  total_cost: string

  weeks: ExpenseWeek[]

  tickets: ExpenseTicket[]
}

export interface HouseFoodCost {
  house_id: number

  house_name: string

  total_cost: string

  registration_count: number

  adult_meat_portions: number

  adult_veg_portions: number

  child_portions: number
}

export interface FoodCostReportResponse {
  start_date: string

  end_date: string

  total_cost: string

  houses: HouseFoodCost[]
}

export const foodApi = {
  // Meal Preferences

  getPreferences: async (): Promise<MealPreference[]> => {
    const response = await apiClient.get("/food/preferences/")

    return response.data.results ?? response.data
  },

  createPreference: async (
    data: CreateMealPreferenceData,
  ): Promise<MealPreference> => {
    const response = await apiClient.post("/food/preferences/", data)

    return response.data
  },

  updatePreference: async (
    id: number,

    data: Partial<CreateMealPreferenceData>,
  ): Promise<MealPreference> => {
    const response = await apiClient.patch(`/food/preferences/${id}/`, data)

    return response.data
  },

  deletePreference: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/preferences/${id}/`)
  },

  // Meal Registrations

  getRegistrations: async (weekStart?: string): Promise<MealRegistration[]> => {
    const params = weekStart ? { week_start: weekStart } : {}

    const response = await apiClient.get("/food/registrations/", { params })

    return response.data.results ?? response.data
  },

  createRegistration: async (
    data: CreateMealRegistrationData,
  ): Promise<MealRegistration> => {
    const response = await apiClient.post("/food/registrations/", data)

    return response.data
  },

  updateRegistration: async (
    id: number,

    data: Partial<CreateMealRegistrationData>,
  ): Promise<MealRegistration> => {
    const response = await apiClient.patch(`/food/registrations/${id}/`, data)

    return response.data
  },

  deleteRegistration: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/registrations/${id}/`)
  },

  getRegistrationStats: async (
    weekStart: string,
  ): Promise<WeeklyRegistrationStats> => {
    const response = await apiClient.get("/food/registrations/stats/", {
      params: { week_start: weekStart },
    })

    return response.data
  },

  getDailyStats: async (date: string): Promise<DailyRegistrationStats> => {
    const response = await apiClient.get("/food/registrations/stats/", {
      params: { date },
    })

    return response.data
  },

  // Food Tickets

  getTickets: async (showAll = false): Promise<FoodTicket[]> => {
    const params = showAll ? { all: "true" } : {}

    const response = await apiClient.get("/food/tickets/", { params })

    return response.data.results ?? response.data
  },

  getMyTickets: async (): Promise<FoodTicket[]> => {
    const response = await apiClient.get("/food/tickets/my/")

    return response.data.results ?? response.data
  },

  getTicket: async (id: number): Promise<FoodTicket> => {
    const response = await apiClient.get(`/food/tickets/${id}/`)

    return response.data
  },

  createTicket: async (data: CreateFoodTicketData): Promise<FoodTicket> => {
    const response = await apiClient.post("/food/tickets/", data)

    return response.data
  },

  deleteTicket: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/tickets/${id}/`)
  },

  claimTicket: async (
    id: number,

    data?: ClaimFoodTicketData,
  ): Promise<FoodTicket> => {
    const response = await apiClient.post(
      `/food/tickets/${id}/claim/`,

      data ?? {},
    )

    return response.data
  },

  releaseTicket: async (id: number): Promise<FoodTicket> => {
    const response = await apiClient.post(`/food/tickets/${id}/release/`)

    return response.data
  },

  // Food Teams

  getTeams: async (
    fromDate?: string,

    toDate?: string,
  ): Promise<FoodTeamListItem[]> => {
    const params: Record<string, string> = {}

    if (fromDate) params.from_date = fromDate

    if (toDate) params.to_date = toDate

    const response = await apiClient.get("/food/teams/", { params })

    return response.data.results ?? response.data
  },

  getMyTeams: async (): Promise<FoodTeam[]> => {
    const response = await apiClient.get("/food/teams/my/")

    return response.data.results ?? response.data
  },

  getTeam: async (id: number): Promise<FoodTeam> => {
    const response = await apiClient.get(`/food/teams/${id}/`)

    return response.data
  },

  // Swap Requests

  getSwapRequests: async (): Promise<TeamSwapRequest[]> => {
    const response = await apiClient.get("/food/swap-requests/")

    return response.data.results ?? response.data
  },

  createSwapRequest: async (
    data: CreateSwapRequestData,
  ): Promise<TeamSwapRequest> => {
    const response = await apiClient.post("/food/swap-requests/", data)

    return response.data
  },

  cancelSwapRequest: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/swap-requests/${id}/`)
  },

  respondSwapRequest: async (
    id: number,

    data: RespondSwapRequestData,
  ): Promise<TeamSwapRequest> => {
    const response = await apiClient.post(
      `/food/swap-requests/${id}/respond/`,

      data,
    )

    return response.data
  },

  // Food Team Cycles

  getCycles: async (): Promise<FoodTeamCycle[]> => {
    const response = await apiClient.get("/food/cycles/")

    return response.data.results ?? response.data
  },

  getActiveCycle: async (): Promise<FoodTeamCycle> => {
    const response = await apiClient.get("/food/cycles/active/")

    return response.data
  },

  getCycle: async (id: number): Promise<FoodTeamCycle> => {
    const response = await apiClient.get(`/food/cycles/${id}/`)

    return response.data
  },

  createCycle: async (data: CreateCycleData): Promise<FoodTeamCycle> => {
    const response = await apiClient.post("/food/cycles/", data)

    return response.data
  },

  updateCycle: async (
    id: number,

    data: Partial<CreateCycleData>,
  ): Promise<FoodTeamCycle> => {
    const response = await apiClient.patch(`/food/cycles/${id}/`, data)

    return response.data
  },

  // Food Team Wishes

  getMyWish: async (cycleId: number): Promise<FoodTeamWish> => {
    const response = await apiClient.get(`/food/cycles/${cycleId}/my-wish/`)

    return response.data
  },

  submitWish: async (
    cycleId: number,

    data: CreateWishData,
  ): Promise<FoodTeamWish> => {
    const response = await apiClient.post(
      `/food/cycles/${cycleId}/my-wish/`,

      data,
    )

    return response.data
  },

  getCycleWishes: async (cycleId: number): Promise<FoodTeamWish[]> => {
    const response = await apiClient.get(`/food/cycles/${cycleId}/wishes/`)

    return response.data.results ?? response.data
  },

  // Team Generation

  generateTeams: async (
    cycleId: number,

    dryRun = false,
  ): Promise<TeamGenerationResult> => {
    const response = await apiClient.post("/food/generate-teams/", {
      cycle_id: cycleId,

      dry_run: dryRun,
    })

    return response.data
  },

  // Default Cooking Days

  getDefaultCookingDays: async (): Promise<{
    default_cooking_days: number[]
  }> => {
    const response = await apiClient.get("/food/default-cooking-days/")

    return response.data
  },

  updateDefaultCookingDays: async (days: number[]): Promise<{
    default_cooking_days: number[]
  }> => {
    const response = await apiClient.put("/food/default-cooking-days/", {
      default_cooking_days: days,
    })

    return response.data
  },

  // My Expenses (weekly buckets)

  getMyExpenses: async (
    startDate?: string,

    endDate?: string,
  ): Promise<MyFoodExpensesResponse> => {
    const params: Record<string, string> = {}

    if (startDate) params.start_date = startDate

    if (endDate) params.end_date = endDate

    const response = await apiClient.get("/food/my-expenses/", { params })

    return response.data
  },

  // Admin Reports

  getMonthlyFoodCost: async (
    startDate?: string,

    endDate?: string,
  ): Promise<FoodCostReportResponse> => {
    const params: Record<string, string> = {}

    if (startDate) params.start_date = startDate

    if (endDate) params.end_date = endDate

    const response = await apiClient.get("/food/admin/monthly-cost/", {
      params,
    })

    return response.data
  },

  downloadMonthlyFoodCostCsv: async (
    startDate?: string,

    endDate?: string,
  ): Promise<Blob> => {
    const params: Record<string, string> = { download: "csv" }

    if (startDate) params.start_date = startDate

    if (endDate) params.end_date = endDate

    const response = await apiClient.get("/food/admin/monthly-cost/", {
      params,

      responseType: "blob",
    })

    return response.data
  },

  // Drive Menu (from Google Drive)

  getDriveMenu: async (week?: number, year?: number): Promise<DriveMenu> => {
    const params: Record<string, number> = {}

    if (week !== undefined) params.week = week

    if (year !== undefined) params.year = year

    const response = await apiClient.get("/food/drive-menu/", { params })

    return response.data
  },

  refreshDriveMenu: async (
    week?: number,

    year?: number,
  ): Promise<DriveMenu> => {
    const data: Record<string, number> = {}

    if (week !== undefined) data.week = week

    if (year !== undefined) data.year = year

    const response = await apiClient.post("/food/drive-menu/", data)

    return response.data
  },

  refreshAllDriveMenus: async (): Promise<{
    detail: string

    updated: number

    failed: number
  }> => {
    const response = await apiClient.post("/food/drive-menu/refresh-all/")

    return response.data
  },

  // Closed Food Days

  getClosedDays: async (
    fromDate?: string,

    toDate?: string,
  ): Promise<ClosedFoodDay[]> => {
    const params: Record<string, string> = {}

    if (fromDate) params.from_date = fromDate

    if (toDate) params.to_date = toDate

    const response = await apiClient.get("/food/closed-days/", { params })

    return response.data
  },

  createClosedDays: async (data: {
    dates: string[]

    reason?: string
  }): Promise<ClosedFoodDay[]> => {
    const response = await apiClient.post("/food/closed-days/", data)

    return response.data
  },

  deleteClosedDay: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/closed-days/${id}/`)
  },
}
