import { useEffect, useMemo, useState } from "react"

import { useNavigate, useParams } from "react-router-dom"

import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Container,
  Divider,
  Group,
  List,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core"

import { DateTimePicker } from "@mantine/dates"

import { notifications } from "@mantine/notifications"

import {
  IconAlertTriangle,
  IconCar,
  IconInfoCircle,
  IconPlus,
} from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import dayjs from "dayjs"

import { calculateAmountDue, carSharingApi } from "../api/carsharing"

import { WeekHourGrid } from "../components/WeekHourGrid"

import { formatLicensePlate } from "../utils/licensePlate"

import {
  normalizeDecimalSeparator,
  parseDecimalInput,
  toDanishDecimal,
} from "../utils/decimalInput"

import {
  blocksToGrid,
  describeGrid,
  emptyGrid,
  gridToBlocks,
} from "../utils/weekSchedule"

import type { HourGrid } from "../utils/weekSchedule"

import { housesApi } from "../api/houses"

import type { Car, CarConflict, CarLoan, PoolCar } from "../types"

interface ConflictMeta {
  color: string
  label: string
}

// Three grades of "busy", deliberately shown differently: only an active loan
// takes a car off the table.
const CONFLICT_META: Record<string, ConflictMeta> = {
  requested: { color: "blue", label: "Allerede spurgt" },
  schedule: { color: "yellow", label: "Normalt optaget" },
  loan: { color: "gray", label: "Udlånt" },
}

function conflictMeta(conflict: CarConflict): ConflictMeta | null {
  return conflict ? CONFLICT_META[conflict] : null
}

function formatKr(amount: number | string): string {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount)
  if (Number.isNaN(value)) return `${amount} kr.`
  return `${value.toLocaleString("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr.`
}

function formatWindow(start: string, end: string): string {
  const from = dayjs(start)
  const to = dayjs(end)
  if (from.isSame(to, "day")) {
    return `${from.format("D. MMM YYYY HH:mm")}–${to.format("HH:mm")}`
  }
  return `${from.format("D. MMM YYYY HH:mm")} til ${to.format("D. MMM YYYY HH:mm")}`
}

function errorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: unknown } })?.response
  const data = response?.data
  if (typeof data === "string") return data
  if (data && typeof data === "object") {
    const first = Object.values(data as Record<string, unknown>)[0]
    if (Array.isArray(first) && typeof first[0] === "string") return first[0]
    if (typeof first === "string") return first
  }
  return fallback
}

// --- Tab 1: borrow a car -----------------------------------------------------

interface BorrowTabProps {
  onRequested: (loan: CarLoan) => void
}

