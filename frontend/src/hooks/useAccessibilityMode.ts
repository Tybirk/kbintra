import { useEffect } from "react"

import { useMutation } from "@tanstack/react-query"

import { useAuthStore } from "../store/authStore"

import { usersApi } from "../api/users"

const ATTR = "data-accessibility"

/** localStorage key used only as a pre-render cache to avoid FOUC. */

const CACHE_KEY = "accessibility-mode"

/**
 * Sync the accessibility DOM attribute + localStorage cache from the logged-in
 * user's DB preference. Mount at App root so the setting applies on first
 * login even before the user visits Min profil.
 */
export function useAccessibilityModeSync() {
  const { user } = useAuthStore()

  const isEnabled = user?.accessibility_mode ?? false

  useEffect(() => {
    if (!user) return

    if (isEnabled) {
      document.documentElement.setAttribute(ATTR, "on")

      localStorage.setItem(CACHE_KEY, "on")
    } else {
      document.documentElement.removeAttribute(ATTR)

      localStorage.setItem(CACHE_KEY, "off")
    }
  }, [user, isEnabled])
}

export function useAccessibilityMode() {
  const { user, updateUser } = useAuthStore()

  const isEnabled = user?.accessibility_mode ?? false

  useAccessibilityModeSync()

  const mutation = useMutation({
    mutationFn: (value: boolean) =>
      usersApi.updateProfile({ accessibility_mode: value }),

    onSuccess: (updatedUser) => {
      updateUser(updatedUser)
    },

    onError: () => {
      // Re-sync DOM with the unchanged store value

      if (isEnabled) {
        document.documentElement.setAttribute(ATTR, "on")
      } else {
        document.documentElement.removeAttribute(ATTR)
      }
    },
  })

  return {
    isAccessibilityMode: isEnabled,

    setIsAccessibilityMode: (value: boolean) => mutation.mutate(value),

    isPending: mutation.isPending,
  }
}

/**
 * Call once before React renders to apply the cached preference immediately,
 * avoiding a flash of unstyled content. The definitive value comes from the
 * user profile once the app has loaded.
 */

export function initAccessibilityMode() {
  if (localStorage.getItem(CACHE_KEY) === "on") {
    document.documentElement.setAttribute(ATTR, "on")
  }
}
