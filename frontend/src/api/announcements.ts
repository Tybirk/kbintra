/**
 * Announcements API functions
 */

import { apiClient } from './client';
import type { Announcement, CreateAnnouncementData } from '../types';

export const announcementsApi = {
  getAnnouncements: async (includeInactive = false): Promise<Announcement[]> => {
    const params = includeInactive ? { is_active: 'false' } : {};
    const response = await apiClient.get('/announcements/', { params });
    // Handle paginated response
    return response.data.results ?? response.data;
  },

  getAnnouncement: async (id: number): Promise<Announcement> => {
    const response = await apiClient.get(`/announcements/${id}/`);
    return response.data;
  },

  createAnnouncement: async (data: CreateAnnouncementData): Promise<Announcement> => {
    const response = await apiClient.post('/announcements/', data);
    return response.data;
  },

  updateAnnouncement: async (
    id: number,
    data: Partial<CreateAnnouncementData>
  ): Promise<Announcement> => {
    const response = await apiClient.patch(`/announcements/${id}/`, data);
    return response.data;
  },

  deleteAnnouncement: async (id: number): Promise<void> => {
    await apiClient.delete(`/announcements/${id}/`);
  },
};
