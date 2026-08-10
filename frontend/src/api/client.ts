/**
 * Axios API client with JWT authentication
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios"

import { notifications } from "@mantine/notifications"
import * as Sentry from "@sentry/react"

declare module "axios" {
  interface AxiosRequestConfig {
    // Opt a known-slow request out of the "slow/lost connection" toast.
    // E.g. the Google Drive menu fetch/refresh is inherently slow and should
    // not raise a connectivity alarm when it takes a while.
    skipConnectionToast?: boolean
  }
}

const API_BASE_URL = "/api"

// Throttle each toast type independently — a page that fires 8 queries on mount
// shouldn't stack 8 identical toasts. The toast itself auto-dismisses after 5s.
const TOAST_THROTTLE_MS = 30_000

const lastToastAt: Record<string, number> = {}

// Connectivity toast gating: only alarm the user after several *consecutive*
// failures. A single transient blip on WiFi/mobile (AP roaming, tab resume,
// momentary packet loss) shouldn't raise a toast — but a sustained outage
// should. Any successful response resets the streak, so a page firing 8 queries
// where one blips and the rest succeed stays quiet.
const CONSECUTIVE_FAILURES_BEFORE_TOAST = 3

let consecutiveConnectionFailures = 0

const showThrottledToast = (
  id: string,
  title: string,
  message: string,
  color: string,
) => {
  const now = Date.now()
  if (now - (lastToastAt[id] ?? 0) < TOAST_THROTTLE_MS) return
  lastToastAt[id] = now
  notifications.show({ id, color, title, message, autoClose: 5000 })
}

type ErrorKind = "maintenance" | "offline" | "timeout" | "network" | "other"

// Distinguish the failure modes so we don't claim a deploy is happening every
// time the user's WiFi blips or an endpoint returns 503 for an app reason.
// Mapping:
//   - 502/503/504 from the *proxy* (Traefik) → "backend is restarting" (deploy)
//     Detected by the absence of a JSON body — Django always returns
//     application/json for app errors, while Traefik serves text/HTML for
//     proxy-level failures. This avoids false positives like a Django view
//     returning 503 for "feature not configured".
//   - navigator.onLine === false → device is offline (mobile/wifi dropped)
//   - axios timeout (30s) → request hung; usually flaky network or slow server
//   - any other no-response error → generic network error
//   - cancelled request → ignore (user navigated away)
const classifyError = (error: AxiosError): ErrorKind | null => {
  if (axios.isCancel(error) || error.code === "ERR_CANCELED") return null

  if (error.response) {
    const status = error.response.status
    if (status === 502 || status === 503 || status === 504) {
      const contentType = String(
        error.response.headers?.["content-type"] ?? "",
      ).toLowerCase()
      // Only treat as maintenance if the response did NOT come from Django
      // (i.e. it's from the proxy because Django was unreachable).
      if (!contentType.includes("application/json")) return "maintenance"
    }
    return "other"
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline"
  }
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return "timeout"
  }
  return "network"
}

const reportToast = (kind: ErrorKind) => {
  switch (kind) {
    case "maintenance":
      showThrottledToast(
        "kbintra-maintenance",
        "KB Intra opdateres",
        "KB Intra bliver lige opdateret. Prøv igen om et øjeblik.",
        "yellow",
      )
      return
    case "offline":
      showThrottledToast(
        "kbintra-offline",
        "Ingen internetforbindelse",
        "Tjek dit netværk og prøv igen.",
        "orange",
      )
      return
    case "timeout":
      showThrottledToast(
        "kbintra-timeout",
        "Forbindelsen er langsom",
        "Det tager længere end normalt at få svar. Prøv igen.",
        "orange",
      )
      return
    case "network":
      showThrottledToast(
        "kbintra-network",
        "Forbindelsesproblem",
        "Kunne ikke nå serveren. Tjek dit netværk og prøv igen.",
        "orange",
      )
      return
    case "other":
      return
  }
}

// Tag Sentry events so transient network/offline errors can be filtered out
// of the issue stream — they're not bugs in our code.
const tagSentry = (kind: ErrorKind, error: AxiosError) => {
  Sentry.withScope((scope) => {
    scope.setTag("api.error_kind", kind)
    scope.setTag(
      "navigator.online",
      typeof navigator !== "undefined" && navigator.onLine ? "true" : "false",
    )
    scope.setTag("api.url", error.config?.url ?? "unknown")
    if (kind === "offline" || kind === "network" || kind === "timeout") {
      scope.setLevel("info")
      Sentry.addBreadcrumb({
        category: "api.network",
        level: "info",
        message: `Network error (${kind}) on ${error.config?.url ?? "unknown"}`,
      })
    }
  })
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,

  timeout: 30000,

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
  (response) => {
    // A successful round-trip means connectivity is fine — clear the streak.
    consecutiveConnectionFailures = 0
    return response
  },

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

    const kind = classifyError(error)
    if (kind) {
      if (error.config?.skipConnectionToast) {
        // Known-slow request (e.g. Drive menu): never alarm, and don't let it
        // count toward the connectivity streak — a slow Drive fetch tells us
        // nothing about the user's network.
      } else if (kind === "maintenance") {
        // Reliable signal (proxy returned a non-JSON 5xx during a deploy) — no
        // need to wait for a streak.
        reportToast(kind)
      } else {
        consecutiveConnectionFailures += 1
        if (
          consecutiveConnectionFailures >= CONSECUTIVE_FAILURES_BEFORE_TOAST
        ) {
          reportToast(kind)
        }
      }
      tagSentry(kind, error)
    }

    return Promise.reject(error)
  },
)
