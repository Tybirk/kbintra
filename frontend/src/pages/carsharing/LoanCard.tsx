import { useEffect, useRef, useState } from "react"

import {
  Alert,
  Anchor,
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

import { IconInfoCircle, IconMessage2 } from "@tabler/icons-react"

import { calculateAmountDue, carSharingApi } from "../../api/carsharing"

import {
  normalizeDecimalSeparator,
  parseDecimalInput,
} from "../../utils/decimalInput"

import {
  describeSettlement,
  formatDateTime,
  formatKr,
  formatWindow,
  kmInputError,
  moneyInputError,
  settlementBreakdown,
  useCarSharingMutation,
} from "./shared"

import type { CarLoan } from "../../types"

// --- Tab 2: my loans ---------------------------------------------------------

// Free text from a resident can hold a pasted link or an unbroken word. Without
// this the Alert's message box grows past the card — measured at 33.684px for a
// pathological note — and the root's overflow:hidden then cuts every line off
// mid-sentence, taking the ordinary Danish around it with it. The card does not
// scroll sideways, so the text is not merely awkward, it is gone.
const WRAP_LONG_WORDS = { message: { overflowWrap: "anywhere" } } as const

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
  // An empty field is not "I drove nothing" — it is a question nobody answered,
  // and settling on it wrote 0 km / 0,00 kr. into a state with no way back. The
  // borrow form already treats empty as an error; this one coerced it to 0.
  const kmError =
    actualKm === "" || actualKm === null
      ? "Skriv hvor mange kilometer du kørte."
      : kmInputError(actualKm, 0)
  // The note explains an amount, so there is nothing for it to explain until
  // there is one. Asking first and showing it only when the amount is above zero
  // is how a borrower ends up writing into a field nobody ever reads.
  const hasExpense = parseDecimalInput(expenseAmount) > 0
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
        // Never send a note the owner will not be shown: the amount can be typed
        // and then cleared again after the note was written.
        expense_note: hasExpense ? expenseNote : "",
        damage_note: damageNote,
      }),
    successTitle: "Lånet er afsluttet",
    successMessage: "Ejeren har fået besked med beløbet.",
    errorTitle: "Kunne ikke afslutte lånet",
  })

  return (
    <Stack gap="sm" mt="sm">
      <Divider label="Afslut lån" labelPosition="left" />
      {/* No min/max: Mantine's default clampBehavior rewrites an out-of-range
          value on blur and submits the rewritten one without a word, so a
          mistyped 999999 settled a loan at 394.000 kr. and a -30 settled it at
          nothing at all. A settlement is terminal and nobody can correct it
          afterwards, so the bounds are said out loud and the button waits. */}
      <NumberInput
        label="Kørte kilometer"
        value={actualKm}
        onChange={setActualKm}
        error={kmError}
      />
      <TextInput
        label="Dine udgifter til strøm eller brændstof (kr.)"
        description={
          loan.car_has_charge_fob
            ? "Ladning med brikken i bilen er dækket — skriv kun ekstra udgifter."
            : "Skriv hvad du selv har lagt ud til strøm eller brændstof."
        }
        value={expenseAmount}
        onChange={(event) => setExpenseAmount(event.currentTarget.value)}
        inputMode="decimal"
        error={expenseError}
      />
      {hasExpense && (
        <TextInput
          label="Hvad dækker udgiften? (valgfrit)"
          description="Vises for ejeren sammen med beløbet."
          value={expenseNote}
          onChange={(event) => setExpenseNote(event.currentTarget.value)}
        />
      )}
      {/* Not "Skader ...": most of what is written here is a thank-you, and a
          field that only names damage invites nothing else. */}
      <Textarea
        label="Besked til ejeren (valgfrit)"
        description="Fx. tak for lån, en bemærkning om turen, eller skader og ting der ikke virker."
        value={damageNote}
        onChange={(event) => setDamageNote(event.currentTarget.value)}
        autosize
        minRows={2}
      />
      {/* An amount computed from a value the server will refuse is worse than no
          amount: a negative expense quoted "444,00 kr." over a breakdown reading
          "100 km × 3,94 kr.", because the total used the raw value and the
          breakdown only rendered the expense when it was positive. */}
      {kmError === null && expenseError === null && (
        <Card
          withBorder
          radius="sm"
          padding="sm"
          bg="var(--mantine-color-gray-light)"
        >
          <Text size="sm" fw={600}>
            {amountDue === 0
              ? "Intet at betale"
              : amountDue < 0
                ? `Ejeren skylder dig ${formatKr(Math.abs(amountDue))}`
                : `Du skal betale ${formatKr(amountDue)}`}
          </Text>
          <Text size="xs" c="dimmed">
            {km.toLocaleString("da-DK")} km × {formatKr(rate)}
            {parseDecimalInput(expenseAmount) > 0
              ? ` − ${formatKr(parseDecimalInput(expenseAmount))} i udgifter`
              : ""}
          </Text>
          <Text size="xs" c="dimmed">
            Afregn selv med MobilePay.
          </Text>
        </Card>
      )}
      <Button
        loading={mutation.isPending}
        disabled={expenseError !== null || kmError !== null}
        onClick={() => mutation.mutate(undefined)}
      >
        Afslut lån
      </Button>
    </Stack>
  )
}

