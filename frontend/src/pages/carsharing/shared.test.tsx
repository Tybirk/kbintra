import { describe, it, expect } from "vitest"

import {
  errorMessage,
  formatDateTime,
  formatRatePerKm,
  formatWindow,
  moneyInputError,
  settlementBreakdown,
} from "./shared"

import type { CarLoan } from "../../types"

function axiosError(data: unknown) {
  return { response: { data } }
}

describe("errorMessage", () => {
  it("uses the server's Danish message when there is one", () => {
    expect(
      errorMessage(
        axiosError({
          detail: "Bilen kan ikke fjernes, fordi den har været lånt ud.",
        }),
        "fallback",
      ),
    ).toBe("Bilen kan ikke fjernes, fordi den har været lånt ud.")

    expect(
      errorMessage(
        axiosError({
          is_shared: ["En bil i delebilparken skal have en nummerplade."],
        }),
        "fallback",
      ),
    ).toBe("En bil i delebilparken skal have en nummerplade.")
  })

  it("passes a plain string body through", () => {
    expect(
      errorMessage(axiosError("Lånet er allerede afsluttet."), "fallback"),
    ).toBe("Lånet er allerede afsluttet.")
  })

  // An unhandled 5xx answers with a whole HTML page. Passing that through put
  // 77 kB of Django debug markup — model names, field names, stack frames —
  // into a toast on a resident's phone.
  it("never lets an HTML error page reach the toast", () => {
    const djangoDebugPage =
      '<!DOCTYPE html>\n<html lang="en">\n<head><title>ProtectedError at /api/houses/my/cars/98/</title>'
    expect(
      errorMessage(axiosError(djangoDebugPage), "Kunne ikke fjerne bilen."),
    ).toBe("Kunne ikke fjerne bilen.")

    expect(
      errorMessage(
        axiosError("<h1>Server Error (500)</h1>"),
        "Kunne ikke fjerne bilen.",
      ),
    ).toBe("Kunne ikke fjerne bilen.")

    // Leading whitespace is common in rendered templates.
    expect(errorMessage(axiosError("\n  <html>oops</html>"), "fallback")).toBe(
      "fallback",
    )
  })

  it("falls back when there is nothing usable", () => {
    expect(errorMessage(new Error("network"), "Prøv igen.")).toBe("Prøv igen.")
    expect(errorMessage(axiosError({}), "Prøv igen.")).toBe("Prøv igen.")
  })
})

describe("lending for free", () => {
  it("reads a zero rate as Gratis rather than 0,00 kr./km", () => {
    expect(formatRatePerKm("0.00")).toBe("Gratis")
    expect(formatRatePerKm(0)).toBe("Gratis")
    expect(formatRatePerKm("3.94")).toBe("3,94 kr./km")
  })

  it("accepts a rate of zero", () => {
    // An owner may lend their car for nothing; only a minus sign is wrong.
    expect(moneyInputError("0", "en takst")).toBeNull()
    expect(moneyInputError("0,00", "en takst")).toBeNull()
    expect(moneyInputError("-3,50", "en takst")).not.toBeNull()
  })
})

describe("settlementBreakdown", () => {
  function settled(overrides: Partial<CarLoan>) {
    return {
      actual_km: 55,
      rate_per_km: "3.94",
      expense_amount: "0",
      expense_note: "",
      ...overrides,
    } as CarLoan
  }

  it("explains an expense with the note the borrower wrote", () => {
    expect(
      settlementBreakdown(
        settled({
          expense_amount: "100.50",
          expense_note: "Ladning på Circle K",
        }),
      ),
    ).toBe("55 km × 3,94 kr. − 100,50 kr. i udgifter (Ladning på Circle K)")
  })

  // The note used to hang off "expenses > 0", so anything written against a
  // 0 kr. expense was stored and shown to nobody — least of all the owner.
  it("still shows a note that has no amount behind it", () => {
    expect(
      settlementBreakdown(settled({ expense_note: "Vaskede bilen" })),
    ).toContain("Udgifter: Vaskede bilen")
  })

  it("says nothing about expenses when there were none", () => {
    expect(settlementBreakdown(settled({}))).toBe("55 km × 3,94 kr.")
  })
})

// The weekday, not the exact rendering: asserting "lør. 12. juni" would only
// hold in a timezone, and the point of the change is the prefix.
const WEEKDAY = String.raw`(man|tir|ons|tor|fre|lør|søn)\.`

describe("dates lead with the weekday", () => {
  it("puts it in front of a single moment", () => {
    expect(formatDateTime("2027-06-12T09:00:00Z")).toMatch(
      new RegExp(String.raw`^${WEEKDAY} \d{1,2}\. \S+ \d{2}:\d{2}$`),
    )
  })

  it("puts it in front of a window, and of both ends when they differ", () => {
    expect(
      formatWindow("2027-06-12T09:00:00Z", "2027-06-12T14:00:00Z"),
    ).toMatch(
      new RegExp(
        String.raw`^${WEEKDAY} \d{1,2}\. \S+ 2027 \d{2}:\d{2}–\d{2}:\d{2}$`,
      ),
    )
    expect(
      formatWindow("2027-06-12T09:00:00Z", "2027-06-14T14:00:00Z"),
    ).toMatch(
      new RegExp(String.raw`^${WEEKDAY} .* til ${WEEKDAY} .*2027 \d{2}:\d{2}$`),
    )
  })
})
