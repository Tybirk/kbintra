/**
 * Houses API functions
 */

import { apiClient } from './client';
import type { House, PaginatedResponse } from '../types';

export const housesApi = {
  async getHouses(): Promise<PaginatedResponse<House>> {
    const response = await apiClient.get<PaginatedResponse<House>>('/houses/');
    return response.data;
  },

  async getHouse(id: number): Promise<House> {
    const response = await apiClient.get<House>(`/houses/${id}/`);
    return response.data;
  },
};
