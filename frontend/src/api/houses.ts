/**
 * Houses API functions
 */

import { apiClient } from './client';
import type { Child, House } from '../types';

export interface UpdateHouseData {
  description?: string;
}

export interface CreateChildData {
  name: string;
  birthdate?: string | null;
}

export interface UpdateChildData {
  name?: string;
  birthdate?: string | null;
}

export const housesApi = {
  async getHouses(): Promise<House[]> {
    const response = await apiClient.get<House[]>('/houses/');
    return response.data;
  },

  async getHouse(id: number): Promise<House> {
    const response = await apiClient.get<House>(`/houses/${id}/`);
    return response.data;
  },

  async getMyHouse(): Promise<House> {
    const response = await apiClient.get<House>('/houses/my/');
    return response.data;
  },

  async updateMyHouse(data: UpdateHouseData): Promise<House> {
    const response = await apiClient.patch<House>('/houses/my/', data);
    return response.data;
  },

  async updateMyHousePicture(file: File): Promise<House> {
    const formData = new FormData();
    formData.append('profile_picture', file);
    const response = await apiClient.patch<House>('/houses/my/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async getChildren(): Promise<Child[]> {
    const response = await apiClient.get<Child[]>('/houses/my/children/');
    return response.data;
  },

  async createChild(data: CreateChildData): Promise<Child> {
    const response = await apiClient.post<Child>('/houses/my/children/', data);
    return response.data;
  },

  async updateChild(id: number, data: UpdateChildData): Promise<Child> {
    const response = await apiClient.patch<Child>(`/houses/my/children/${id}/`, data);
    return response.data;
  },

  async deleteChild(id: number): Promise<void> {
    await apiClient.delete(`/houses/my/children/${id}/`);
  },
};
