import { useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { useAuthStore } from "../store/authStore"
import { usersApi } from "../api/users"

const ATTR = "data-accessibility"

/** localStorage key used only as a pre-render cache to avoid FOUC. */
const CACHE_KEY = "accessibility-mode"

export function useAccessibilityMode() {
  const { user, updateUser } = useAuthStore()
  const isEnabled = user?.accessibility_mode ?? false

  // Keep the DOM attribute in sync with the user preference from the store.
  // Also update the localStorage cache so initAccessibilityMode() works on
  // the next page load before the API response arrives.
  useEffect(() => {
    if (isEnabled) {
      document.documentElement.setAttribute(ATTR, "on")
      localStorage.setItem(CACHE_KEY, "on")
    } else {
      document.documentElement.removeAttribute(ATTR)
      localStorage.setItem(CACHE_KEY, "off")
    }
  }, [isEnabled])

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
