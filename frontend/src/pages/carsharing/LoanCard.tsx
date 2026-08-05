import { useState } from "react"

import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core"

import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react"

import dayjs from "dayjs"

import { calculateAmountDue, carSharingApi } from "../../api/carsharing"

import {
  normalizeDecimalSeparator,
  parseDecimalInput,
} from "../../utils/decimalInput"

import {
  describeSettlement,
  formatKr,
  formatWindow,
  moneyInputError,
  settlementBreakdown,
  useCarSharingMutation,
} from "./shared"

import type { CarLoan } from "../../types"

// --- Tab 2: my loans ---------------------------------------------------------

interface CompleteFormProps {
  loan: CarLoan
}

function CompleteLoanForm({ loan }: CompleteFormProps) {
  const [actualKm, setActualKm] = useState<number | string>(loan.expected_km)
  const [expenseAmount, setExpenseAmount] = useState("0")
  const [expenseNote, setExpenseNote] = useState("")
  const [damageNote, setDamageNote] = useState("")

  const rate = loan.rate_per_km ?? "0"
  const km = typeof actualKm === "number" ? actualKm : Number(actualKm) || 0
  const expenseError = moneyInputError(expenseAmount, "et beløb")
  const amountDue = calculateAmountDue(
    km,
    rate,
    normalizeDecimalSeparator(expenseAmount),
  )

  const mutation = useCarSharingMutation({
    mutationFn: () =>
      carSharingApi.completeLoan(loan.id, {
        actual_km: km,
        expense_amount: normalizeDecimalSeparator(expenseAmount) || "0",
        expense_note: expenseNote,
        damage_note: damageNote,
      }),
    successTitle: "Lånet er afsluttet",
    successMessage: "Ejeren har fået besked med beløbet.",
    errorTitle: "Kunne ikke afslutte lånet",
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
        error={expenseError}
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
      <Button
        loading={mutation.isPending}
        disabled={expenseError !== null}
        onClick={() => mutation.mutate(undefined)}
      >
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

/** How a loan reads to the person looking at it, per the server's `viewer_role`. */
interface LoanPresentation {
  badge: string
  badgeColor: string | undefined
  /** Set when this viewer is not party to the loan and needs no detail at all. */
  closedNotice: string | null
}

function presentLoan(loan: CarLoan): LoanPresentation {
  const role = loan.viewer_role

  // Asked, but another household said yes first — or we said no ourselves. Either
  // way the loan is somebody else's business now.
  if (role === "closed_out") {
    return {
      badge: "Lukket",
      badgeColor: "gray",
      closedNotice: "En anden ejer var først — du skal ikke gøre mere.",
    }
  }
  if (role === "declined") {
    return {
      badge: "Du sagde nej",
      badgeColor: "gray",
      closedNotice:
        loan.status === "declined"
          ? "Ingen af de spurgte husstande kunne låne ud."
          : "Din husstand har sagt nej.",
    }
  }

  if (loan.status === "declined") {
    return {
      badge: "Ingen kunne låne ud",
      badgeColor: "orange",
      closedNotice: null,
    }
  }
  if (loan.status === "active" && !loan.has_started) {
    return {
      badge: `Aftalt · starter ${dayjs(loan.start_at).format("D. MMM")}`,
      badgeColor: "blue",
      closedNotice: null,
    }
  }

  const labels: Record<CarLoan["status"], string> = {
    requested: "Afventer svar",
    active: "Aktivt lån",
    completed: "Afsluttet",
    cancelled: "Aflyst",
    declined: "Ingen kunne låne ud",
  }
  return {
    badge: labels[loan.status],
    badgeColor: undefined,
    closedNotice: null,
  }
}

/** Who is doing what, with the tense the status actually implies. */
function describeParties(loan: CarLoan): string {
  const settled =
    loan.status === "completed" ||
    loan.status === "cancelled" ||
    loan.status === "declined"
  if (loan.is_borrower) {
    if (loan.status === "requested") return "Du vil låne"
    return settled ? "Du lånte" : "Du låner"
  }
  if (loan.status === "requested") return `${loan.borrower_name} vil låne`
  return settled ? `${loan.borrower_name} lånte` : `${loan.borrower_name} låner`
}

export function LoanCard({ loan, highlight }: LoanCardProps) {
  // Only relevant before the window opens: the form is folded away, but someone
  // who really did drive early can still get at it.
  const [settleEarly, setSettleEarly] = useState(false)

  const respondMutation = useCarSharingMutation({
    mutationFn: (input: RespondInput) =>
      carSharingApi.respondToCandidate(
        loan.id,
        input.candidateId,
        input.action,
      ),
    // Acting on a request used to be the one mutation here with no confirmation,
    // which left an owner unable to tell whether their "Nej" had registered.
    successTitle: (result: CarLoan) =>
      result.status === "active" ? "Bilen er udlånt" : "Du har sagt nej",
    successMessage: (result: CarLoan) =>
      result.status === "active"
        ? `${result.borrower_name} låner ${result.car_display_name}.`
        : "Låneren har fået besked.",
    errorTitle: "Kunne ikke svare",
  })

  const cancelMutation = useCarSharingMutation({
    mutationFn: () => carSharingApi.cancelLoan(loan.id),
    successTitle: loan.is_borrower
      ? "Lånet er aflyst"
      : "Bilen er trukket tilbage",
    errorTitle: "Kunne ikke aflyse",
  })

  const presentation = presentLoan(loan)
  const isLender = loan.viewer_role === "lender"
  // A withdrawal after a real trip voids the km bill, because cancelling never
  // settles — so confirm, with wording that names the risk.
  const cancelLabel =
    isLender && loan.status === "active" ? "Træk bilen tilbage" : "Aflys"
  const cancelPrompt =
    isLender && loan.status === "active"
      ? `Vil du trække bilen tilbage? ${loan.borrower_name} har den lige nu.`
      : loan.status === "active"
        ? 'Vil du aflyse lånet uden at afregne? Brug "Afslut lån" hvis du har kørt i bilen.'
        : "Vil du aflyse din forespørgsel?"

  // Own household's answers, so an owner can see what they replied.
  const ownCandidates = loan.candidates.filter(
    (candidate) => candidate.is_own_household,
  )
  const unanswered = ownCandidates.filter(
    (candidate) => candidate.status === "asked",
  )
  const answered = ownCandidates.filter(
    (candidate) => candidate.status === "declined",
  )
  const stillWaiting = loan.candidates.filter(
    (candidate) => candidate.status === "asked",
  ).length

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
          <Badge variant="light" color={presentation.badgeColor}>
            {presentation.badge}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {describeParties(loan)} · ca. {loan.expected_km} km
        </Text>

        {/* Not party to this loan: say so and show nothing further. */}
        {presentation.closedNotice !== null ? (
          <Text size="sm">{presentation.closedNotice}</Text>
        ) : (
          <>
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

            {/* Borrower waiting: nothing to decide — the first yes settles it */}
            {loan.is_borrower && loan.status === "requested" && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Afventer svar. Den første ejer der siger ja, låner dig bilen.
                </Text>
                <Text size="xs" c="dimmed">
                  Spurgt:{" "}
                  {loan.candidates
                    .map(
                      (candidate) =>
                        `${candidate.car_display_name} (${
                          candidate.status === "declined" ? "nej" : "afventer"
                        })`,
                    )
                    .join(", ")}
                </Text>
              </Stack>
            )}

            {/* Borrower, and everybody said no: a dead end, said plainly */}
            {loan.is_borrower && loan.status === "declined" && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Alle {loan.candidates.length} spurgte husstande har sagt nej —
                  der er ikke flere at afvente svar fra.
                </Text>
                <Text size="xs" c="dimmed">
                  Prøv et andet tidsrum, eller spørg flere biler.
                </Text>
              </Stack>
            )}

            {/* Owner: answer a request about your own car */}
            {loan.viewer_role === "asked" && (
              <Stack gap="xs">
                {unanswered.map((candidate) => (
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
                {/* Your own no, rendered rather than filtered away — otherwise the
                    row just vanishes and the card still says "Afventer svar". */}
                {answered.map((candidate) => (
                  <Text key={candidate.id} size="sm" c="dimmed">
                    I har sagt nej til {candidate.car_display_name}.
                  </Text>
                ))}
                <Text size="xs" c="dimmed">
                  {stillWaiting > 1
                    ? `Låneren har spurgt ${stillWaiting} biler, der endnu ikke har svaret. Den første der siger ja, låner bilen ud.`
                    : "Siger du ja, er bilen udlånt med det samme."}
                </Text>
              </Stack>
            )}

            {loan.status === "completed" && loan.amount_due !== null && (
              <Stack gap={2}>
                <Text size="sm">{describeSettlement(loan)}</Text>
                <Text size="xs" c="dimmed">
                  {settlementBreakdown(loan)}
                </Text>
              </Stack>
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

            {loan.is_borrower &&
              loan.status === "active" &&
              (loan.has_started ? (
                <CompleteLoanForm loan={loan} />
              ) : (
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    Lånet starter {dayjs(loan.start_at).format("D. MMM HH:mm")}{" "}
                    — afslut det først når du har haft bilen.
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => setSettleEarly(true)}
                  >
                    Afslut alligevel
                  </Button>
                  {settleEarly && <CompleteLoanForm loan={loan} />}
                </Stack>
              ))}

            {loan.can_cancel && (
              <Button
                variant="subtle"
                color="red"
                size="xs"
                loading={cancelMutation.isPending}
                onClick={() => {
                  if (window.confirm(cancelPrompt))
                    cancelMutation.mutate(undefined)
                }}
              >
                {cancelLabel}
              </Button>
            )}
          </>
        )}
      </Stack>
    </Card>
  )
}
