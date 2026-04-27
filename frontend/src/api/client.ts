/**
 * Axios API client with JWT authentication
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios"

import { notifications } from "@mantine/notifications"

const API_BASE_URL = "/api"

// Show at most one "deploy in progress" toast every 30 seconds, even if many
// requests fail in a burst. The toast itself auto-dismisses after 5s — the
// throttle is so a page that fires 8 queries on mount doesn't stack 8 toasts.
const MAINTENANCE_TOAST_THROTTLE_MS = 30_000

let lastMaintenanceToastAt = 0

const showMaintenanceToast = () => {
  const now = Date.now()
  if (now - lastMaintenanceToastAt < MAINTENANCE_TOAST_THROTTLE_MS) return
  lastMaintenanceToastAt = now
  notifications.show({
    id: "kbintra-maintenance",
    color: "yellow",
    title: "KB Intra opdateres",
    message: "KB Intra bliver lige opdateret. Prøv igen om et øjeblik.",
    autoClose: 5000,
  })
}

// True for the failure modes that look like "backend/proxy is briefly down"
// rather than an application error: 502/503/504 from a proxy, or no response
// at all (network error, timeout, DNS failure). Cancelled requests (e.g. the
// user navigated away) are not maintenance errors.
const isMaintenanceError = (error: AxiosError): boolean => {
  if (axios.isCancel(error) || error.code === "ERR_CANCELED") return false
  if (!error.response) return true
  const status = error.response.status
  return status === 502 || status === 503 || status === 504
}

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

    if (isMaintenanceError(error)) {
      showMaintenanceToast()
    }

    return Promise.reject(error)
  },
)