function BorrowTab({ onRequested }: BorrowTabProps) {
  const queryClient = useQueryClient()
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

  const windowValid = Boolean(start && end && dayjs(end).isAfter(dayjs(start)))

  // Key off the exact strings sent to the server. Going through dayjs rather
  // than start.toISOString() also survives the date picker handing back a
  // string instead of a Date, which @mantine/dates 9.0-alpha is known to do.
  const startIso = windowValid ? dayjs(start).toISOString() : ""
  const endIso = windowValid ? dayjs(end).toISOString() : ""

  const { data: terms } = useQuery({
    queryKey: ["carsharing", "terms"],
    queryFn: carSharingApi.getTerms,
  })

  const { data: pool, isLoading } = useQuery({
    queryKey: [
      "carsharing",
      "pool",
      startIso,
      endIso,
      needsIsofix,
      needsTowHitch,
      minSeats,
    ],
    queryFn: () =>
      carSharingApi.getPoolCars({
        start: startIso,
        end: endIso,
        isofix: needsIsofix,
        tow: needsTowHitch,
        seats: typeof minSeats === "number" ? minSeats : null,
      }),
    enabled: windowValid,
  })

  const maxCandidates = pool?.max_candidates ?? 5

  // Households, not cars: two cars from the same house is one household asked.
  const householdCount = useMemo(() => {
    const cars = pool?.cars ?? []
    const houses = new Set(
      cars
        .filter((car) => selected.includes(car.id))
        .map((car) => car.house_name),
    )
    return houses.size
  }, [pool, selected])

  const requestMutation = useMutation({
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
      }),
    onSuccess: (loan) => {
      notifications.show({
        title: "Forespørgsel sendt",
        message: `Du har spurgt ${householdCount} husstand${
          householdCount === 1 ? "" : "e"
        }.`,
        color: "green",
      })
      setSelected([])
      setNote("")
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
      onRequested(loan)
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke sende forespørgslen",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  function toggleCar(car: PoolCar) {
    if (!car.selectable) return
    setSelected((current) => {
      if (current.includes(car.id)) return current.filter((id) => id !== car.id)
      if (current.length >= maxCandidates) {
        notifications.show({
          title: "Loft nået",
          message: `Du kan højst spørge ${maxCandidates} biler ad gangen — vælg de mest relevante.`,
          color: "yellow",
        })
        return current
      }
      return [...current, car.id]
    })
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
          <Title order={4}>Biler i bilpølen</Title>
          <Text size="sm" c="dimmed">
            Ugeskemaet er kun vejledende. En bil der plejer at være væk, kan
            godt være fri netop nu — spørg endelig.
          </Text>
          {isLoading && (
            <Center py="md">
              <Loader size="sm" />
            </Center>
          )}
          {pool?.cars.length === 0 && (
            <Text size="sm" c="dimmed">
              Der er ingen biler i bilpølen endnu.
            </Text>
          )}
          {pool?.cars.map((car) => {
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
        <Card withBorder radius="md" padding="md">
          <Stack gap="xs">
            <Title order={4}>{terms.title ?? "Vilkår"}</Title>
            <List size="sm" spacing="xs">
              {(terms.bullets ?? []).map((bullet) => (
                <List.Item key={bullet}>{bullet}</List.Item>
              ))}
            </List>
            <Text size="xs" c="dimmed">
              Version {terms.version}
            </Text>
          </Stack>
        </Card>
      )}

      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Text size="sm">
            {selected.length === 0
              ? "Vælg mindst én bil."
              : `Du spørger ${householdCount} husstand${
                  householdCount === 1 ? "" : "e"
                } om ${selected.length} bil${
                  selected.length === 1 ? "" : "er"
                }.`}
          </Text>
          <Text size="xs" c="dimmed">
            Ejerens ja er et tilbud. Får du flere ja, vælger du selv hvilken bil
            du låner.
          </Text>
          <Button
            leftSection={<IconCar size={18} />}
            disabled={selected.length === 0 || !windowValid}
            loading={requestMutation.isPending}
            onClick={() => requestMutation.mutate()}
          >
            Send forespørgsel
          </Button>
        </Stack>
      </Card>
    </Stack>
  )
}

// --- Tab 2: my loans ---------------------------------------------------------

interface CompleteFormProps {
  loan: CarLoan
}

function CompleteLoanForm({ loan }: CompleteFormProps) {
  const queryClient = useQueryClient()
  const [actualKm, setActualKm] = useState<number | string>(loan.expected_km)
  const [expenseAmount, setExpenseAmount] = useState("0")
  const [expenseNote, setExpenseNote] = useState("")
  const [damageNote, setDamageNote] = useState("")

  const rate = loan.rate_per_km ?? "0"
  const km = typeof actualKm === "number" ? actualKm : Number(actualKm) || 0
  const amountDue = calculateAmountDue(
    km,
    rate,
    normalizeDecimalSeparator(expenseAmount),
  )

  const mutation = useMutation({
    mutationFn: () =>
      carSharingApi.completeLoan(loan.id, {
        actual_km: km,
        expense_amount: normalizeDecimalSeparator(expenseAmount) || "0",
        expense_note: expenseNote,
        damage_note: damageNote,
      }),
    onSuccess: () => {
      notifications.show({
        title: "Lånet er afsluttet",
        message: "Ejeren har fået besked med beløbet.",
        color: "green",
      })
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke afslutte lånet",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  return (
    <Stack gap="sm" mt="sm">
      <Divider label="Afslut lån" labelPosition="left" />
      <NumberInput
        label="Kørte kilometer"
        value={actualKm}
        onChange={setActualKm}
        min={0}
        max={100000}
      />
      <TextInput
        label="Dine udgifter til strøm eller brændstof (kr.)"
        description="Ladning med brikken i bilen er dækket — skriv kun ekstra udgifter."
        value={expenseAmount}
        onChange={(event) => setExpenseAmount(event.currentTarget.value)}
        inputMode="decimal"
      />
      <TextInput
        label="Hvad dækker udgiften? (valgfrit)"
        value={expenseNote}
        onChange={(event) => setExpenseNote(event.currentTarget.value)}
      />
      <Textarea
        label="Skader eller ting der ikke virker (valgfrit)"
        value={damageNote}
        onChange={(event) => setDamageNote(event.currentTarget.value)}
        autosize
        minRows={2}
      />
      <Card
        withBorder
        radius="sm"
        padding="sm"
        bg="var(--mantine-color-gray-light)"
      >
        <Text size="sm" fw={600}>
          {amountDue < 0
            ? `Ejeren skylder dig ${formatKr(Math.abs(amountDue))}`
            : `Du skal betale ${formatKr(amountDue)}`}
        </Text>
        <Text size="xs" c="dimmed">
          {km} km × {formatKr(rate)}
          {parseDecimalInput(expenseAmount) > 0
            ? ` − ${formatKr(parseDecimalInput(expenseAmount))} i udgifter`
            : ""}
        </Text>
        <Text size="xs" c="dimmed">
          Afregn selv med MobilePay.
        </Text>
      </Card>
      <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Afslut lån
      </Button>
    </Stack>
  )
}

interface LoanCardProps {
  loan: CarLoan
  highlight: boolean
}

// Named rather than inline: oxfmt strips semicolons from inline object types,
// which breaks the build (see CLAUDE.md).
interface RespondInput {
  candidateId: number
  action: "accept" | "decline"
}

function LoanCard({ loan, highlight }: LoanCardProps) {
  const queryClient = useQueryClient()

  const chooseMutation = useMutation({
    mutationFn: (candidateId: number) =>
      carSharingApi.chooseCandidate(loan.id, candidateId),
    onSuccess: () => {
      notifications.show({
        title: "Bil valgt",
        message: "Lånet er aktivt.",
        color: "green",
      })
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke vælge bilen",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  const respondMutation = useMutation({
    mutationFn: (input: RespondInput) =>
      carSharingApi.respondToCandidate(
        loan.id,
        input.candidateId,
        input.action,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke svare",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => carSharingApi.cancelLoan(loan.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
  })

  const accepted = loan.candidates.filter(
    (candidate) => candidate.status === "accepted",
  )
  const statusLabel: Record<CarLoan["status"], string> = {
    requested: "Afventer svar",
    active: "Aktivt lån",
    completed: "Afsluttet",
    cancelled: "Aflyst",
  }

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      style={
        highlight ? { borderColor: "var(--mantine-color-blue-5)" } : undefined
      }
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{formatWindow(loan.start_at, loan.end_at)}</Text>
          <Badge variant="light">{statusLabel[loan.status]}</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {loan.is_borrower ? "Du låner" : `${loan.borrower_name} vil låne`} ·
          ca. {loan.expected_km} km
        </Text>
        {loan.note && <Text size="sm">{loan.note}</Text>}

        {loan.car !== null && (
          <Text size="sm">
            <strong>{loan.car_display_name}</strong> · {loan.car_house_name}
          </Text>
        )}

        {loan.status === "active" && loan.car_practical_note && (
          <Alert
            icon={<IconInfoCircle size={18} />}
            color="blue"
            variant="light"
          >
            {loan.car_practical_note}
          </Alert>
        )}

        {/* Borrower: pick between the offers that came in */}
        {loan.is_borrower && loan.status === "requested" && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {accepted.length === 0
                ? "Ingen har svaret ja endnu."
                : "Vælg den bil du vil låne:"}
            </Text>
            {accepted.map((candidate) => (
              <Group key={candidate.id} justify="space-between" wrap="wrap">
                <Text size="sm">
                  {candidate.car_display_name} · {candidate.car_house_name}
                </Text>
                <Button
                  size="xs"
                  loading={chooseMutation.isPending}
                  onClick={() => chooseMutation.mutate(candidate.id)}
                >
                  Vælg
                </Button>
              </Group>
            ))}
            <Text size="xs" c="dimmed">
              Spurgt:{" "}
              {loan.candidates
                .map(
                  (candidate) =>
                    `${candidate.car_display_name} (${
                      candidate.status === "asked"
                        ? "afventer"
                        : candidate.status === "accepted"
                          ? "ja"
                          : candidate.status === "declined"
                            ? "nej"
                            : "lukket"
                    })`,
                )
                .join(", ")}
            </Text>
          </Stack>
        )}

        {/* Owner: answer a request about your own car */}
        {!loan.is_borrower && loan.status === "requested" && (
          <Stack gap="xs">
            {loan.candidates
              .filter(
                (candidate) =>
                  candidate.status === "asked" && candidate.is_own_household,
              )
              .map((candidate) => (
                <Group key={candidate.id} justify="space-between" wrap="wrap">
                  <Text size="sm">{candidate.car_display_name}</Text>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      loading={respondMutation.isPending}
                      onClick={() =>
                        respondMutation.mutate({
                          candidateId: candidate.id,
                          action: "accept",
                        })
                      }
                    >
                      Ja, den må lånes
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() =>
                        respondMutation.mutate({
                          candidateId: candidate.id,
                          action: "decline",
                        })
                      }
                    >
                      Nej
                    </Button>
                  </Group>
                </Group>
              ))}
            <Text size="xs" c="dimmed">
              {loan.candidates.length > 1
                ? `Låneren har spurgt ${loan.candidates.length} biler. Dit ja er et tilbud — låneren vælger selv.`
                : "Dit ja er et tilbud — låneren vælger selv."}
            </Text>
          </Stack>
        )}

        {loan.status === "completed" && loan.amount_due !== null && (
          <Text size="sm">
            {Number.parseFloat(loan.amount_due) < 0
              ? `Ejeren skylder låneren ${formatKr(Math.abs(Number.parseFloat(loan.amount_due)))}`
              : `Beløb: ${formatKr(loan.amount_due)}`}{" "}
            for {loan.actual_km} km
          </Text>
        )}

        {loan.status === "completed" && loan.damage_note && (
          <Alert
            icon={<IconAlertTriangle size={18} />}
            color="orange"
            variant="light"
          >
            {loan.damage_note}
          </Alert>
        )}

        {loan.is_borrower && loan.status === "active" && (
          <CompleteLoanForm loan={loan} />
        )}

        {(loan.status === "requested" || loan.status === "active") &&
          (loan.is_borrower || loan.status === "active") && (
            <Button
              variant="subtle"
              color="red"
              size="xs"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Aflys
            </Button>
          )}
      </Stack>
    </Card>
  )
}

interface MyLoansTabProps {
  highlightLoanId: number | null
}

function MyLoansTab({ highlightLoanId }: MyLoansTabProps) {
  const { data: loans, isLoading } = useQuery({
    queryKey: ["carsharing", "loans"],
    queryFn: carSharingApi.getLoans,
  })

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  const open = (loans ?? []).filter(
    (loan) => loan.status === "requested" || loan.status === "active",
  )
  const closed = (loans ?? []).filter(
    (loan) => loan.status === "completed" || loan.status === "cancelled",
  )

  return (
    <Stack gap="md" mt="md">
      {open.length === 0 && closed.length === 0 && (
        <Text size="sm" c="dimmed">
          Du har ingen lån eller forespørgsler endnu.
        </Text>
      )}
      {open.map((loan) => (
        <LoanCard
          key={loan.id}
          loan={loan}
          highlight={loan.id === highlightLoanId}
        />
      ))}
      {closed.length > 0 && (
        <>
          <Divider label="Tidligere" labelPosition="left" />
          {closed.map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              highlight={loan.id === highlightLoanId}
            />
          ))}
        </>
      )}
    </Stack>
  )
}

