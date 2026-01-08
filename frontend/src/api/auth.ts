/**
 * Authentication API functions
 */

import { apiClient, setTokens, clearTokens } from './client';
import type {
  AuthTokens,
  ChangePasswordData,
  ForgotPasswordData,
  LoginCredentials,
  RegisterData,
  ResetPasswordData,
  User,
} from '../types';

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthTokens> {
    const response = await apiClient.post<AuthTokens>('/auth/token/', credentials);
    setTokens(response.data.access, response.data.refresh);
    return response.data;
  },

  async register(data: RegisterData): Promise<{ message: string; user: User }> {
    const response = await apiClient.post<{ message: string; user: User }>(
      '/auth/register/',
      data
    );
    return response.data;
  },

  async validateInvitation(
    token: string
  ): Promise<{ valid: boolean; email: string; expires_at: string }> {
    const response = await apiClient.post<{
      valid: boolean;
      email: string;
      expires_at: string;
    }>('/auth/validate-invitation/', { token });
    return response.data;
  },

  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<User>('/users/me/');
    return response.data;
  },

  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>('/users/me/', data);
    return response.data;
  },

  async updateProfilePicture(file: File): Promise<User> {
    const formData = new FormData();
    formData.append('profile_picture', file);
    const response = await apiClient.patch<User>('/users/me/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  logout(): void {
    clearTokens();
  },

  async changePassword(data: ChangePasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>('/auth/change-password/', data);
    return response.data;
  },

  async forgotPassword(data: ForgotPasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>('/auth/forgot-password/', data);
    return response.data;
  },

  async resetPassword(data: ResetPasswordData): Promise<{ message: string }> {
    const response = await apiClient.post<{ message: string }>('/auth/reset-password/', data);
    return response.data;
  },
};
