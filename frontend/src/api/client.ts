/**
 * Axios API client with JWT authentication
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios"

const API_BASE_URL = "/api"

export const apiClient = axios.create({
  baseURL: API_BASE_URL,

  timeout: 15000,

  headers: {
    "Content-Type": "application/json",
  },
})

// Token management

const TOKEN_KEY = "kbintra_access_token"

const REFRESH_TOKEN_KEY = "kbintra_refresh_token"

export const getAccessToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY)
}

export const getRefreshToken = (): string | null => {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export const setTokens = (access: string, refresh: string): void => {
  localStorage.setItem(TOKEN_KEY, access)

  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

export const clearTokens = (): void => {
  localStorage.removeItem(TOKEN_KEY)

  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

// Request interceptor to add auth header

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken()

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // Let axios set the correct Content-Type (with boundary) for FormData

    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"]
    }

    return config
  },

  (error) => Promise.reject(error),
)

// Response interceptor to handle token refresh

type RefreshSubscriber = {
  resolve: (token: string) => void

  reject: (error: unknown) => void
}

let isRefreshing = false

let refreshSubscribers: RefreshSubscriber[] = []

const subscribeTokenRefresh = (
  resolve: (token: string) => void,

  reject: (error: unknown) => void,
) => {
  refreshSubscribers.push({ resolve, reject })
}

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((subscriber) => subscriber.resolve(token))

  refreshSubscribers = []
}

const onTokenRefreshFailed = (error: unknown) => {
  refreshSubscribers.forEach((subscriber) => subscriber.reject(error))

  refreshSubscribers = []
}

apiClient.interceptors.response.use(
  (response) => response,

  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    // If 401 and we haven't tried to refresh yet

    // Skip token refresh for login endpoint - it's expected to fail with 401 for bad credentials

    const isLoginRequest = originalRequest.url === "/auth/token/"

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isLoginRequest
    ) {
      if (isRefreshing) {
        // Wait for the token to be refreshed

        return new Promise((resolve, reject) => {
          subscribeTokenRefresh(
            (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`

              resolve(apiClient(originalRequest))
            },

            (refreshError: unknown) => {
              reject(refreshError)
            },
          )
        })
      }

      originalRequest._retry = true

      isRefreshing = true

      const refreshToken = getRefreshToken()

      if (!refreshToken) {
        isRefreshing = false

        onTokenRefreshFailed(error)

        clearTokens()

        window.location.href = "/login"

        return Promise.reject(error)
      }

      try {
        const response = await axios.post(
          `${API_BASE_URL}/auth/token/refresh/`,

          {
            refresh: refreshToken,
          },
        )

        const { access, refresh: newRefreshToken } = response.data

        setTokens(access, newRefreshToken ?? refreshToken)

        onTokenRefreshed(access)

        originalRequest.headers.Authorization = `Bearer ${access}`

        return apiClient(originalRequest)
      } catch (refreshError) {
        onTokenRefreshFailed(refreshError)

        clearTokens()

        window.location.href = "/login"

        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)
