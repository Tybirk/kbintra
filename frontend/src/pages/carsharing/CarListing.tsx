import type { ReactNode } from "react"

import { Group, Stack, Text } from "@mantine/core"

import { formatLicensePlate } from "../../utils/licensePlate"

import { formatRatePerKm, LicensePlateBadge } from "./shared"

import type { SharedCar } from "../../types"

/** What a car's entry on the borrow list is drawn from. */
export interface CarListingFields
  extends Pick<SharedCar, "display_name" | "license_plate" | "house_name" | "seats" | "is_electric" | "has_isofix" | "has_tow_hitch" | "dogs_allowed" | "has_charge_fob" | "equipment_note"> {
  /** null while the community's default rate is still loading. */
  effective_rate_per_km: string | null
}

interface CarListingProps {
  car: CarListingFields
  /** Status badges after the name: availability for a borrower, sharing state
   *  for the owner. */
  badges?: ReactNode
  /** One dimmed line under the description, e.g. why the car looks busy. */
  footnote?: string
  /** The control on the right: the borrower's tick, the owner's fold-out. */
  trailing?: ReactNode
}

/**
 * A car as it appears on the borrow list.
 *
 * "Lån en bil" and "Mine biler" both draw it, so an owner sees their own car
 * exactly as the neighbours do — with the equipment note, the rate and every
 * yes/no fact — rather than trusting a form to say how it will come across.
 */
export function CarListing({
  car,
  badges,
  footnote,
  trailing,
}: CarListingProps) {
  const facts = [
    car.seats ? `${car.seats} sæder` : null,
    car.is_electric ? "Elbil" : null,
    car.has_isofix ? "Isofix" : null,
    car.has_tow_hitch ? "Træk" : null,
    car.dogs_allowed ? "Hunde tilladt" : null,
    car.has_charge_fob ? "Ladebrik" : null,
    car.effective_rate_per_km === null
      ? null
      : formatRatePerKm(car.effective_rate_per_km),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={2} style={{ flex: 1 }}>
        <Group gap="xs" wrap="wrap">
          <Text fw={600}>{car.display_name}</Text>
          <Text size="sm" c="dimmed">
            {car.house_name}
          </Text>
          {car.license_plate &&
            car.display_name !== formatLicensePlate(car.license_plate) && (
              <LicensePlateBadge plate={car.license_plate} />
            )}
          {badges}
        </Group>
        {facts && (
          <Text size="sm" c="dimmed">
            {facts}
          </Text>
        )}
        {car.equipment_note && (
          <Text size="xs" c="dimmed">
            {car.equipment_note}
          </Text>
        )}
        {footnote && (
          <Text size="xs" c="dimmed">
            {footnote}
          </Text>
        )}
      </Stack>
      {trailing}
    </Group>
  )
}
