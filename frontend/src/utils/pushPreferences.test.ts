import { describe, it, expect } from "vitest"

import type { NotificationPreference } from "../types"

import { anyPushEnabled } from "./pushPreferences"

const prefs = (values: Record<string, boolean>) =>
  values as unknown as NotificationPreference

describe("anyPushEnabled", () => {
  it("counts a toggle no list ever named", () => {
    expect(anyPushEnabled(prefs({ push_birthdays: true }))).toBe(true)
  })

  it("ignores in-app and email toggles", () => {
    expect(
      anyPushEnabled(
        prefs({
          notify_messages: true,
          email_messages: true,
          push_messages: false,
        }),
      ),
    ).toBe(false)
  })
})
