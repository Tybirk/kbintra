import { describe, expect, it } from "vitest"

import { carDraftDirty, carPayload, unsavedChangesHint } from "./carDraft"

import type { Car } from "../../types"

function makeCar(overrides: Partial<Car> = {}): Car {
  return {
    id: 1,
    license_plate: "AB12345",
    is_electric: true,
    display_name: "Tesla 3",
    is_shared: true,
    rate_per_km: null,
    make: "Tesla",
    model_name: "3",
    color: "Hvid",
    year: 2021,
    seats: 5,
    has_tow_hitch: false,
    has_isofix: false,
    dogs_allowed: false,
    has_charge_fob: true,
    equipment_note: "1 autostol",
    practical_note: "",
    terms_accepted_version: "2026-08-05",
    has_accepted_current_terms: true,
    ...overrides,
  }
}

describe("carPayload", () => {
  it("sends the takst with a dot, whichever separator was typed", () => {
    expect(carPayload(makeCar({ rate_per_km: "4,50" })).rate_per_km).toBe(
      "4.50",
    )
    expect(carPayload(makeCar({ rate_per_km: "4.50" })).rate_per_km).toBe(
      "4.50",
    )
  })

  it("clears an empty takst rather than sending a blank string", () => {
    // Empty means "use the community rate", which the server expresses as null.
    expect(carPayload(makeCar({ rate_per_km: "" })).rate_per_km).toBeNull()
  })
})

describe("carDraftDirty", () => {
  it("is false when nothing was touched", () => {
    expect(carDraftDirty(makeCar(), makeCar())).toBe(false)
  })

  it("notices every kind of edit the card allows", () => {
    const saved = makeCar()
    expect(carDraftDirty(makeCar({ color: "Sort" }), saved)).toBe(true)
    expect(carDraftDirty(makeCar({ seats: 7 }), saved)).toBe(true)
    expect(carDraftDirty(makeCar({ is_shared: false }), saved)).toBe(true)
    expect(carDraftDirty(makeCar({ has_isofix: true }), saved)).toBe(true)
    expect(
      carDraftDirty(
        makeCar({ practical_note: "Nøglen hænger i entréen" }),
        saved,
      ),
    ).toBe(true)
  })

  // The whole point of the dirty check is that the save button goes quiet again
  // afterwards. Anything the payload normalises must therefore not count as an
  // edit, or the button stays lit and the card claims unsaved work forever.
  it("ignores differences the payload normalises away", () => {
    expect(
      carDraftDirty(
        makeCar({ rate_per_km: "4,50" }),
        makeCar({ rate_per_km: "4.50" }),
      ),
    ).toBe(false)
    expect(
      carDraftDirty(
        makeCar({ license_plate: " AB12345 " }),
        makeCar({ license_plate: "AB12345" }),
      ),
    ).toBe(false)
  })

  it("does not read a terms acceptance as a field edit", () => {
    // Accepting the terms is tracked beside the draft, not in it: the card must
    // be savable on the tick alone, and the tick alone changes no field.
    expect(
      carDraftDirty(
        makeCar({ has_accepted_current_terms: false }),
        makeCar({ has_accepted_current_terms: false }),
      ),
    ).toBe(false)
  })
})

describe("unsavedChangesHint", () => {
  it("names what a press would save", () => {
    expect(unsavedChangesHint({ car: true, schedule: true })).toBe(
      "Bilens oplysninger og ugeskemaet er ændret.",
    )
    expect(unsavedChangesHint({ car: true, schedule: false })).toBe(
      "Bilens oplysninger er ændret.",
    )
    expect(unsavedChangesHint({ car: false, schedule: true })).toBe(
      "Ugeskemaet er ændret.",
    )
  })

  it("reassures rather than going blank when there is nothing to save", () => {
    expect(unsavedChangesHint({ car: false, schedule: false })).toBe(
      "Alt er gemt.",
    )
  })
})