// --- Tab 3: my cars ----------------------------------------------------------

interface MyCarCardProps {
  car: Car
}

function MyCarCard({ car }: MyCarCardProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(car)
  const [grid, setGrid] = useState<HourGrid>(emptyGrid)
  // What the server currently holds, so "Gem ugeskema" can tell whether the
  // painted week actually differs from it.
  const [savedGrid, setSavedGrid] = useState<HourGrid>(emptyGrid)

  useEffect(() => {
    setDraft(car)
  }, [car])

  const { data: blocks } = useQuery({
    queryKey: ["carsharing", "blocks", car.id],
    queryFn: () => carSharingApi.getBlocks(car.id),
  })

  // Same query key as the borrow tab, so react-query serves it from cache.
  const { data: terms } = useQuery({
    queryKey: ["carsharing", "terms"],
    queryFn: carSharingApi.getTerms,
  })

  useEffect(() => {
    if (!blocks) return
    const loaded = blocksToGrid(blocks)
    setGrid(loaded)
    setSavedGrid(loaded)
  }, [blocks])

  const scheduleDirty = JSON.stringify(grid) !== JSON.stringify(savedGrid)

  const saveMutation = useMutation({
    mutationFn: () =>
      housesApi.updateCar(car.id, {
        in_pool: draft.in_pool,
        rate_per_km: draft.rate_per_km
          ? normalizeDecimalSeparator(draft.rate_per_km)
          : null,
        make: draft.make,
        model_name: draft.model_name,
        color: draft.color,
        year: draft.year,
        seats: draft.seats,
        has_tow_hitch: draft.has_tow_hitch,
        has_isofix: draft.has_isofix,
        dogs_allowed: draft.dogs_allowed,
        has_charge_fob: draft.has_charge_fob,
        equipment_note: draft.equipment_note,
        practical_note: draft.practical_note,
      }),
    onSuccess: () => {
      notifications.show({
        title: "Bilen er gemt",
        message: "",
        color: "green",
      })
      queryClient.invalidateQueries({ queryKey: ["cars"] })
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke gemme bilen",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  const saveScheduleMutation = useMutation({
    mutationFn: () => carSharingApi.replaceBlocks(car.id, gridToBlocks(grid)),
    onSuccess: (saved) => {
      const loaded = blocksToGrid(saved)
      setGrid(loaded)
      setSavedGrid(loaded)
      notifications.show({
        title: "Ugeskemaet er gemt",
        message: describeGrid(loaded),
        color: "green",
      })
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke gemme ugeskemaet",
        message: errorMessage(error, "Prøv igen."),
        color: "red",
      })
    },
  })

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Text fw={600}>{car.display_name}</Text>
            {car.license_plate &&
              car.display_name !== formatLicensePlate(car.license_plate) && (
                <Badge variant="default" size="sm">
                  {formatLicensePlate(car.license_plate)}
                </Badge>
              )}
          </Group>
          <Switch
            label="Med i bilpølen"
            checked={draft.in_pool}
            onChange={(event) =>
              setDraft({ ...draft, in_pool: event.currentTarget.checked })
            }
          />
        </Group>
        {!car.license_plate && (
          <Alert
            color="yellow"
            variant="light"
            icon={<IconInfoCircle size={18} />}
          >
            Bilen skal have en nummerplade for at kunne være i bilpølen.
          </Alert>
        )}

        <Group grow wrap="wrap">
          <TextInput
            label="Mærke"
            value={draft.make}
            onChange={(event) =>
              setDraft({ ...draft, make: event.currentTarget.value })
            }
          />
          <TextInput
            label="Model"
            value={draft.model_name}
            onChange={(event) =>
              setDraft({ ...draft, model_name: event.currentTarget.value })
            }
          />
        </Group>
        <Group grow wrap="wrap">
          <TextInput
            label="Farve"
            value={draft.color}
            onChange={(event) =>
              setDraft({ ...draft, color: event.currentTarget.value })
            }
          />
          <NumberInput
            label="Årgang"
            value={draft.year ?? ""}
            onChange={(value) =>
              setDraft({
                ...draft,
                year: typeof value === "number" ? value : null,
              })
            }
            min={1950}
            max={2100}
          />
          <NumberInput
            label="Pladser"
            value={draft.seats ?? ""}
            onChange={(value) =>
              setDraft({
                ...draft,
                seats: typeof value === "number" ? value : null,
              })
            }
            min={1}
            max={9}
          />
        </Group>
        <TextInput
          label="Egen km-takst (kr., valgfrit)"
          description={
            terms
              ? `Lad stå tom for at bruge fællesskabets standardtakst (${formatKr(
                  terms.default_rate_per_km,
                )} pr. km).`
              : "Lad stå tom for at bruge fællesskabets standardtakst."
          }
          value={toDanishDecimal(draft.rate_per_km)}
          onChange={(event) =>
            setDraft({
              ...draft,
              rate_per_km: event.currentTarget.value || null,
            })
          }
          inputMode="decimal"
          placeholder={
            terms ? toDanishDecimal(terms.default_rate_per_km) : "3,94"
          }
        />
        <Group gap="md" wrap="wrap">
          <Checkbox
            label="Træk"
            checked={draft.has_tow_hitch}
            onChange={(event) =>
              setDraft({ ...draft, has_tow_hitch: event.currentTarget.checked })
            }
          />
          <Checkbox
            label="Isofix"
            checked={draft.has_isofix}
            onChange={(event) =>
              setDraft({ ...draft, has_isofix: event.currentTarget.checked })
            }
          />
          <Checkbox
            label="Hunde tilladt"
            checked={draft.dogs_allowed}
            onChange={(event) =>
              setDraft({ ...draft, dogs_allowed: event.currentTarget.checked })
            }
          />
          <Checkbox
            label="Ladebrik i bilen"
            checked={draft.has_charge_fob}
            onChange={(event) =>
              setDraft({
                ...draft,
                has_charge_fob: event.currentTarget.checked,
              })
            }
          />
        </Group>
        <Textarea
          label="Andet udstyr"
          description="Fx. autostol, selepude, hundebur, tagbøjler, osv."
          value={draft.equipment_note}
          onChange={(event) =>
            setDraft({ ...draft, equipment_note: event.currentTarget.value })
          }
          autosize
          minRows={2}
        />
        <Textarea
          label="Praktisk info til låneren"
          description="Hvor nøglen og ladebrikken er, og hvor bilen holder."
          value={draft.practical_note}
          onChange={(event) =>
            setDraft({ ...draft, practical_note: event.currentTarget.value })
          }
          autosize
          minRows={2}
        />
        <Button
          loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          Gem bil
        </Button>

        <Divider
          label="Ugeskema — hvornår er bilen normalt i brug?"
          labelPosition="left"
        />
        <Text size="xs" c="dimmed">
          Skemaet reserverer intet. Det viser blot andre, hvornår det sjældent
          passer.
        </Text>

        <WeekHourGrid value={grid} onChange={setGrid} />

        <Text size="xs" c="dimmed">
          {describeGrid(grid)}
        </Text>
        <Group gap="xs" wrap="wrap">
          <Button
            variant="light"
            loading={saveScheduleMutation.isPending}
            disabled={!scheduleDirty}
            onClick={() => saveScheduleMutation.mutate()}
          >
            Gem ugeskema
          </Button>
          {scheduleDirty && (
            <Button
              variant="subtle"
              onClick={() => setGrid(blocksToGrid(blocks ?? []))}
            >
              Fortryd
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  )
}

