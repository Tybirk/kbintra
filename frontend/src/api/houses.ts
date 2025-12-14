/**
 * Houses API functions
 */

import { apiClient } from './client';
import type { House } from '../types';

export const housesApi = {
  async getHouses(): Promise<House[]> {
    const response = await apiClient.get<House[]>('/houses/');
    return response.data;
  },

  async getHouse(id: number): Promise<House> {
    const response = await apiClient.get<House>(`/houses/${id}/`);
    return response.data;
  },
};
