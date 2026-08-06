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

import { useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { IconAlertTriangle, IconCar } from "@tabler/icons-react"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import dayjs from "dayjs"

import { carSharingApi } from "../../api/carsharing"

import { formatLicensePlate } from "../../utils/licensePlate"

import {
  conflictMeta,
  errorMessage,
  formatDateTime,
  formatRatePerKm,
  LONG_DATE_TIME,
  SHORT_DATE_TIME,
  TermsConsent,
  useCarSharingMutation,
  useCarSharingTerms,
} from "./shared"

import type { CarLoan, CarSharingTerms, SharedCar } from "../../types"

// --- Tab 1: borrow a car -----------------------------------------------------

interface BorrowTabProps {
  onRequested: (loan: CarLoan) => void
}

/**
 * What replaces the tick once a resident has accepted the terms.
 *
 * Says when, and says that the silence is deliberate — otherwise a form that
 * stops asking looks like a form that forgot to.
 */
function acceptedTermsNote(terms: CarSharingTerms): string {
  const when = terms.accepted_at ? ` ${formatDateTime(terms.accepted_at)}` : ""
  return `Du accepterede disse vilkår${when}, så du bliver ikke spurgt igen — først når vilkårene ændres.`
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

  // The picker is clipped at both edges on short phones, so it becomes a centred
  // modal there. Same hook and breakpoint as WeekHourGrid; undefined on the first
  // render, so the falsy branch has to be the desktop one.
  const narrow = useMediaQuery("(max-width: 48em)")

  const { data: terms } = useCarSharingTerms()
  // Consent belongs to a version of the terms, not to a single loan. Asking at
  // every request taught people to tick without reading — which is the opposite
  // of what the tick is for. A new terms date asks again (see TermsView).
  const termsAlreadyAccepted = terms?.accepted ?? false
  const termsConfirmed = termsAlreadyAccepted || acceptedTerms

  const windowValid = Boolean(start && end && dayjs(end).isAfter(dayjs(start)))
  // The server refuses a longer window; without mirroring it the request 400s and
  // the whole car list silently renders as "nobody here shares a car".
  const maxLoanDays = maxLoanDaysHint
  const windowTooLong = Boolean(
    windowValid && dayjs(end).diff(dayjs(start), "day") > maxLoanDays,
  )
  // The server refuses a window that has already ended, and used to be the only
  // thing that said so — after the request had been composed and sent.
  const windowInPast = Boolean(windowValid && dayjs(end).isBefore(dayjs()))
  // One name for "these dates could actually produce a request". The car list is
  // availability *for this window*, so showing it for an impossible one offers
  // live checkboxes over answers that do not apply.
  const windowUsable = windowValid && !windowTooLong && !windowInPast

  // Why "Send forespørgsel" is disabled, in the order a borrower can act on it.
  // The bar used to explain only the terms case and leave the rest silent, with
  // the real reason printed thousands of pixels up the page.
  const blockedReason = !windowValid
    ? "Sluttidspunktet skal ligge efter starttidspunktet."
    : windowTooLong
      ? `Et lån kan højst vare ${maxLoanDays} dage.`
      : windowInPast
        ? "Tidsrummet er allerede forbi — vælg et senere tidspunkt."
        : selected.length === 0
          ? "Vælg mindst én bil."
          : !termsConfirmed
            ? "Bekræft vilkårene for at sende forespørgslen."
            : null

  // Key off the exact strings sent to the server. Going through dayjs rather
  // than start.toISOString() also survives the date picker handing back a
  // string instead of a Date, which @mantine/dates 9.0-alpha is known to do.
  const startIso = windowValid ? dayjs(start).toISOString() : ""
  const endIso = windowValid ? dayjs(end).toISOString() : ""

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
    enabled: windowUsable,
    // Keep the last good list on screen while the dates are being edited, so the
    // selection stays visible and the household count cannot read "0 husstande".
    placeholderData: keepPreviousData,
  })

  // Only used before the first response lands; the server is the real limit.
  const maxCandidates = sharedCars?.max_candidates ?? 10

  useEffect(() => {
    if (sharedCars?.max_loan_days) setMaxLoanDaysHint(sharedCars.max_loan_days)
  }, [sharedCars?.max_loan_days])

  // A selection made for one window means nothing for an impossible one, and the
  // list it was made from is about to be hidden. Dropping it keeps the summary
  // ("Du spørger 2 husstande…") from counting cars nobody can see.
  useEffect(() => {
    if (!windowUsable) setSelected([])
  }, [windowUsable])

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

  // Shared by both pickers, so Fra and Til cannot drift apart in behaviour or in
  // what a screen reader announces. The three labels are otherwise unnamed icon
  // buttons ("‹", "›", "✓"), which is the whole month navigation.
  const pickerProps = {
    clearable: false,
    // Weekday first, for the same reason as everywhere else in bildeling: the
    // trip is planned as "on Saturday" long before it is planned as "the 12th".
    valueFormat: narrow ? SHORT_DATE_TIME : LONG_DATE_TIME,
    dropdownType: narrow ? "modal" as const : "popover" as const,
    minDate: new Date(),
    nextLabel: "Næste måned",
    previousLabel: "Forrige måned",
    submitButtonProps: { "aria-label": "Bekræft tidspunkt" },
  }

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
              {...pickerProps}
            />
            <DateTimePicker
              label="Til"
              value={end}
              onChange={(value) => setEnd(value ? new Date(value) : null)}
              {...pickerProps}
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
          {!windowUsable && blockedReason && (
            <Text size="sm" c="red">
              {blockedReason}
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
            label="Mindst antal sæder (valgfrit)"
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
            Ugeskemaet er kun vejledende. En bil der plejer at være optaget, kan
            godt være fri netop nu — spørg endelig. Den første ejer der siger
            ja, låner dig bilen, så vælg kun biler du gerne vil låne.
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
          {/* Availability is answered *for a window*. Keeping the previous
              window's list on screen for an impossible one offered live
              checkboxes over answers that no longer applied. */}
          {!windowUsable && (
            <Text size="sm" c="dimmed">
              Ret tidsrummet for at se biler.
            </Text>
          )}
          {windowUsable && !isError && sharedCars?.cars.length === 0 && (
            <Text size="sm" c="dimmed">
              Der er ingen biler i delebilparken endnu.
            </Text>
          )}
          {windowUsable &&
            sharedCars?.cars.map((car) => {
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
                  <Group
                    justify="space-between"
                    align="flex-start"
                    wrap="nowrap"
                  >
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
                          car.seats ? `${car.seats} sæder` : null,
                          car.is_electric ? "Elbil" : null,
                          car.has_isofix ? "Isofix" : null,
                          car.has_tow_hitch ? "Træk" : null,
                          car.dogs_allowed ? "Hunde tilladt" : null,
                          formatRatePerKm(car.effective_rate_per_km),
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

      {/* The terms themselves stay here, where there is room to read them; the
          tick that accepts them lives in the bar below. The bar used to cover
          the checkbox it was telling the borrower to find. Once accepted they
          stay readable — only the tick goes away. */}
      {terms && (
        <TermsConsent
          collapsible
          hideCheckbox
          terms={terms}
          intro={termsAlreadyAccepted ? acceptedTermsNote(terms) : undefined}
          label="Jeg har læst og accepterer vilkårene"
          checked={acceptedTerms}
          onChange={setAcceptedTerms}
        />
      )}

      <Card
        withBorder
        radius="md"
        padding="sm"
        // Sticky rather than a phone-only variant: one code path, and on a short
        // desktop page it simply never detaches. Kept as small as it can be —
        // every pixel here is taken from the car list on a phone.
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 2,
          background: "var(--mantine-color-body)",
          paddingBottom:
            "max(var(--mantine-spacing-sm), env(safe-area-inset-bottom))",
        }}
      >
        <Stack gap="xs">
          {terms && !termsAlreadyAccepted && (
            <Checkbox
              label="Jeg har læst og accepterer vilkårene"
              checked={acceptedTerms}
              onChange={(event) =>
                setAcceptedTerms(event.currentTarget.checked)
              }
            />
          )}
          {/* At most two short lines: what you are about to send, and why you
              cannot send it yet. With nothing selected the reason ("Vælg mindst
              én bil.") is the only one, so the bar is never taller than it needs
              to be — it used to carry four lines of standing prose. */}
          {selected.length > 0 && (
            <Text size="xs" c="dimmed">
              {`Du spørger ${householdCount} husstand${
                householdCount === 1 ? "" : "e"
              } om ${selected.length} af højst ${maxCandidates} biler.`}
            </Text>
          )}
          {blockedReason && (
            <Text size="xs" c="dimmed">
              {blockedReason}
            </Text>
          )}
          <Button
            leftSection={<IconCar size={18} />}
            disabled={blockedReason !== null}
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
