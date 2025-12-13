/**
 * Food API functions
 */

import { apiClient } from './client';
import type {
  WeeklyMenu,
  DailyMenu,
  MealPreference,
  CreateMealPreferenceData,
  MealRegistration,
  CreateMealRegistrationData,
  FoodTicket,
  CreateFoodTicketData,
  MenuTemplate,
  CreateMenuTemplateData,
  UpdateDailyMenuData,
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
} from '../types';

export const foodApi = {
  // Menu Templates
  getTemplates: async (): Promise<MenuTemplate[]> => {
    const response = await apiClient.get('/food/templates/');
    return response.data.results ?? response.data;
  },

  getTemplate: async (id: number): Promise<MenuTemplate> => {
    const response = await apiClient.get(`/food/templates/${id}/`);
    return response.data;
  },

  createTemplate: async (data: CreateMenuTemplateData): Promise<MenuTemplate> => {
    const response = await apiClient.post('/food/templates/', data);
    return response.data;
  },

  updateTemplate: async (id: number, data: Partial<CreateMenuTemplateData>): Promise<MenuTemplate> => {
    const response = await apiClient.patch(`/food/templates/${id}/`, data);
    return response.data;
  },

  deleteTemplate: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/templates/${id}/`);
  },

  // Weekly Menus
  getWeeklyMenus: async (): Promise<WeeklyMenu[]> => {
    const response = await apiClient.get('/food/menus/');
    return response.data.results ?? response.data;
  },

  getCurrentWeekMenu: async (): Promise<WeeklyMenu> => {
    const response = await apiClient.get('/food/menus/current/');
    return response.data;
  },

  getWeeklyMenu: async (id: number): Promise<WeeklyMenu> => {
    const response = await apiClient.get(`/food/menus/${id}/`);
    return response.data;
  },

  createWeeklyMenu: async (weekStartDate: string): Promise<WeeklyMenu> => {
    const response = await apiClient.post('/food/menus/', { week_start_date: weekStartDate });
    return response.data;
  },

  updateDailyMenu: async (id: number, data: UpdateDailyMenuData): Promise<DailyMenu> => {
    const response = await apiClient.patch(`/food/menus/daily/${id}/`, data);
    return response.data;
  },

  // Meal Preferences
  getPreferences: async (): Promise<MealPreference[]> => {
    const response = await apiClient.get('/food/preferences/');
    return response.data.results ?? response.data;
  },

  createPreference: async (data: CreateMealPreferenceData): Promise<MealPreference> => {
    const response = await apiClient.post('/food/preferences/', data);
    return response.data;
  },

  updatePreference: async (id: number, data: Partial<CreateMealPreferenceData>): Promise<MealPreference> => {
    const response = await apiClient.patch(`/food/preferences/${id}/`, data);
    return response.data;
  },

  deletePreference: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/preferences/${id}/`);
  },

  // Meal Registrations
  getRegistrations: async (weekStart?: string): Promise<MealRegistration[]> => {
    const params = weekStart ? { week_start: weekStart } : {};
    const response = await apiClient.get('/food/registrations/', { params });
    return response.data.results ?? response.data;
  },

  createRegistration: async (data: CreateMealRegistrationData): Promise<MealRegistration> => {
    const response = await apiClient.post('/food/registrations/', data);
    return response.data;
  },

  updateRegistration: async (
    id: number,
    data: Partial<CreateMealRegistrationData>
  ): Promise<MealRegistration> => {
    const response = await apiClient.patch(`/food/registrations/${id}/`, data);
    return response.data;
  },

  deleteRegistration: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/registrations/${id}/`);
  },

  applyDefaults: async (weekStartDate: string): Promise<{ detail: string }> => {
    const response = await apiClient.post('/food/registrations/apply-defaults/', {
      week_start_date: weekStartDate,
    });
    return response.data;
  },

  getRegistrationStats: async (weekStart: string): Promise<WeeklyRegistrationStats> => {
    const response = await apiClient.get('/food/registrations/stats/', {
      params: { week_start: weekStart },
    });
    return response.data;
  },

  getDailyStats: async (date: string): Promise<DailyRegistrationStats> => {
    const response = await apiClient.get('/food/registrations/stats/', {
      params: { date },
    });
    return response.data;
  },

  // Food Tickets
  getTickets: async (showAll = false): Promise<FoodTicket[]> => {
    const params = showAll ? { all: 'true' } : {};
    const response = await apiClient.get('/food/tickets/', { params });
    return response.data.results ?? response.data;
  },

  getMyTickets: async (): Promise<FoodTicket[]> => {
    const response = await apiClient.get('/food/tickets/my/');
    return response.data.results ?? response.data;
  },

  getTicket: async (id: number): Promise<FoodTicket> => {
    const response = await apiClient.get(`/food/tickets/${id}/`);
    return response.data;
  },

  createTicket: async (data: CreateFoodTicketData): Promise<FoodTicket> => {
    const response = await apiClient.post('/food/tickets/', data);
    return response.data;
  },

  deleteTicket: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/tickets/${id}/`);
  },

  claimTicket: async (id: number): Promise<FoodTicket> => {
    const response = await apiClient.post(`/food/tickets/${id}/claim/`);
    return response.data;
  },

  releaseTicket: async (id: number): Promise<FoodTicket> => {
    const response = await apiClient.post(`/food/tickets/${id}/release/`);
    return response.data;
  },

  // Food Teams
  getTeams: async (fromDate?: string, toDate?: string): Promise<FoodTeamListItem[]> => {
    const params: Record<string, string> = {};
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    const response = await apiClient.get('/food/teams/', { params });
    return response.data.results ?? response.data;
  },

  getMyTeams: async (): Promise<FoodTeam[]> => {
    const response = await apiClient.get('/food/teams/my/');
    return response.data.results ?? response.data;
  },

  getTeam: async (id: number): Promise<FoodTeam> => {
    const response = await apiClient.get(`/food/teams/${id}/`);
    return response.data;
  },

  // Swap Requests
  getSwapRequests: async (): Promise<TeamSwapRequest[]> => {
    const response = await apiClient.get('/food/swap-requests/');
    return response.data.results ?? response.data;
  },

  createSwapRequest: async (data: CreateSwapRequestData): Promise<TeamSwapRequest> => {
    const response = await apiClient.post('/food/swap-requests/', data);
    return response.data;
  },

  cancelSwapRequest: async (id: number): Promise<void> => {
    await apiClient.delete(`/food/swap-requests/${id}/`);
  },

  respondSwapRequest: async (id: number, data: RespondSwapRequestData): Promise<TeamSwapRequest> => {
    const response = await apiClient.post(`/food/swap-requests/${id}/respond/`, data);
    return response.data;
  },

  // Food Team Cycles
  getCycles: async (): Promise<FoodTeamCycle[]> => {
    const response = await apiClient.get('/food/cycles/');
    return response.data.results ?? response.data;
  },

  getActiveCycle: async (): Promise<FoodTeamCycle> => {
    const response = await apiClient.get('/food/cycles/active/');
    return response.data;
  },

  getCycle: async (id: number): Promise<FoodTeamCycle> => {
    const response = await apiClient.get(`/food/cycles/${id}/`);
    return response.data;
  },

  createCycle: async (data: CreateCycleData): Promise<FoodTeamCycle> => {
    const response = await apiClient.post('/food/cycles/', data);
    return response.data;
  },

  updateCycle: async (id: number, data: Partial<CreateCycleData>): Promise<FoodTeamCycle> => {
    const response = await apiClient.patch(`/food/cycles/${id}/`, data);
    return response.data;
  },

  // Food Team Wishes
  getMyWish: async (cycleId: number): Promise<FoodTeamWish> => {
    const response = await apiClient.get(`/food/cycles/${cycleId}/my-wish/`);
    return response.data;
  },

  submitWish: async (cycleId: number, data: CreateWishData): Promise<FoodTeamWish> => {
    const response = await apiClient.post(`/food/cycles/${cycleId}/my-wish/`, data);
    return response.data;
  },

  getCycleWishes: async (cycleId: number): Promise<FoodTeamWish[]> => {
    const response = await apiClient.get(`/food/cycles/${cycleId}/wishes/`);
    return response.data.results ?? response.data;
  },

  // Team Generation
  generateTeams: async (cycleId: number, dryRun = false): Promise<TeamGenerationResult> => {
    const response = await apiClient.post('/food/generate-teams/', {
      cycle_id: cycleId,
      dry_run: dryRun,
    });
    return response.data;
  },
};
