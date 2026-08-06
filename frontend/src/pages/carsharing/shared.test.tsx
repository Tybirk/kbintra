import { describe, it, expect } from "vitest"

import { errorMessage, formatRatePerKm, moneyInputError } from "./shared"

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
