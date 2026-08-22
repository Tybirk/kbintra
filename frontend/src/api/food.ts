/**
 * Food API functions
 */

import { apiClient } from "./client"
import { asArray } from "./helpers"

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
  SuggestedCyclePlan,
  CreateCycleData,
  CycleResetPreview,
  CycleResetResult,
  FoodTeamWish,
  CreateWishData,
  TeamGenerationResult,
  DriveMenu,
  TeamFavour,
  FavourRepayOption,
  TakeoverData,
  SwapBroadcast,
  CreateSwapBroadcastData,
  TodayTeamActionBox,
  TodayTeamRecipes,
  WeekRecipes,
  TodayLeftoversPost,
  MyFoodProfile,
  FoodRosterEntry,
  FoodRoster,
  MealPrice,
  CreateMealPriceData,
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

    return asArray(response.data)
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

    return asArray(response.data)
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

    return asArray(response.data)
  },

  getMyTickets: async (): Promise<FoodTicket[]> => {
    const response = await apiClient.get("/food/tickets/my/")

    return asArray(response.data)
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

    return asArray(response.data)
  },

  getMyTeams: async (): Promise<FoodTeam[]> => {
    const response = await apiClient.get("/food/teams/my/")

    return asArray(response.data)
  },

  getTeam: async (id: number): Promise<FoodTeam> => {
    const response = await apiClient.get(`/food/teams/${id}/`)

    return response.data
  },

  // Swap Requests

  getSwapRequests: async (): Promise<TeamSwapRequest[]> => {
    const response = await apiClient.get("/food/swap-requests/")

    return asArray(response.data)
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

    return asArray(response.data)
  },

  getActiveCycle: async (): Promise<FoodTeamCycle> => {
    const response = await apiClient.get("/food/cycles/active/")

    return response.data
  },

  getSuggestedCyclePlan: async (): Promise<SuggestedCyclePlan> => {
    const response = await apiClient.get("/food/cycles/suggested/")

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

  /**
   * Preview what deleting a finalized cycle's teams would destroy, without
   * touching anything. Feeds the confirmation modal.
   */
  getCycleResetPreview: async (id: number): Promise<CycleResetPreview> => {
    const response = await apiClient.get(`/food/cycles/${id}/reset-teams/`)

    return response.data
  },

  /**
   * Delete a finalized cycle's teams and reopen it for wishes so it can be
   * regenerated. Refused by the backend once a cooking date has passed.
   */
  resetCycleTeams: async (id: number): Promise<CycleResetResult> => {
    const response = await apiClient.post(`/food/cycles/${id}/reset-teams/`)

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

    return asArray(response.data)
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

    const response = await apiClient.get("/food/drive-menu/", {
      params,
      skipConnectionToast: true,
    })

    return response.data
  },

  refreshDriveMenu: async (
    week?: number,

    year?: number,
  ): Promise<DriveMenu> => {
    const data: Record<string, number> = {}

    if (week !== undefined) data.week = week

    if (year !== undefined) data.year = year

    const response = await apiClient.post("/food/drive-menu/", data, {
      skipConnectionToast: true,
    })

    return response.data
  },

  refreshAllDriveMenus: async (): Promise<{
    detail: string

    updated: number

    failed: number
  }> => {
    const response = await apiClient.post(
      "/food/drive-menu/refresh-all/",
      undefined,
      {
        skipConnectionToast: true,
      },
    )

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

    return asArray(response.data)
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

  // Madhold launch: today action box, take-away/leftovers, takeover, broadcasts

  getTodayActionBox: async (): Promise<TodayTeamActionBox> => {
    const response = await apiClient.get("/food/teams/today/")

    return response.data
  },

  getTodayRecipes: async (): Promise<TodayTeamRecipes> => {
    const response = await apiClient.get("/food/teams/today/recipes/")

    return response.data
  },

  getWeekRecipes: async (
    week?: number,
    year?: number,
  ): Promise<WeekRecipes> => {
    const params: Record<string, number> = {}
    if (week != null) params.week = week
    if (year != null) params.year = year
    const response = await apiClient.get("/food/recipes/week/", { params })

    return response.data
  },

  getTodayLeftovers: async (): Promise<TodayLeftoversPost> => {
    const response = await apiClient.get("/food/leftovers/today/")

    return response.data
  },

  notifyTakeaway: async (teamId: number): Promise<{
    detail: string
    sent: boolean
  }> => {
    const response = await apiClient.post(
      `/food/teams/${teamId}/notify-takeaway/`,
    )

    return response.data
  },

  notifyLeftovers: async (
    teamId: number,
    message?: string,
    image?: File | null,
  ): Promise<{
    detail: string
    sent: boolean
  }> => {
    // Always send multipart with at least the `message` field. An empty
    // FormData breaks Axios's content-type detection, which is why the
    // no-image path used to fail.
    const formData = new FormData()

    formData.append("message", message ?? "")

    if (image) formData.append("image", image)

    const response = await apiClient.post(
      `/food/teams/${teamId}/notify-leftovers/`,
      formData,
    )

    return response.data
  },

  takeover: async (data: TakeoverData): Promise<TeamFavour> => {
    const response = await apiClient.post("/food/teams/takeover/", data)

    return response.data
  },

  getSwapBroadcasts: async (): Promise<SwapBroadcast[]> => {
    const response = await apiClient.get("/food/swap-broadcasts/")

    return asArray(response.data)
  },

  createSwapBroadcast: async (
    data: CreateSwapBroadcastData,
  ): Promise<SwapBroadcast & { candidate_count: number }> => {
    const response = await apiClient.post("/food/swap-broadcasts/", data)

    return response.data
  },

  acceptSwapBroadcast: async (
    id: number,
    membershipId: number,
  ): Promise<SwapBroadcast> => {
    const response = await apiClient.post(
      `/food/swap-broadcasts/${id}/accept/`,
      {
        membership_id: membershipId,
      },
    )

    return response.data
  },

  cancelSwapBroadcast: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/swap-broadcasts/${id}/`)
  },

  // Favours ("you owe me one")

  getFavours: async (): Promise<TeamFavour[]> => {
    const response = await apiClient.get("/food/favours/")

    return asArray(response.data)
  },

  settleFavour: async (id: number): Promise<TeamFavour> => {
    const response = await apiClient.post(`/food/favours/${id}/settle/`)

    return response.data
  },

  /** The creditor's upcoming maddage, which the debtor can take to settle up. */
  getFavourRepayOptions: async (id: number): Promise<FavourRepayOption[]> => {
    const response = await apiClient.get(`/food/favours/${id}/repay-options/`)

    return asArray(response.data)
  },

  // Personal food-team profile (self-service)

  getMyFoodProfile: async (): Promise<MyFoodProfile> => {
    const response = await apiClient.get("/food/my-food-profile/")

    return response.data
  },

  updateMyFoodProfile: async (
    data: Partial<MyFoodProfile>,
  ): Promise<MyFoodProfile> => {
    const response = await apiClient.patch("/food/my-food-profile/", data)

    return response.data
  },

  // Admin roster

  getFoodRoster: async (): Promise<FoodRoster> => {
    const response = await apiClient.get("/food/admin/roster/")

    return response.data
  },

  updateFoodRosterEntry: async (
    id: number,
    data: Partial<FoodRosterEntry>,
  ): Promise<FoodRosterEntry> => {
    const response = await apiClient.patch(`/food/admin/roster/${id}/`, data)

    return response.data
  },

  // Meal Prices

  getMealPrices: async (): Promise<MealPrice[]> => {
    const response = await apiClient.get("/food/prices/")

    return asArray(response.data)
  },

  createMealPrice: async (data: CreateMealPriceData): Promise<MealPrice> => {
    const response = await apiClient.post("/food/prices/", data)

    return response.data
  },

  updateMealPrice: async (
    id: number,

    data: Partial<CreateMealPriceData>,
  ): Promise<MealPrice> => {
    const response = await apiClient.patch(`/food/prices/${id}/`, data)

    return response.data
  },

  deleteMealPrice: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/prices/${id}/`)
  },
}
