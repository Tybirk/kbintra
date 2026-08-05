import { Center, Divider, Loader, Stack, Text } from "@mantine/core"

import { useQuery } from "@tanstack/react-query"

import { carSharingApi } from "../../api/carsharing"

import { LoanCard } from "./LoanCard"

import type { CarLoan } from "../../types"

interface MyLoansTabProps {
  highlightLoanId: number | null
}

export function MyLoansTab({ highlightLoanId }: MyLoansTabProps) {
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

  // Two lists, and every status must land in exactly one of them — a loan that
  // matches neither disappears from the page altogether.
  const isOpen = (loan: CarLoan) =>
    loan.status === "requested" || loan.status === "active"
  const open = (loans ?? []).filter(isOpen)
  const closed = (loans ?? []).filter((loan) => !isOpen(loan))

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
