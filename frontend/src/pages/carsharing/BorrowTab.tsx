import { useEffect, useMemo, useState } from "react"

import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core"

import { DateTimePicker } from "@mantine/dates"

import { notifications } from "@mantine/notifications"

import { IconAlertTriangle, IconCar } from "@tabler/icons-react"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import dayjs from "dayjs"

import { carSharingApi } from "../../api/carsharing"

import { formatLicensePlate } from "../../utils/licensePlate"

import {
  conflictMeta,
  errorMessage,
  formatKr,
  TermsConsent,
  useCarSharingMutation,
  useCarSharingTerms,
} from "./shared"

import type { CarLoan, SharedCar } from "../../types"

// --- Tab 1: borrow a car -----------------------------------------------------

interface BorrowTabProps {
  onRequested: (loan: CarLoan) => void
}

export function BorrowTab({ onRequested }: BorrowTabProps) {
  const [start, setStart] = useState<Date | null>(() =>
    dayjs().add(1, "hour").startOf("hour").toDate(),
  )
  const [end, setEnd] = useState<Date | null>(() =>
    dayjs().add(3, "hour").startOf("hour").toDate(),
  )
  const [expectedKm, setExpectedKm] = useState<number | string>(20)
  const [needsIsofix, setNeedsIsofix] = useState(false)
  const [needsTowHitch, setNeedsTowHitch] = useState(false)
  const [minSeats, setMinSeats] = useState<number | string>("")
  const [note, setNote] = useState("")
  const [selected, setSelected] = useState<number[]>([])
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  // Learned from the server and remembered, so the limit is known even while a
  // too-long window is blocking the request that would report it.
  const [maxLoanDaysHint, setMaxLoanDaysHint] = useState(30)

  const windowValid = Boolean(start && end && dayjs(end).isAfter(dayjs(start)))
  // The server refuses a longer window; without mirroring it the request 400s and
  // the whole car list silently renders as "nobody here shares a car".
  const maxLoanDays = maxLoanDaysHint
  const windowTooLong = Boolean(
    windowValid && dayjs(end).diff(dayjs(start), "day") > maxLoanDays,
  )

  // Key off the exact strings sent to the server. Going through dayjs rather
  // than start.toISOString() also survives the date picker handing back a
  // string instead of a Date, which @mantine/dates 9.0-alpha is known to do.
  const startIso = windowValid ? dayjs(start).toISOString() : ""
  const endIso = windowValid ? dayjs(end).toISOString() : ""

  const { data: terms } = useCarSharingTerms()

  const {
    data: sharedCars,
    isLoading,
    isError,
    error: carsError,
  } = useQuery({
    queryKey: [
      "carsharing",
      "cars",
      startIso,
      endIso,
      needsIsofix,
      needsTowHitch,
      minSeats,
    ],
    queryFn: () =>
      carSharingApi.getSharedCars({
        start: startIso,
        end: endIso,
        isofix: needsIsofix,
        tow: needsTowHitch,
        seats: typeof minSeats === "number" ? minSeats : null,
      }),
    enabled: windowValid && !windowTooLong,
    // Keep the last good list on screen while the dates are being edited, so the
    // selection stays visible and the household count cannot read "0 husstande".
    placeholderData: keepPreviousData,
  })

  // Only used before the first response lands; the server is the real limit.
  const maxCandidates = sharedCars?.max_candidates ?? 10

  useEffect(() => {
    if (sharedCars?.max_loan_days) setMaxLoanDaysHint(sharedCars.max_loan_days)
  }, [sharedCars?.max_loan_days])

  // Households, not cars: two cars from the same house is one household asked.
  const householdCount = useMemo(() => {
    const cars = sharedCars?.cars ?? []
    const houses = new Set(
      cars
        .filter((car) => selected.includes(car.id))
        .map((car) => car.house_name),
    )
    return houses.size
  }, [sharedCars, selected])

  const requestMutation = useCarSharingMutation({
    mutationFn: () =>
      carSharingApi.requestLoan({
        start_at: dayjs(start).toISOString(),
        end_at: dayjs(end).toISOString(),
        expected_km:
          typeof expectedKm === "number" ? expectedKm : Number(expectedKm) || 0,
        car_ids: selected,
        needs_isofix: needsIsofix,
        needs_tow_hitch: needsTowHitch,
        min_seats: typeof minSeats === "number" ? minSeats : null,
        note,
        accepted_terms: acceptedTerms,
      }),
    successTitle: "Forespørgsel sendt",
    successMessage: `Du har spurgt ${householdCount} husstand${
      householdCount === 1 ? "" : "e"
    }.`,
    errorTitle: "Kunne ikke sende forespørgslen",
    onDone: (loan: CarLoan) => {
      setSelected([])
      setNote("")
      setAcceptedTerms(false)
      onRequested(loan)
    },
  })

  function toggleCar(car: SharedCar) {
    if (!car.selectable) return
    const alreadyPicked = selected.includes(car.id)
    // The toast belongs out here: inside the updater it made the reducer impure,
    // so it fired twice and logged a React "setState during render" error.
    if (!alreadyPicked && selected.length >= maxCandidates) {
      notifications.show({
        title: "Loft nået",
        message: `Du kan højst spørge ${maxCandidates} biler ad gangen — vælg de mest relevante.`,
        color: "yellow",
      })
      return
    }
    setSelected((current) =>
      current.includes(car.id)
        ? current.filter((id) => id !== car.id)
        : [...current, car.id],
    )
  }

  return (
    <Stack gap="md" mt="md">
      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Title order={4}>Hvornår har du brug for en bil?</Title>
          <Group grow align="flex-end" wrap="wrap">
            <DateTimePicker
              label="Fra"
              value={start}
              onChange={(value) => setStart(value ? new Date(value) : null)}
              valueFormat="D. MMM YYYY HH:mm"
              clearable={false}
            />
            <DateTimePicker
              label="Til"
              value={end}
              onChange={(value) => setEnd(value ? new Date(value) : null)}
              valueFormat="D. MMM YYYY HH:mm"
              clearable={false}
            />
          </Group>
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                setStart(dayjs().toDate())
                setEnd(dayjs().add(2, "hour").toDate())
              }}
            >
              Nu og de næste 2 timer
            </Button>
          </Group>
          {!windowValid && (
            <Text size="sm" c="red">
              Sluttidspunktet skal ligge efter starttidspunktet.
            </Text>
          )}
          {windowTooLong && (
            <Text size="sm" c="red">
              Et lån kan højst vare {maxLoanDays} dage.
            </Text>
          )}
          <NumberInput
            label="Forventede kilometer"
            value={expectedKm}
            onChange={setExpectedKm}
            min={1}
            max={100000}
          />
          <Group gap="md" wrap="wrap">
            <Checkbox
              label="Skal have isofix"
              checked={needsIsofix}
              onChange={(event) => setNeedsIsofix(event.currentTarget.checked)}
            />
            <Checkbox
              label="Skal have træk"
              checked={needsTowHitch}
              onChange={(event) =>
                setNeedsTowHitch(event.currentTarget.checked)
              }
            />
          </Group>
          <NumberInput
            label="Mindst antal pladser (valgfrit)"
            value={minSeats}
            onChange={setMinSeats}
            min={1}
            max={9}
          />
          <Textarea
            label="Andre behov (valgfrit)"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            autosize
            minRows={2}
          />
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Title order={4}>Biler i delebilparken</Title>
          <Text size="sm" c="dimmed">
            Ugeskemaet er kun vejledende. En bil der plejer at være væk, kan
            godt være fri netop nu — spørg endelig.
          </Text>
          {isLoading && (
            <Center py="md">
              <Loader size="sm" />
            </Center>
          )}
          {/* An unreported failure used to render as an empty park, which reads as
              "nobody in this community shares a car" — false, and alarming. */}
          {isError && (
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertTriangle size={18} />}
            >
              {errorMessage(carsError, "Kunne ikke hente delebilparken.")}
            </Alert>
          )}
          {windowTooLong && (
            <Text size="sm" c="dimmed">
              Ret tidsrummet for at se biler.
            </Text>
          )}
          {!isError && !windowTooLong && sharedCars?.cars.length === 0 && (
            <Text size="sm" c="dimmed">
              Der er ingen biler i delebilparken endnu.
            </Text>
          )}
          {sharedCars?.cars.map((car) => {
            const meta = conflictMeta(car.conflict)
            const isSelected = selected.includes(car.id)
            return (
              <Card
                key={car.id}
                // A label, so tapping anywhere on the card toggles the
                // checkbox — one native event, no double-toggle to guard
                // against, and the keyboard path keeps working.
                component="label"
                withBorder
                radius="sm"
                padding="sm"
                opacity={car.selectable ? 1 : 0.55}
                style={{
                  display: "block",
                  cursor: car.selectable ? "pointer" : "default",
                  borderColor: isSelected
                    ? "var(--mantine-color-blue-5)"
                    : undefined,
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Group gap="xs" wrap="wrap">
                      <Text fw={600}>{car.display_name}</Text>
                      <Text size="sm" c="dimmed">
                        {car.house_name}
                      </Text>
                      {car.license_plate &&
                        car.display_name !==
                          formatLicensePlate(car.license_plate) && (
                          <Badge variant="default" size="sm">
                            {formatLicensePlate(car.license_plate)}
                          </Badge>
                        )}
                      {meta && (
                        <Badge color={meta.color} variant="light" size="sm">
                          {meta.label}
                        </Badge>
                      )}
                      {!car.meets_requirements && (
                        <Badge color="orange" variant="light" size="sm">
                          Opfylder ikke dine krav
                        </Badge>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {[
                        car.seats ? `${car.seats} pladser` : null,
                        car.is_electric ? "Elbil" : null,
                        car.has_isofix ? "Isofix" : null,
                        car.has_tow_hitch ? "Træk" : null,
                        car.dogs_allowed ? "Hunde tilladt" : null,
                        `${formatKr(car.effective_rate_per_km)}/km`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {car.conflict_note && (
                      <Text size="xs" c="dimmed">
                        {car.conflict_note}
                      </Text>
                    )}
                  </Stack>
                  <Checkbox
                    checked={isSelected}
                    disabled={!car.selectable}
                    onChange={() => toggleCar(car)}
                    aria-label={`Vælg ${car.display_name}`}
                  />
                </Group>
              </Card>
            )
          })}
        </Stack>
      </Card>

      {terms && (
        <TermsConsent
          collapsible
          terms={terms}
          label="Jeg har læst og accepterer vilkårene"
          checked={acceptedTerms}
          onChange={setAcceptedTerms}
        />
      )}

      <Card
        withBorder
        radius="md"
        padding="md"
        // Sticky rather than a phone-only variant: one code path, and on a short
        // desktop page it simply never detaches.
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 2,
          background: "var(--mantine-color-body)",
        }}
      >
        <Stack gap="sm">
          <Text size="sm">
            {selected.length === 0
              ? "Vælg mindst én bil."
              : `Du spørger ${householdCount} husstand${
                  householdCount === 1 ? "" : "e"
                } om ${selected.length} af højst ${maxCandidates} biler.`}
          </Text>
          <Text size="xs" c="dimmed">
            Den første ejer der siger ja, låner dig bilen — så vælg kun biler du
            gerne vil låne.
          </Text>
          {!acceptedTerms && (
            <Text size="xs" c="dimmed">
              Bekræft vilkårene ovenfor for at sende forespørgslen.
            </Text>
          )}
          <Button
            leftSection={<IconCar size={18} />}
            disabled={
              selected.length === 0 ||
              !windowValid ||
              windowTooLong ||
              !acceptedTerms
            }
            loading={requestMutation.isPending}
            onClick={() => requestMutation.mutate(undefined)}
          >
            Send forespørgsel
          </Button>
        </Stack>
      </Card>
    </Stack>
  )
}
