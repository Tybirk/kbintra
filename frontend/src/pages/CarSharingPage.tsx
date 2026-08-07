import { Container, Tabs, Text, Title } from "@mantine/core"

import { useNavigate, useParams, useSearchParams } from "react-router-dom"

import { BorrowTab } from "./carsharing/BorrowTab"

import { MyCarsTab } from "./carsharing/MyCarsTab"

import { MyLoansTab } from "./carsharing/MyLoansTab"

// --- Page --------------------------------------------------------------------

const TABS = ["borrow", "loans", "cars"]

export default function CarSharingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightLoanId = id ? Number(id) : null

  // The tab lives in the URL so a reload mid-edit does not drop an owner back on
  // "Lån en bil", and so a link can point at the right tab.
  const requested = searchParams.get("tab")
  const tab = highlightLoanId
    ? "loans"
    : requested && TABS.includes(requested)
      ? requested
      : "borrow"

  function selectTab(value: string | null) {
    if (!value) return
    if (highlightLoanId) navigate(`/bildeling?tab=${value}`)
    else setSearchParams(value === "borrow" ? {} : { tab: value })
  }

  return (
    <Container size="md" py="md">
      {/* The navbar entry stays "Bildeling" — this says so on the page itself,
          where a resident who arrived from a notification or a shared link also
          sees it. Remove the parenthesis when the feature goes live for real. */}
      <Title order={2} mb="xs">
        Bildeling (kun til test)
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Et overblik og en lommeregner. Et lån bliver til, når en ejer siger ja —
        resten aftaler I selv.
      </Text>

      {/* keepMounted={false} is not the default, and the default is wrong here.
          Sending a request navigates to the new loan, which switches tab while
          leaving BorrowTab mounted behind it — Mantine hides an inactive panel
          with React's <Activity>, which preserves state by design. The send
          button therefore kept the loading state the finished request had put it
          in, and coming back to borrow a second car met a blank blue bar that
          could not be clicked. An unmounted tab cannot carry a spent request's
          state into the next one. */}
      <Tabs value={tab} onChange={selectTab} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="borrow">Lån en bil</Tabs.Tab>
          <Tabs.Tab value="loans">Mine lån</Tabs.Tab>
          <Tabs.Tab value="cars">Mine biler</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="borrow">
          {/* Land on the new request itself, not just on the tab: the loan was
              handed to this callback and thrown away, so the card a borrower had
              just created was the one card that never got highlighted. */}
          <BorrowTab
            onRequested={(loan) => navigate(`/bildeling/laan/${loan.id}`)}
          />
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
