import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useAuthStore } from "../store/authStore"

import { usersApi } from "../api/users"

export function useHideClosedThreads() {
  const { user, updateUser } = useAuthStore()

  const queryClient = useQueryClient()

  const isEnabled = user?.hide_closed_threads ?? false

  const mutation = useMutation({
    mutationFn: (value: boolean) =>
      usersApi.updateProfile({ hide_closed_threads: value }),

    onSuccess: (updatedUser) => {
      updateUser(updatedUser)

      queryClient.invalidateQueries({ queryKey: ["threads"] })
    },
  })

  return {
    hideClosedThreads: isEnabled,

    setHideClosedThreads: (value: boolean) => mutation.mutate(value),

    isPending: mutation.isPending,
  }
}
