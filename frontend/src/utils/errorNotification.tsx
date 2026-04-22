import { Text } from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { isAxiosError } from "axios"

import { useAuthStore } from "../store/authStore"

/** Extract a user-friendly error message from a DRF API error */

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) {
    // Surface JS error messages for admins

    if (error instanceof Error) return error.message

    return fallback
  }

  const data = error.response?.data

  if (!data) return fallback

  if (typeof data.detail === "string") return data.detail

  if (
    Array.isArray(data.non_field_errors) &&
    data.non_field_errors.length > 0
  ) {
    return data.non_field_errors.join(" ")
  }

  const fieldErrors: string[] = []

  for (const key of Object.keys(data)) {
    if (key === "non_field_errors" || key === "detail") continue

    const value = data[key]

    if (Array.isArray(value)) {
      fieldErrors.push(...value as string[])
    } else if (typeof value === "string") {
      fieldErrors.push(value)
    } else if (value && typeof value === "object") {
      // Nested serializer errors: recurse into nested object

      const nested = extractErrorMessage({ response: { data: value } }, "")

      if (nested) fieldErrors.push(nested)
    }
  }

  if (fieldErrors.length > 0) return fieldErrors.join(" ")

  return fallback
}

/** Show an error notification. Staff users also see HTTP status, URL, and response body. */

export function showErrorNotification(error: unknown, fallback: string): void {
  const user = useAuthStore.getState().user

  const message = extractErrorMessage(error, fallback)

  if (user?.is_staff) {
    let status: number | undefined

    let method: string | undefined

    let url: string | undefined

    let data: unknown

    if (isAxiosError(error)) {
      status = error.response?.status

      method = error.response?.config?.method

      url = error.response?.config?.url

      data = error.response?.data
    }

    const jsMessage =
      !isAxiosError(error) && error instanceof Error ? error.message : undefined

    notifications.show({
      title: "Fejl",

      message: (
        <>
          {message}
          <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: "monospace" }}>
            [{status ?? "?"}] {method?.toUpperCase() ?? "?"}{" "}
            {url ?? (jsMessage ? "(JS error)" : "?")}
          </Text>
          {data !== undefined && (
            <pre
              style={{
                fontFamily: "monospace",

                fontSize: 11,

                margin: "4px 0 0",

                whiteSpace: "pre-wrap",

                wordBreak: "break-all",

                maxHeight: 120,

                overflowY: "auto",

                opacity: 0.8,
              }}
            >
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </>
      ),

      color: "red",

      autoClose: false,
    })
  } else {
    notifications.show({
      title: "Fejl",

      message,

      color: "red",
    })
  }
}
