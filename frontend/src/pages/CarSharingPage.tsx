import { Badge, Container, Tabs, Text, Title } from "@mantine/core"

import { useMediaQuery } from "@mantine/hooks"

import { useQuery } from "@tanstack/react-query"

import { useNavigate, useParams, useSearchParams } from "react-router-dom"

import { carSharingApi } from "../api/carsharing"

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

  // A neighbour asking for your car is the one thing here that is waiting on
  // *you*, and the page opened on "Lån en bil" — a list of other people's cars —
  // with nothing anywhere to say so. Only the global header bell knew.
  //
  // Same query key as MyLoansTab, so this is the cache that tab already fills
  // rather than a second request.
  const { data: loans } = useQuery({
    queryKey: ["carsharing", "loans"],
    queryFn: carSharingApi.getLoans,
  })
  const awaitingMyAnswer = (loans ?? []).filter(
    (loan) => loan.viewer_role === "asked" && loan.status === "requested",
  ).length

  // A phone held sideways has ~390px of height, and the standfirst plus the page
  // padding spent a fifth of it on prose. That pushed the date fields down under
  // the sticky send bar, where a thumb aiming at "Fra" hit "Send forespørgsel".
  const shortViewport = useMediaQuery("(max-height: 30em)")

  function selectTab(value: string | null) {
    if (!value) return
    if (highlightLoanId) navigate(`/bildeling?tab=${value}`)
    else setSearchParams(value === "borrow" ? {} : { tab: value })
  }

  return (
    <Container size="md" py={shortViewport ? "xs" : "md"}>
      <Title order={2} mb="xs">
        Bildeling
      </Title>
      {/* Dropped in landscape: it is an orientation sentence a resident reads
          once, and the pixels it costs are the ones the date fields need to
          clear the sticky bar. */}
      {!shortViewport && (
        <Text size="sm" c="dimmed" mb="md">
          Et overblik og en lommeregner. Et lån bliver til, når en ejer siger ja
          — resten aftaler I selv.
        </Text>
      )}

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
          <Tabs.Tab
            value="loans"
            rightSection={
              awaitingMyAnswer > 0 ? (
                <Badge
                  size="sm"
                  circle
                  color="red"
                  aria-label="Venter på dit svar"
                >
                  {awaitingMyAnswer}
                </Badge>
              ) : null
            }
          >
            Mine lån
          </Tabs.Tab>
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
