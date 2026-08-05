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
      <Title order={2} mb="xs">
        Bildeling
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Et overblik og en lommeregner. Et lån bliver til, når en ejer siger ja —
        resten aftaler I selv.
      </Text>

      <Tabs value={tab} onChange={selectTab}>
        <Tabs.List grow>
          <Tabs.Tab value="borrow">Lån en bil</Tabs.Tab>
          <Tabs.Tab value="loans">Mine lån</Tabs.Tab>
          <Tabs.Tab value="cars">Mine biler</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="borrow">
          <BorrowTab onRequested={() => selectTab("loans")} />
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
