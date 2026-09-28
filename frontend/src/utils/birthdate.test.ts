import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { ageInYears, formatBirthdateWithAge } from "./birthdate"

describe("formatBirthdateWithAge", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-01T12:00:00"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("writes the full date with the age in parentheses", () => {
    expect(formatBirthdateWithAge("1992-10-04")).toBe(
      "4. oktober 1992 (33\u00a0år)",
    )
  })

  it("has not counted a birthday that is still ahead this year", () => {
    // 4. oktober is a month away from the mocked today, so 1992 is 33, not 34.
    expect(formatBirthdateWithAge("1992-10-04")).toContain("(33\u00a0år)")
    // 26. juni has passed, so this one has had its birthday.
    expect(formatBirthdateWithAge("2024-06-26")).toBe(
      "26. juni 2024 (2\u00a0år)",
    )
  })

  it("says '1 år' rather than '1 års'", () => {
    expect(formatBirthdateWithAge("2025-06-26")).toBe(
      "26. juni 2025 (1\u00a0år)",
    )
  })

  it("returns null for a missing birthdate", () => {
    expect(formatBirthdateWithAge(null)).toBeNull()
    expect(formatBirthdateWithAge(undefined)).toBeNull()
    expect(formatBirthdateWithAge("")).toBeNull()
  })

  it("returns null rather than 'Invalid Date' for nonsense", () => {
    expect(formatBirthdateWithAge("ikke en dato")).toBeNull()
  })

  it("drops the age instead of printing a negative one", () => {
    expect(formatBirthdateWithAge("2030-01-15")).toBe("15. januar 2030")
  })

  it("gives day and month only for a birthday without a year", () => {
    expect(formatBirthdateWithAge("--10-04")).toBe("4. oktober")
    expect(formatBirthdateWithAge("--02-29")).toBe("29. februar")
  })
})

describe("ageInYears", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-01T12:00:00"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("counts whole years only", () => {
    expect(ageInYears("2024-06-26")).toBe(2)
    expect(ageInYears("2024-09-02")).toBe(1)
  })

  it("returns null when there is no date", () => {
    expect(ageInYears(null)).toBeNull()
  })

  it("returns null when the year is hidden", () => {
    expect(ageInYears("--06-26")).toBeNull()
  })
})
