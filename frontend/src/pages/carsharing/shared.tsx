/**
 * Pieces every bildeling tab needs: formatting, the money validator, the mutation
 * wrapper that guarantees feedback, and the terms both sides have to accept.
 */

import { useState } from "react"

import {
  Button,
  Card,
  Checkbox,
  Collapse,
  List,
  Stack,
  Text,
  Title,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import dayjs from "dayjs"

import { carSharingApi } from "../../api/carsharing"

import { normalizeDecimalSeparator } from "../../utils/decimalInput"

import type { CarConflict, CarLoan, CarSharingTerms } from "../../types"

export interface ConflictMeta {
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

export function conflictMeta(conflict: CarConflict): ConflictMeta | null {
  return conflict ? CONFLICT_META[conflict] : null
}

export function formatKr(amount: number | string): string {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount)
  if (Number.isNaN(value)) return `${amount} kr.`
  return `${value.toLocaleString("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr.`
}

/** A car's km-rate as a borrower reads it. Zero is a real choice — an owner
 *  lending for nothing — and "0,00 kr./km" buries the one thing worth noticing. */
export function formatRatePerKm(rate: number | string): string {
  const value = typeof rate === "number" ? rate : Number.parseFloat(rate)
  if (value === 0) return "Gratis"
  return `${formatKr(rate)}/km`
}

/**
 * One date vocabulary for bildeling, weekday first.
 *
 * "Hvornår skal bilen bruges" is a question about the day of the week before it
 * is one about the date: a borrower planning a Saturday trip, and an owner
 * checking whether that is a workday, both had to count from "12. jun." on their
 * own. The Danish dayjs locale renders `ddd` as "man.", "tir.", … (set in
 * main.tsx and in the test setup).
 */
export const SHORT_DATE_TIME = "ddd D. MMM HH:mm"

/** The same, with the year — for a window that may be months old or ahead. */
export const LONG_DATE_TIME = "ddd D. MMM YYYY HH:mm"

/** A single moment, e.g. "man. 12. jun. 09:00". */
export function formatDateTime(value: string): string {
  return dayjs(value).format(SHORT_DATE_TIME)
}

export function formatWindow(start: string, end: string): string {
  const from = dayjs(start)
  const to = dayjs(end)
  if (from.isSame(to, "day")) {
    return `${from.format(LONG_DATE_TIME)}–${to.format("HH:mm")}`
  }
  return `${from.format(LONG_DATE_TIME)} til ${to.format(LONG_DATE_TIME)}`
}

/**
 * Why an amount is what it is: km × takst, minus the borrower's own outlay.
 *
 * The owner's card used to show the total alone, which cannot be reconciled
 * against the kilometres beside it once anything was deducted — and neighbours
 * settle this by MobilePay, so a number nobody can check is the wrong number.
 */
export function settlementBreakdown(loan: CarLoan): string {
  const rate = loan.rate_per_km ?? "0"
  const expenses = Number.parseFloat(loan.expense_amount ?? "0") || 0
  let text = `${loan.actual_km ?? 0} km × ${formatKr(rate)}`
  if (expenses > 0) {
    text += ` − ${formatKr(expenses)} i udgifter`
    if (loan.expense_note) text += ` (${loan.expense_note})`
  } else if (loan.expense_note) {
    // A note with no amount behind it. The borrower wrote something and used to
    // be the only person who ever saw it: this clause hung off "expenses > 0",
    // so a note entered against a 0 kr. expense was stored and shown to nobody.
    text += ` · Udgifter: ${loan.expense_note}`
  }
  return text
}

/** The settled amount, with a direction and in the second person. */
export function describeSettlement(loan: CarLoan): string {
  const amount = Number.parseFloat(loan.amount_due ?? "0") || 0
  // Nothing owed either way — a free car, or expenses that cancelled the bill.
  // "Du skal betale 0,00 kr." invites a 0 kr. MobilePay transfer.
  if (amount === 0) return "Intet at betale"
  const owedToBorrower = amount < 0
  const sum = formatKr(Math.abs(amount))
  if (loan.is_borrower) {
    return owedToBorrower ? `Du får ${sum} tilbage` : `Du skal betale ${sum}`
  }
  return owedToBorrower
    ? `Du skylder ${loan.borrower_name} ${sum}`
    : `${loan.borrower_name} skal betale dig ${sum}`
}

/**
 * One validator for every money field, so the preview and the payload agree.
 *
 * The expense field used to preview with one parser and submit with another, so
 * natural Danish input like "50 kr" or "50,-" showed a tidy total and was then
 * rejected by the server in English.
 */
export function moneyInputError(value: string, label: string): string | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const normalised = normalizeDecimalSeparator(trimmed)
  // The pattern below already excludes a minus sign, which is the only thing an
  // amount here can be wrong about. Zero is valid for both an expense and a
  // km-rate: an owner may lend their car for nothing.
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) {
    // "fx 50,50" sat directly under a description saying the community rate is
    // 3,94 kr./km — an example a dozen times any realistic value.
    return `Skriv kun ${label}, fx 3,94.`
  }
  return null
}

export function errorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: unknown } })?.response
  const data = response?.data
  // An unhandled 5xx answers with an HTML page, and a string body used to be
  // passed straight through — so a Django debug page arrived as 77 kB of markup
  // inside a toast, model names and all. Nothing renderable to a resident ever
  // starts with a tag, so this both fixes that and contains the next one.
  if (typeof data === "string") {
    return data.trimStart().startsWith("<") ? fallback : data
  }
  if (data && typeof data === "object") {
    const first = Object.values(data as Record<string, unknown>)[0]
    if (Array.isArray(first) && typeof first[0] === "string") return first[0]
    if (typeof first === "string") return first
  }
  return fallback
}