interface SettleInstructionProps {
  loan: CarLoan
}

/**
 * Who to pay, and on what number.
 *
 * "Afregn selv med MobilePay." was the whole instruction, and MobilePay is paid
 * to a person: the card named only the household, so the borrower had to leave
 * the loan, open Beboeroversigt and guess which of two adults said yes. The
 * number is the one the resident directory already shows every resident — this
 * is a shorter path to it, not a new disclosure.
 */
function SettleInstruction({ loan }: SettleInstructionProps) {
  const amount = Number.parseFloat(loan.amount_due ?? "0") || 0
  if (amount === 0) return null

  // The number I need is always the other side's, whichever way the money runs:
  // keying it on who pays named the wrong person to a lending household being
  // paid by its borrower. Direction only decides the verb.
  const [name, phone] = loan.is_borrower
    ? [loan.approved_by_name, loan.approved_by_phone]
    : [loan.borrower_name, loan.borrower_phone]
  // A negative amount means the borrower spent more on fuel than the trip cost,
  // so it runs the other way and the lending household pays.
  const borrowerPays = amount > 0
  const iAmPayer = loan.is_borrower === borrowerPays

  if (!name) {
    return (
      <Text size="xs" c="dimmed">
        Afregn selv med MobilePay.
      </Text>
    )
  }

  return (
    <Text size="xs" c="dimmed">
      {iAmPayer
        ? `Betal ${name} med MobilePay`
        : `${name} betaler dig med MobilePay`}
      {phone ? (
        <>
          {" på "}
          {/* tel: rather than plain text — MobilePay is looked up by number, and
              on a phone this is one tap instead of a transcription. */}
          <Anchor href={`tel:${phone.replace(/\s/g, "")}`} size="xs">
            {phone}
          </Anchor>
        </>
      ) : (
        "."
      )}
    </Text>
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

/** Whether a car actually went out. `car` is only set when an owner said yes. */
function wasLentOut(loan: CarLoan): boolean {
  return loan.car !== null
}

/** Why a household that was asked has nothing left to do, in its own terms.
 *
 * Mirrors the vocabulary of `_closed_reason` in the backend's
 * CandidateRespondView. It used to be the single sentence "En anden ejer var
 * først", which told a household that a request the *borrower* had withdrawn
 * had been won by a rival who never existed — while the notification sitting in
 * the same list said the borrower cancelled.
 */
function closedOutReason(loan: CarLoan): string {
  if (loan.status === "cancelled") {
    return `${loan.borrower_name} har aflyst forespørgslen — du skal ikke gøre mere.`
  }
  if (loan.status === "declined") {
    return "Forespørgslen er lukket — ingen kunne låne ud."
  }
  return "En anden ejer var først — du skal ikke gøre mere."
}

function presentLoan(loan: CarLoan): LoanPresentation {
  const role = loan.viewer_role

  // Asked, but somebody else settled it — or we said no ourselves. Either way
  // the loan is no longer this household's business.
  const ownCars = ownCarNames(loan)

  if (role === "closed_out") {
    return {
      badge: "Lukket",
      badgeColor: "gray",
      closedNotice: ownCars
        ? `${closedOutReason(loan)} (${ownCars})`
        : closedOutReason(loan),
    }
  }
  if (role === "declined") {
    return {
      badge: "Du sagde nej",
      badgeColor: "gray",
      closedNotice:
        loan.status === "declined"
          ? "Ingen af de spurgte husstande kunne låne ud."
          : `Din husstand har sagt nej til ${ownCars || "bilen"}.`,
    }
  }

  if (loan.status === "declined") {
    return {
      badge: "Ingen kunne låne ud",
      badgeColor: "orange",
      closedNotice: null,
    }
  }
  // A cancellation after the car actually went out leaves an unsettled trip:
  // no kilometres, no bill, nothing recorded. Say so rather than filing it next
  // to a request that was withdrawn before anyone lent anything.
  if (loan.status === "cancelled" && loan.activated_at) {
    return {
      badge: "Aflyst uden afregning",
      badgeColor: "orange",
      closedNotice: null,
    }
  }
  if (loan.status === "active" && !loan.has_started) {
    return {
      // With the date alone, a loan starting in 25 minutes read "starter 6. aug."
      // — today's date, which says nothing.
      badge: `Aftalt · starter ${formatDateTime(loan.start_at)}`,
      badgeColor: "blue",
      closedNotice: null,
    }
  }

  // Colour lives beside the word so the two cannot drift: every everyday status
  // used to compute the same default blue.
  const labels: Record<CarLoan["status"], [string, string | undefined]> = {
    requested: ["Afventer svar", "blue"],
    active: ["Aktivt lån", "green"],
    completed: ["Afsluttet", "gray"],
    cancelled: ["Aflyst", "gray"],
    declined: ["Ingen kunne låne ud", "orange"],
  }
  const [badge, badgeColor] = labels[loan.status]
  return { badge, badgeColor, closedNotice: null }
}

/** Who is doing what, in the tense of what actually happened.
 *
 * The rule is the union of two questions, not the status alone: a request that
 * died (declined, or cancelled before any owner said yes) never became a loan,
 * so nobody "lånte" anything — while a loan cancelled *after* the car went out
 * genuinely was borrowed.
 */
function describeParties(loan: CarLoan): string {
  const who = loan.is_borrower ? "Du" : loan.borrower_name

  if (loan.status === "requested") return `${who} vil låne`
  if (loan.status === "active") return `${who} låner`
  if (loan.status === "completed") return `${who} lånte`
  // declined, or cancelled — past tense only if a car actually went out.
  return wasLentOut(loan) ? `${who} lånte` : `${who} ville låne`
}

/** Households asked, not cars asked — two cars in one house is one household. */
function householdsAsked(loan: CarLoan): number {
  return new Set(loan.candidates.map((candidate) => candidate.car_house_name))
    .size
}

/** The viewer's own cars in this request, so an answered card still says which
 *  car it was about — three "Din husstand har sagt nej." cards in "Tidligere"
 *  are indistinguishable. */
function ownCarNames(loan: CarLoan): string {
  return loan.candidates
    .filter((candidate) => candidate.is_own_household)
    .map((candidate) => candidate.car_display_name)
    .join(", ")
}

export function LoanCard({ loan, highlight }: LoanCardProps) {
  // Only relevant before the window opens: the form is folded away, but someone
  // who really did drive early can still get at it.
  const [settleEarly, setSettleEarly] = useState(false)

  // A notification deep-links to one loan and this card gets a blue border —
  // which is no help when the card is a screen and a half below the fold.
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!highlight) return
    cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [highlight])

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
  // has_started, not status: an accepted loan is ACTIVE from the moment the
  // owner says yes, so "har den lige nu" was told to owners of a car that is
  // still parked outside their own house.
  const cancelPrompt =
    isLender && loan.status === "active"
      ? loan.has_started
        ? `Vil du trække bilen tilbage? ${loan.borrower_name} har den lige nu.`
        : `Vil du trække bilen tilbage? ${loan.borrower_name} regner med den ${formatDateTime(
            loan.start_at,
          )}.`
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
      ref={cardRef}
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
        {/* Once settled, the kilometres that were actually driven — the estimate
            sitting 60px above the bill it disagreed with was the wrong number to
            leave on a card about money. */}
        <Text size="sm" c="dimmed">
          {describeParties(loan)} ·{" "}
          {loan.status === "completed" && loan.actual_km !== null
            ? `${loan.actual_km} km`
            : `ca. ${loan.expected_km} km`}
        </Text>

        {/* Not party to this loan: say so and show nothing further. */}
        {presentation.closedNotice !== null ? (
          <Text size="sm">{presentation.closedNotice}</Text>
        ) : (
          <>
            {/* The borrower's own words when they asked. Presented like the
                settlement note further down, so a message from a person is
                recognisable as one wherever it sits on the card — unlabelled it
                read as one more system line about the loan. */}
            {loan.note && (
              <Alert
                icon={<IconMessage2 size={18} />}
                color="gray"
                variant="light"
                styles={WRAP_LONG_WORDS}
                title={
                  loan.is_borrower
                    ? "Din besked"
                    : `Besked fra ${loan.borrower_name}`
                }
              >
                {loan.note}
              </Alert>
            )}

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
                styles={WRAP_LONG_WORDS}
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
                {/* Households, matching the count the send confirmation gave —
                    and singular when only one was asked, which "Alle 1 spurgte
                    husstande" was not. The count can also reach zero: removing a
                    car takes its candidacy with it (CarLoanCandidate.car is
                    CASCADE), and "Alle 0 spurgte husstande har sagt nej" is not a
                    sentence to show anyone. */}
                <Text size="sm" fw={500}>
                  {householdsAsked(loan) === 0
                    ? "Der er ikke flere at afvente svar fra."
                    : householdsAsked(loan) === 1
                      ? "Husstanden du spurgte, kan ikke låne ud — der er ikke flere at afvente svar fra."
                      : `Alle ${householdsAsked(loan)} spurgte husstande har sagt nej — der er ikke flere at afvente svar fra.`}
                </Text>
                <Text size="xs" c="dimmed">
                  Prøv et andet tidsrum, eller spørg flere biler.
                </Text>
              </Stack>
            )}

            {/* Owner: answer a request about your own car. The status check is
                redundant with viewer_role today and deliberately kept: an
                answerable request is by definition still open. */}
            {loan.viewer_role === "asked" && loan.status === "requested" && (
              <Stack gap="xs">
                {unanswered.map((candidate) => (
                  <Group key={candidate.id} justify="space-between" wrap="wrap">
                    <Text size="sm">{candidate.car_display_name}</Text>
                    {/* sm, not xs, with a real gap: these were 30px tall and
                        10px apart, and "Nej" ends a neighbour's whole request
                        with no way back. */}
                    <Group gap="sm">
                      <Button
                        size="sm"
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
                        size="sm"
                        variant="default"
                        // "Ja" had a loading guard and "Nej" did not, so an
                        // impatient second tap produced a green "Du har sagt
                        // nej" beside a red "Kunne ikke svare".
                        loading={respondMutation.isPending}
                        // Only the irreversible answer asks. Confirming "Ja"
                        // would tax the commonest, most desirable action in the
                        // feature forever to guard against a cheap mistake.
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Sig nej til at låne ${candidate.car_display_name} ud til ${loan.borrower_name}?`,
                            )
                          )
                            return
                          respondMutation.mutate({
                            candidateId: candidate.id,
                            action: "decline",
                          })
                        }}
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
                <Text size="sm" fw={500}>
                  {describeSettlement(loan)}
                </Text>
                <Text size="xs" c="dimmed">
                  {settlementBreakdown(loan)}
                </Text>
                {/* The preview says how to settle; the settled card used to drop
                    it, which is the moment it actually matters. */}
                <SettleInstruction loan={loan} />
              </Stack>
            )}

            {/* Neutral on purpose: this line carries "tak for lån" as often as
                it carries a scratch, and an orange warning triangle turned every
                courtesy into something the owner had to brace for. */}
            {loan.status === "completed" && loan.damage_note && (
              <Alert
                icon={<IconMessage2 size={18} />}
                color="gray"
                variant="light"
                styles={WRAP_LONG_WORDS}
                title={loan.is_borrower ? "Din besked" : "Besked fra låneren"}
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
                    Lånet starter {formatDateTime(loan.start_at)} — afslut det
                    først når du har haft bilen.
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
                size="compact-xs"
                // Not a full-width red target 10px under the primary "Afslut
                // lån": cancelling an active loan silently voids the km bill.
                style={{ alignSelf: "flex-start" }}
                mt="sm"
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
