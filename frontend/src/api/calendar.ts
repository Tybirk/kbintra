/**
 * Calendar API functions
 */

import { apiClient } from './client';
import type { CalendarEvent, CreateEventData, UpdateEventData } from '../types';

export const calendarApi = {
  // Get events with optional date range filter
  getEvents: async (start?: string, end?: string): Promise<CalendarEvent[]> => {
    const params: Record<string, string> = {};
    if (start) params.start = start;
    if (end) params.end = end;
    const response = await apiClient.get('/calendar/events/', { params });
    return response.data.results ?? response.data;
  },

  // Get upcoming events (for dashboard widget)
  getUpcomingEvents: async (): Promise<CalendarEvent[]> => {
    const response = await apiClient.get('/calendar/events/upcoming/');
    return response.data.results ?? response.data;
  },

  // Get single event
  getEvent: async (id: number): Promise<CalendarEvent> => {
    const response = await apiClient.get(`/calendar/events/${id}/`);
    return response.data;
  },

  // Create event
  createEvent: async (data: CreateEventData): Promise<CalendarEvent> => {
    const response = await apiClient.post('/calendar/events/', data);
    return response.data;
  },

  // Update event
  updateEvent: async (id: number, data: UpdateEventData): Promise<CalendarEvent> => {
    const response = await apiClient.patch(`/calendar/events/${id}/`, data);
    return response.data;
  },

  // Delete event
  deleteEvent: async (id: number): Promise<void> => {
    await apiClient.delete(`/calendar/events/${id}/`);
  },
};