function AddCarCard() {
  const queryClient = useQueryClient()
  const [plate, setPlate] = useState("")
  const [isElectric, setIsElectric] = useState(false)

  const createMutation = useMutation({
    mutationFn: () =>
      housesApi.createCar({
        license_plate: plate.trim(),
        is_electric: isElectric,
      }),
    onSuccess: (car) => {
      notifications.show({
        title: "Bilen er tilføjet",
        message: `${formatLicensePlate(car.license_plate)} — udfyld detaljerne nedenfor.`,
        color: "green",
      })
      setPlate("")
      setIsElectric(false)
      queryClient.invalidateQueries({ queryKey: ["cars"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke tilføje bilen",
        message: errorMessage(error, "Tjek nummerpladen og prøv igen."),
        color: "red",
      })
    },
  })

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Text fw={600}>Tilføj en bil til din husstand</Text>
        <Group grow align="flex-end" wrap="wrap">
          <TextInput
            label="Nummerplade"
            value={plate}
            onChange={(event) =>
              setPlate(event.currentTarget.value.toUpperCase())
            }
            placeholder="AB 12 345"
          />
          <Checkbox
            label="Elbil"
            checked={isElectric}
            onChange={(event) => setIsElectric(event.currentTarget.checked)}
          />
        </Group>
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          disabled={plate.trim().length === 0}
          loading={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Tilføj bil
        </Button>
      </Stack>
    </Card>
  )
}

function MyCarsTab() {
  const { data: cars, isLoading } = useQuery({
    queryKey: ["cars"],
    queryFn: housesApi.getCars,
  })

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  return (
    <Stack gap="md" mt="md">
      {(cars ?? []).length === 0 && (
        <Text size="sm" c="dimmed">
          Din husstand har ingen biler registreret endnu.
        </Text>
      )}
      {(cars ?? []).map((car) => (
        <MyCarCard key={car.id} car={car} />
      ))}
      <AddCarCard />
      <Text size="xs" c="dimmed">
        Nummerplade og elbil-markering kan også rettes under din husstands side
        i Beboere.
      </Text>
    </Stack>
  )
}

// --- Page --------------------------------------------------------------------

export default function CarSharingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const highlightLoanId = id ? Number(id) : null
  const [tab, setTab] = useState<string | null>(
    highlightLoanId ? "loans" : "borrow",
  )

  useEffect(() => {
    if (highlightLoanId) setTab("loans")
  }, [highlightLoanId])

  return (
    <Container size="md" py="md">
      <Title order={2} mb="xs">
        Bildeling
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Et overblik og en lommeregner. Et lån bliver til, når en ejer siger ja —
        resten aftaler I selv.
      </Text>

      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value)
          if (highlightLoanId) navigate("/bildeling")
        }}
      >
        <Tabs.List grow>
          <Tabs.Tab value="borrow">Lån en bil</Tabs.Tab>
          <Tabs.Tab value="loans">Mine lån</Tabs.Tab>
          <Tabs.Tab value="cars">Mine biler</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="borrow">
          <BorrowTab onRequested={() => setTab("loans")} />
        </Tabs.Panel>
        <Tabs.Panel value="loans">
          <MyLoansTab highlightLoanId={highlightLoanId} />
        </Tabs.Panel>
        <Tabs.Panel value="cars">
          <MyCarsTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  )
}
