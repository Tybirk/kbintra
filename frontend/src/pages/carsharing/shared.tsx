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

export function formatWindow(start: string, end: string): string {
  const from = dayjs(start)
  const to = dayjs(end)
  if (from.isSame(to, "day")) {
    return `${from.format("D. MMM YYYY HH:mm")}–${to.format("HH:mm")}`
  }
  return `${from.format("D. MMM YYYY HH:mm")} til ${to.format("D. MMM YYYY HH:mm")}`
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
  }
  return text
}

/** The settled amount, with a direction and in the second person. */
export function describeSettlement(loan: CarLoan): string {
  const amount = Number.parseFloat(loan.amount_due ?? "0") || 0
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
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) {
    return `Skriv kun ${label}, fx 50,50.`
  }
  return null
}

export function errorMessage(error: unknown, fallback: string): string {
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
  errorTitle: string
  errorFallback?: string
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
        title: errorTitle,
        message: errorMessage(error, errorFallback),
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
        <Checkbox
          label={label}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </Stack>
    </Card>
  )
}
