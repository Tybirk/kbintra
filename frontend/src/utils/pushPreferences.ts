import type { NotificationPreference } from "../types"

/**
 * Whether any push toggle is on. Read off the preferences themselves: the two
 * hand-kept lists this replaced drifted from the backend (car sharing, then
 * reports, birthdays and the food reminders were missing), and a toggle added
 * later counts without anyone remembering to list it.
 */
export function anyPushEnabled(prefs: NotificationPreference): boolean {
  return Object.entries(prefs).some(
    ([key, value]) => key.startsWith("push_") && value === true,
  )
}