/**
 * A mutation that always reports its outcome.
 *
 * `cancelMutation` once had `onSuccess` only, and `classifyError` in api/client.ts
 * returns "other" for a non-5xx while `reportToast` ignores "other" — so a 403
 * failed completely silently and residents clicked the same dead button again and
 * again. Going through this wrapper makes "no feedback" impossible to write by
 * accident.
 */
interface CarSharingMutationOptions<TArgs, TResult> {
  mutationFn: (args: TArgs) => Promise<TResult>
  successTitle?: string | ((result: TResult) => string)
  successMessage?: string | ((result: TResult) => string)
  /**
   * A function when one press can fail in more than one way. The car card saves
   * two endpoints behind a single button, so it has to be able to say which half
   * failed instead of reporting a save that half-landed as a plain failure.
   */
  errorTitle: string | ((error: unknown) => string)
  errorFallback?: string | ((error: unknown) => string)
  onDone?: (result: TResult) => void
}

export function useCarSharingMutation<TArgs, TResult>({
  mutationFn,
  successTitle,
  successMessage,
  errorTitle,
  errorFallback = "Prøv igen.",
  onDone,
}: CarSharingMutationOptions<TArgs, TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (result: TResult) => {
      if (successTitle) {
        notifications.show({
          title:
            typeof successTitle === "function"
              ? successTitle(result)
              : successTitle,
          message:
            typeof successMessage === "function"
              ? successMessage(result)
              : (successMessage ?? ""),
          color: "green",
        })
      }
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
      onDone?.(result)
    },
    onError: (error: unknown) => {
      notifications.show({
        title:
          typeof errorTitle === "function" ? errorTitle(error) : errorTitle,
        message: errorMessage(
          error,
          typeof errorFallback === "function"
            ? errorFallback(error)
            : errorFallback,
        ),
        color: "red",
      })
      // Refetch on failure too: the usual cause is a card that has gone stale
      // (someone else answered first), and it should heal rather than sit there.
      queryClient.invalidateQueries({ queryKey: ["carsharing"] })
    },
  })
}

// --- Terms, which both sides of a loan have to accept ------------------------

/**
 * One query for the terms, shared by the borrow tab and every car card. Same key
 * for all of them, so react-query fetches once and serves the rest from cache.
 */
export function useCarSharingTerms() {
  return useQuery({
    queryKey: ["carsharing", "terms"],
    queryFn: carSharingApi.getTerms,
  })
}

interface TermsConsentProps {
  terms: CarSharingTerms
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** Nested inside another card, so it reads as a subsection rather than a peer. */
  compact?: boolean
  /** Framing for a reader the terms are not addressed to — the owner. */
  intro?: string
  /** Fold the terms away, so a long list cannot push the consent off-screen. */
  collapsible?: boolean
  /**
   * Render the terms without their tick, because the caller puts the checkbox
   * somewhere the reader can always reach — the borrow tab keeps it in the
   * sticky bar, which would otherwise sit on top of it.
   */
  hideCheckbox?: boolean
}

/**
 * The terms, the version they carry, and the tick that accepts them. The same
 * component serves the borrower before a request and the owner before sharing a
 * car, so neither can end up showing a different text or dropping the version.
 */
export function TermsConsent({
  terms,
  label,
  checked,
  onChange,
  compact = false,
  intro,
  collapsible = false,
  hideCheckbox = false,
}: TermsConsentProps) {
  const heading = terms.title ?? "Vilkår"
  // Collapsed by default when folding is on: the checkbox stays outside the fold
  // so consent is always one tap away, however long the terms get.
  const [open, setOpen] = useState(!collapsible)
  const body = (
    <Stack gap="md">
      {(terms.sections ?? []).map((section) => (
        <Stack gap="xs" key={section.heading}>
          <Text size="sm" fw={600}>
            {section.heading}
          </Text>
          {(section.blocks ?? []).map((block, index) =>
            block.kind === "bullets" ? (
              <List size="sm" spacing="xs" key={index}>
                {(block.items ?? []).map((item) => (
                  <List.Item key={item.lead + item.text}>
                    {item.lead && (
                      <Text
                        component="span"
                        fw={600}
                        inherit
                      >{`${item.lead} `}</Text>
                    )}
                    {item.text}
                  </List.Item>
                ))}
              </List>
            ) : (
              <Text size="sm" key={index}>
                {block.text}
              </Text>
            ),
          )}
        </Stack>
      ))}
    </Stack>
  )

  return (
    <Card
      withBorder
      radius={compact ? "sm" : "md"}
      padding={compact ? "sm" : "md"}
    >
      <Stack gap="xs">
        {compact ? (
          <Text size="sm" fw={600}>
            {heading}
          </Text>
        ) : (
          <Title order={4}>{heading}</Title>
        )}
        {intro && (
          <Text size="sm" c="dimmed">
            {intro}
          </Text>
        )}
        {collapsible ? (
          <>
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              style={{ alignSelf: "flex-start" }}
            >
              {open ? "Skjul vilkårene" : "Læs vilkårene"}
            </Button>
            <Collapse expanded={open} keepMounted={false}>
              {body}
            </Collapse>
          </>
        ) : (
          body
        )}
        <Text size="xs" c="dimmed">
          Version {terms.version}
        </Text>
        {!hideCheckbox && (
          <Checkbox
            label={label}
            checked={checked}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
        )}
      </Stack>
    </Card>
  )
}
