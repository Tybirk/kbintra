/**
 * The unsaved state of one car card in "Mine biler".
 *
 * The card has a single save covering two endpoints — the car's own fields
 * (/houses/my/cars/) and its week schedule (/carsharing/cars/<id>/blocks/) — so
 * it has to know whether either actually differs from what the server holds, and
 * be able to say which. That rule is pure, so it lives here rather than inside
 * the card, and is tested without one.
 */

import { normalizeDecimalSeparator } from "../../utils/decimalInput"

import type { UpdateCarData } from "../../api/houses"

import type { Car } from "../../types"

/**
 * The fields "Mine biler" can change, exactly as the server takes them.
 *
 * Both the request body and the dirty check are built from this, so what a save
 * sends and what counts as a change cannot drift apart. Normalising the takst
 * here is part of that: "3,94" and "3.94" are the same rate and must not read as
 * an edit that keeps the save button lit forever.
 */
export function carPayload(car: Car): UpdateCarData {
  return {
    license_plate: car.license_plate.trim(),
    is_electric: car.is_electric,
    is_shared: car.is_shared,
    rate_per_km: car.rate_per_km
      ? normalizeDecimalSeparator(car.rate_per_km)
      : null,
    make: car.make,
    model_name: car.model_name,
    color: car.color,
    year: car.year,
    seats: car.seats,
    has_tow_hitch: car.has_tow_hitch,
    has_isofix: car.has_isofix,
    dogs_allowed: car.dogs_allowed,
    has_charge_fob: car.has_charge_fob,
    equipment_note: car.equipment_note,
    practical_note: car.practical_note,
  }
}

/**
 * Whether the draft holds anything the saved car does not.
 *
 * Compares the serialised payloads: one function builds both, so the key order
 * is identical by construction and there is no field list to keep in step.
 */
export function carDraftDirty(draft: Car, saved: Car): boolean {
  return JSON.stringify(carPayload(draft)) !== JSON.stringify(carPayload(saved))
}

/** Which halves of a car card are waiting to be saved. */
export interface UnsavedParts {
  car: boolean
  schedule: boolean
}

/**
 * What the save button is about to send, in words.
 *
 * The button sits below the week grid and covers everything above it, so a
 * household that only painted a week — or only changed the colour — should be
 * able to read what pressing it will do without scrolling back up.
 */
export function unsavedChangesHint({ car, schedule }: UnsavedParts): string {
  if (car && schedule) return "Bilens oplysninger og ugeskemaet er ændret."
  if (car) return "Bilens oplysninger er ændret."
  if (schedule) return "Ugeskemaet er ændret."
  return "Alt er gemt."
}
