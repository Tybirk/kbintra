import { describe, it, expect } from "vitest"

import {
  normalizeDecimalSeparator,
  parseDecimalInput,
  toDanishDecimal,
} from "./decimalInput"

describe("decimalInput", () => {
  it("accepts a Danish comma", () => {
    expect(normalizeDecimalSeparator("3,94")).toBe("3.94")
    expect(parseDecimalInput("3,94")).toBe(3.94)
  })

  it("accepts a dot just as well", () => {
    expect(normalizeDecimalSeparator("3.94")).toBe("3.94")
    expect(parseDecimalInput("3.94")).toBe(3.94)
  })

  it("ignores spaces phones like to insert", () => {
    expect(parseDecimalInput(" 12,50 ")).toBe(12.5)
  })

  it("treats the last separator as the decimal one", () => {
    expect(normalizeDecimalSeparator("1.234,56")).toBe("1234.56")
    expect(normalizeDecimalSeparator("1,234.56")).toBe("1234.56")
  })

  it("handles whole numbers and empty input", () => {
    expect(parseDecimalInput("40")).toBe(40)
    expect(parseDecimalInput("")).toBe(0)
    expect(parseDecimalInput("ikke et tal")).toBe(0)
  })

  it("shows stored values the Danish way", () => {
    expect(toDanishDecimal("3.20")).toBe("3,20")
    expect(toDanishDecimal(null)).toBe("")
    expect(toDanishDecimal("")).toBe("")
  })

  it("round-trips a rate through display and back", () => {
    expect(normalizeDecimalSeparator(toDanishDecimal("4.50"))).toBe("4.50")
  })
})
