import { useState, useEffect } from "react"

import { useNavigate, useParams } from "react-router-dom"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Stack,
  Badge,
  SegmentedControl,
  SimpleGrid,
  Tabs,
  Modal,
  Textarea,
  ActionIcon,
  Table,
  Card,
  NumberInput,
  Avatar,
  Menu,
  Box,
  ThemeIcon,
  Collapse,
  UnstyledButton,
  Divider,
  Anchor,
  TextInput,
  Tooltip,
  Alert,
  Checkbox,
} from "@mantine/core"

import {
  useDisclosure,
  useDebouncedCallback,
  useClipboard,
} from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import { DatePickerInput } from "@mantine/dates"

import {
  IconCalendar,
  IconCalendarOff,
  IconTicket,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  IconReceipt,
  IconLock,
  IconTrash,
  IconDotsVertical,
  IconWallet,
  IconCopy,
  IconChevronDown,
  IconChevronUp,
  IconUsers,
  IconExternalLink,
  IconRefresh,
  IconDownload,
  IconCoins,
  IconInfoCircle,
  IconAlertTriangle,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

import { foodApi } from "../api/food"

import { notificationsApi } from "../api/notifications"

import { MealFormFields } from "../components/MealFormFields"

import { useAuthStore } from "../store/authStore"

import {
  calculateDefaultTicketPrice,
  resolvePrices,
} from "../utils/priceCalculation"

import { useMealPrices, MEAL_PRICES_QUERY_KEY } from "../hooks/useMealPrices"

import { isDateLocked, isAfterTicketSaleCutoff } from "../utils/foodDeadline"

import { copyToClipboard } from "../utils/clipboard"

import type {
  MealRegistration,
  CreateMealRegistrationData,
  CreateFoodTicketData,
  DiningOption,
  SeatingTime,
  DriveMenu,
  FoodTicket,
  DailyRegistrationStats,
  ClosedDayPlaceholder,
  WeeklyRegistrationStats,
  MealPrice,
} from "../types"

import { isClosedDayPlaceholder, isClosedDayStats } from "../types"

// The stats endpoint returns a closed-day marker for closed dates.

// Normalise to `undefined` so widgets treat them as "no stats".

function getDailyStats(
  weekly: WeeklyRegistrationStats | undefined,

  dateStr: string,
): DailyRegistrationStats | undefined {
  const entry = weekly?.[dateStr]

  if (!entry || isClosedDayStats(entry)) return undefined

  return entry
}

export default function FoodPage() {
  const navigate = useNavigate()

  const { tab } = useParams<{ tab?: string }>()

  const queryClient = useQueryClient()

  const { user } = useAuthStore()

  const canFoodAdmin = !!(user?.is_staff || user?.is_food_admin)

  // Economy admins (the treasurer) may view the cost report, but not the
  // operational food-admin tools (closed days, etc.).
  const canEconomyAdmin = !!(user?.is_staff || user?.is_economy_admin)

  const canSeeAdminTab = canFoodAdmin || canEconomyAdmin

  const { data: mealPrices } = useMealPrices()

  // Path-based tab state

  const validTabs = ["tilmelding", "billetter", "okonomi", "admin"]

  const activeTab = tab && validTabs.includes(tab) ? tab : "tilmelding"

  const setActiveTab = (newTab: string | null) => {
    if (newTab && newTab !== "tilmelding") {
      navigate(`/mad/${newTab}`)
    } else {
      navigate("/mad")
    }
  }

  // Get current week's Monday

  const today = dayjs()

  const currentWeekStart = today.startOf("isoWeek") // Monday

  // Week offset state for registration view - defaults to next week (1)

  const [regWeekOffset, setRegWeekOffset] = useState(1)

  const regWeekStart = currentWeekStart.add(regWeekOffset, "week")

  // Calculate week number and year for drive menus

  const regWeekNumber = regWeekStart.isoWeek()

  const regYear = regWeekStart.isoWeekYear()

  // Fetch drive menu for the registration week

  const { data: regDriveMenu } = useQuery({
    queryKey: ["food", "drive-menu", regWeekNumber, regYear],

    queryFn: () => foodApi.getDriveMenu(regWeekNumber, regYear),
  })

  // Mutation to refresh drive menu from Google Drive (admin only)

  const refreshDriveMenuMutation = useMutation({
    mutationFn: () => foodApi.refreshDriveMenu(regWeekNumber, regYear),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "drive-menu", regWeekNumber, regYear],
      })

      notifications.show({
        color: "green",

        message: "Menuen er blevet opdateret fra Google Drive.",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke opdatere menuen fra Google Drive.",
      )
    },
  })

  // Fetch registrations for the selected registration week

  const { data: registrations, isLoading: regsLoading } = useQuery({
    queryKey: ["food", "registrations", regWeekStart.format("YYYY-MM-DD")],

    queryFn: () => foodApi.getRegistrations(regWeekStart.format("YYYY-MM-DD")),
  })

  // Fetch community stats for the selected week

  const { data: weeklyStats } = useQuery({
    queryKey: ["food", "stats", regWeekStart.format("YYYY-MM-DD")],

    queryFn: () =>
      foodApi.getRegistrationStats(regWeekStart.format("YYYY-MM-DD")),
  })

  // Fetch user's tickets to check for active tickets when switching eating status

  const { data: myTickets } = useQuery({
    queryKey: ["food", "tickets", "my"],

    queryFn: foodApi.getMyTickets,
  })

  // Fetch available tickets for the billetter tab

  const { data: availableTickets } = useQuery({
    queryKey: ["food", "tickets", "available"],

    queryFn: () => foodApi.getTickets(),
  })

  // Create a map of my tickets (owned) by date

  const myTicketsByDate = new Map<string, FoodTicket[]>()

  myTickets?.forEach((ticket) => {
    if (ticket.is_own) {
      const existing = myTicketsByDate.get(ticket.date) ?? []

      myTicketsByDate.set(ticket.date, [...existing, ticket])
    }
  })

  // Create a map of purchased (claimed by me) tickets by date

  const myPurchasedByDate = new Map<string, FoodTicket[]>()

  myTickets?.forEach((ticket) => {
    if (!ticket.is_own && !ticket.is_available) {
      const existing = myPurchasedByDate.get(ticket.date) ?? []

      myPurchasedByDate.set(ticket.date, [...existing, ticket])
    }
  })

  // Filter tickets for billetter tab sections

  const myTicketsForSale =
    myTickets?.filter(
      (t) =>
        t.is_own && t.is_available && !dayjs(t.date).isBefore(dayjs(), "day"),
    ) ?? []

  const mySoldTickets =
    myTickets?.filter((t) => t.is_own && !t.is_available) ?? []

  const myPurchasedTickets =
    myTickets?.filter((t) => !t.is_own && !t.is_available) ?? []

  const othersAvailableTickets =
    availableTickets?.filter((t) => !t.is_own && t.is_available) ?? []

  // Helper to get menu text for a specific day offset (0=Mon, 1=Tue, 2=Wed, 3=Thu)

  const getMenuTextForDay = (
    menu: DriveMenu | undefined,

    dayOffset: number,
  ): string => {
    if (!menu) return ""

    switch (dayOffset) {
      case 0:
        return menu.monday_menu

      case 1:
        return menu.tuesday_menu

      case 2:
        return menu.wednesday_menu

      case 3:
        return menu.thursday_menu

      default:
        return ""
    }
  }

  // Auto-mark food-ticket notifications as read when billetter tab is active

  useEffect(() => {
    if (activeTab === "billetter") {
      notificationsApi
        .markReadByLink("/mad/billetter")
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] })

          queryClient.invalidateQueries({
            queryKey: ["notifications", "unread-count"],
          })
        })
        .catch(() => {})
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetToDefaultsMutation = useMutation({
    mutationFn: async () => {
      if (!registrations) return

      const deletable = registrations.filter(
        (r) => r.id !== null && !isDateLocked(r.date),
      )

      await Promise.all(
        deletable.map((r) => foodApi.deleteRegistration(r.id as number)),
      )
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "registrations"] })

      queryClient.invalidateQueries({ queryKey: ["food", "stats"] })

      notifications.show({
        title: "Nulstillet",

        message: "Tilmeldinger nulstillet til standardpræferencer.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke nulstille tilmeldinger.")
    },
  })

  const isLoading = regsLoading

  // Create a map of registrations by date for registration tab

  // The API returns closed-day placeholders with is_closed: true

  const registrationsByDate = new Map<string, MealRegistration>()

  const closedDaysByDate = new Map<string, ClosedDayPlaceholder>()
  ;(registrations as (MealRegistration | ClosedDayPlaceholder)[] | undefined)?.forEach(
    (reg) => {
      if (isClosedDayPlaceholder(reg)) {
        closedDaysByDate.set(reg.date, reg)
      } else {
        registrationsByDate.set(reg.date, reg)
      }
    },
  )

  // Whole-week lock state (deadline is the same Wed for all 4 days of the week)

  const weekIsLocked = isDateLocked(regWeekStart.format("YYYY-MM-DD"))

  // Aggregate weekly budget and per-day shopping numbers from stats

  let weeklyBudget = 0

  const purchaseColumns: number[] = []

  for (let i = 0; i < 4; i++) {
    const dateStr = regWeekStart.add(i, "day").format("YYYY-MM-DD")

    const stats = getDailyStats(weeklyStats, dateStr)

    // Budget is an income figure: use gross registrations, not effective
    // portions. Available (unsold) tickets must NOT reduce it — the seller is
    // still billed for their registration regardless of whether it sells.
    const veg = stats?.total_registrations.adults_veg ?? 0

    const meat = stats?.total_registrations.adults_meat ?? 0

    const kids = stats?.total_registrations.children ?? 0

    // Priced per day, so a week straddling a price change budgets correctly.
    weeklyBudget += calculateDefaultTicketPrice(
      mealPrices,
      dateStr,
      meat,
      veg,
      kids,
    )

    purchaseColumns.push(veg, 0, meat, kids)
  }

  const purchaseTSV = purchaseColumns.join("\t")

  // Helper to get week label

  const getWeekLabel = (offset: number) => {
    if (offset === 0) return "Denne uge"

    if (offset === 1) return "Næste uge"

    if (offset === -1) return "Sidste uge"

    return `${offset > 0 ? "+" : ""}${offset} uger`
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Mad</Title>

          <Text c="dimmed">Ugemenu og måltidstilmelding</Text>
        </div>
        <Group>
          <Button
            variant="light"
            leftSection={<IconSettings size={16} />}
            onClick={() => navigate("/mad/praeferencer")}
          >
            Præferencer
          </Button>
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="tilmelding" leftSection={<IconCalendar size={16} />}>
            Menu og Tilmelding
          </Tabs.Tab>
          <Tabs.Tab value="billetter" leftSection={<IconTicket size={16} />}>
            Billetter
          </Tabs.Tab>
          <Tabs.Tab value="okonomi" leftSection={<IconWallet size={16} />}>
            Økonomi
          </Tabs.Tab>
          {canSeeAdminTab && (
            <Tabs.Tab value="admin" leftSection={<IconSettings size={16} />}>
              Admin
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="tilmelding">
          <Stack gap="md">
            {/* Week Navigation */}
            <Paper withBorder p="sm" radius="md">
              <Group justify="space-between">
                <ActionIcon
                  variant="light"
                  size="lg"
                  onClick={() => setRegWeekOffset(regWeekOffset - 1)}
                  disabled={regWeekOffset <= 0}
                >
                  <IconChevronLeft size={20} />
                </ActionIcon>

                <Stack gap={0} align="center">
                  <Text fw={500}>
                    {regWeekStart.format("D. MMM")} -{" "}
                    {regWeekStart.add(3, "day").format("D. MMM")}
                  </Text>
                  <Badge
                    color={
                      regWeekOffset === 1
                        ? "green"
                        : regWeekOffset === 0
                          ? "blue"
                          : "gray"
                    }
                    variant="light"
                    size="sm"
                  >
                    {getWeekLabel(regWeekOffset)}
                  </Badge>
                  {regDriveMenu?.drive_folder_url && (
                    <Anchor
                      href={regDriveMenu.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      c="dimmed"
                      mt={4}
                    >
                      <Group gap={4}>
                        <IconExternalLink size={12} />
                        Se menu i Drive
                      </Group>
                    </Anchor>
                  )}
                </Stack>

                <ActionIcon
                  variant="light"
                  size="lg"
                  onClick={() => setRegWeekOffset(regWeekOffset + 1)}
                >
                  <IconChevronRight size={20} />
                </ActionIcon>
              </Group>
            </Paper>

            <Group justify="space-between">
              {canFoodAdmin ? (
                <Group gap="xs">
                  {regDriveMenu?.is_stale && (
                    <Badge color="yellow" variant="light" size="sm">
                      Menu kan være forældet
                    </Badge>
                  )}
                  <Button
                    variant="light"
                    size="sm"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => refreshDriveMenuMutation.mutate()}
                    loading={refreshDriveMenuMutation.isPending}
                  >
                    Opdater fra Google Drive
                  </Button>
                </Group>
              ) : (
                <div />
              )}
              <Group gap="xs">
                {canFoodAdmin && (
                  <Stack gap={0} style={{ lineHeight: 1.1 }}>
                    <Text size="xs" c="dimmed">
                      Budget (inkl. moms): {weeklyBudget} kr.
                    </Text>
                    <Text size="xs" c="dimmed">
                      Budget (ekskl. moms): {Math.round(weeklyBudget * 0.8)} kr.
                    </Text>
                  </Stack>
                )}
                {canFoodAdmin && weekIsLocked && (
                  <Button
                    variant="light"
                    size="sm"
                    leftSection={<IconCopy size={14} />}
                    onClick={async () => {
                      const copied = await copyToClipboard(purchaseTSV)

                      if (copied) {
                        notifications.show({
                          color: "green",

                          message: "Indkøbstal kopieret til udklipsholder.",
                        })
                      } else {
                        notifications.show({
                          color: "red",

                          message:
                            "Kunne ikke kopiere automatisk. Prøv at markere tallene og kopiere manuelt.",
                        })
                      }
                    }}
                  >
                    Kopier indkøbstal
                  </Button>
                )}
                {registrations?.some(
                  (r) => r.id !== null && !isDateLocked(r.date),
                ) && (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => resetToDefaultsMutation.mutate()}
                    loading={resetToDefaultsMutation.isPending}
                  >
                    Nulstil til standardpræferencer
                  </Button>
                )}
              </Group>
            </Group>

            {isLoading ? (
              <Center h={200}>
                <Loader size="lg" />
              </Center>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {[0, 1, 2, 3].map((dayOffset) => {
                  const date = regWeekStart.add(dayOffset, "day")

                  const dateStr = date.format("YYYY-MM-DD")

                  const closedDay = closedDaysByDate.get(dateStr)

                  if (closedDay) {
                    return (
                      <Paper
                        key={dateStr}
                        withBorder
                        p="md"
                        radius="md"
                        opacity={0.6}
                      >
                        <Group justify="space-between">
                          <Text fw={500}>{date.format("dddd")}</Text>
                          <Badge color="gray">Lukket</Badge>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {date.format("D. MMMM")}
                        </Text>
                        {closedDay.closed_reason && (
                          <Text size="sm" c="dimmed" mt="xs">
                            {closedDay.closed_reason}
                          </Text>
                        )}
                      </Paper>
                    )
                  }

                  const registration = registrationsByDate.get(dateStr)

                  const menuText = getMenuTextForDay(regDriveMenu, dayOffset)

                  const isWednesday = dayOffset === 2

                  const isPast = date.isBefore(dayjs(), "day")

                  return (
                    <DayRegistrationCard
                      key={dateStr}
                      date={dateStr}
                      dayName={date.format("dddd")}
                      registration={registration}
                      menuText={menuText}
                      isWednesday={isWednesday}
                      isPast={isPast}
                      weekStart={regWeekStart.format("YYYY-MM-DD")}
                      ticketsForDate={myTicketsByDate.get(dateStr) ?? []}
                      purchasedTicketsForDate={
                        myPurchasedByDate.get(dateStr) ?? []
                      }
                      communityStats={getDailyStats(weeklyStats, dateStr)}
                    />
                  )
                })}
              </SimpleGrid>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="billetter">
          <Stack gap="md">
            <Paper
              withBorder
              p="sm"
              radius="md"
              bg="var(--mantine-color-orange-light)"
            >
              <Group gap="sm">
                <ThemeIcon color="orange" variant="light" size="md">
                  <IconTicket size={16} />
                </ThemeIcon>
                <Text size="sm">
                  For at udbyde en billet, gå til{" "}
                  <Text
                    span
                    fw={600}
                    style={{ cursor: "pointer" }}
                    onClick={() => setActiveTab("tilmelding")}
                  >
                    Menu og Tilmelding
                  </Text>{" "}
                  eller{" "}
                  <Text
                    span
                    fw={600}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate("/")}
                  >
                    Forsiden
                  </Text>{" "}
                  og klik på &quot;Sælg billet&quot; på den ønskede dag (vises
                  når tilmeldingsfristen er passeret).
                </Text>
              </Group>
            </Paper>

            <div>
              <Text fw={500} mb="xs">
                Mine til salg
              </Text>
              {myTicketsForSale.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Du har ingen billetter til salg
                </Text>
              ) : (
                <Stack gap="sm">
                  {myTicketsForSale.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))}
                </Stack>
              )}
            </div>

            {mySoldTickets.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Mine solgte billetter
                </Text>
                <Stack gap="sm">
                  {mySoldTickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))}
                </Stack>
              </div>
            )}

            <div>
              <Text fw={500} mb="xs">
                Mine købte billetter
              </Text>
              {myPurchasedTickets.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Du har ikke købt nogen billetter
                </Text>
              ) : (
                <Stack gap="sm">
                  {myPurchasedTickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))}
                </Stack>
              )}
            </div>

            <div>
              <Text fw={500} mb="xs">
                Tilgængelige fra andre
              </Text>
              {othersAvailableTickets.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Ingen billetter tilgængelige fra andre
                </Text>
              ) : (
                <Stack gap="sm">
                  {othersAvailableTickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))}
                </Stack>
              )}
            </div>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="okonomi">
          <MyFoodExpenses />
        </Tabs.Panel>

        {canSeeAdminTab && (
          <Tabs.Panel value="admin">
            <Stack gap="xl">
              {canFoodAdmin && (
                <>
                  <ClosedDaysAdmin />
                  <Divider />
                  <MealPricesAdmin />
                  <Divider />
                </>
              )}
              <MonthlyCostReport />
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  )
}

// Closed Days Admin Component

function ClosedDaysAdmin() {
  const queryClient = useQueryClient()

  const [selectedDates, setSelectedDates] = useState<Date[]>([])

  const [reason, setReason] = useState("")

  const { data: closedDays, isLoading } = useQuery({
    queryKey: ["food", "closed-days"],

    queryFn: () => foodApi.getClosedDays(dayjs().format("YYYY-MM-DD")),
  })

  const createMutation = useMutation({
    mutationFn: foodApi.createClosedDays,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "closed-days"] })

      queryClient.invalidateQueries({ queryKey: ["food", "registrations"] })

      queryClient.invalidateQueries({ queryKey: ["food", "stats"] })

      setSelectedDates([])

      setReason("")

      notifications.show({
        color: "green",

        message: "Lukkede dage er blevet oprettet.",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette lukkede dage.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: foodApi.deleteClosedDay,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "closed-days"] })

      queryClient.invalidateQueries({ queryKey: ["food", "registrations"] })

      queryClient.invalidateQueries({ queryKey: ["food", "stats"] })

      notifications.show({
        color: "green",

        message: "Dagen er blevet genåbnet.",
      })
    },
  })

  const handleCreate = () => {
    if (selectedDates.length === 0) return

    const dates = selectedDates.map((d) => dayjs(d).format("YYYY-MM-DD"))

    createMutation.mutate({ dates, reason: reason || undefined })
  }

  // Only allow Mon-Thu selection (Mantine types say string but runtime passes Date)

  const excludeDate = (d: Date | string) => {
    const date = d instanceof Date ? d : new Date(d)

    return date.getDay() === 0 || date.getDay() === 5 || date.getDay() === 6
  }

  return (
    <Stack gap="md">
      <Title order={3}>
        <Group gap="xs">
          <IconCalendarOff size={24} />
          Lukkede maddage
        </Group>
      </Title>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <DatePickerInput<"multiple">
            type="multiple"
            label="Vælg datoer der skal lukkes"
            placeholder="Klik for at vælge datoer"
            value={selectedDates}
            onChange={(dates) => setSelectedDates(dates as unknown as Date[])}
            excludeDate={excludeDate}
            valueFormat="ddd, D. MMM"
            description={`${selectedDates.length} dato${
              selectedDates.length !== 1 ? "er" : ""
            } valgt`}
            clearable
          />
          <TextInput
            label="Begrundelse (valgfrit)"
            placeholder="F.eks. Påske, Sommerferie"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            onClick={handleCreate}
            loading={createMutation.isPending}
            disabled={selectedDates.length === 0}
          >
            Luk {selectedDates.length} dag
            {selectedDates.length !== 1 ? "e" : ""}
          </Button>
        </Stack>
      </Paper>

      {isLoading ? (
        <Center h={100}>
          <Loader size="md" />
        </Center>
      ) : closedDays && closedDays.length > 0 ? (
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm">
            Kommende lukkede dage
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Dato</Table.Th>
                <Table.Th>Dag</Table.Th>
                <Table.Th>Begrundelse</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {closedDays.map((cd) => (
                <Table.Tr key={cd.id}>
                  <Table.Td>{dayjs(cd.date).format("D. MMMM YYYY")}</Table.Td>
                  <Table.Td>{cd.day_name}</Table.Td>
                  <Table.Td>{cd.reason || "-"}</Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => deleteMutation.mutate(cd.id)}
                      loading={deleteMutation.isPending}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ) : (
        <Text c="dimmed" ta="center">
          Ingen kommende lukkede dage.
        </Text>
      )}
    </Stack>
  )
}

// Meal Prices Admin Component (food admin only)

interface PriceDraft {
  effectiveFrom: Date | null
  adultMeat: number
  adultVeg: number
  child: number
  note: string
}

// Resolving against this yields the last price set in the schedule, whether or
// not it has taken effect yet.
const END_OF_TIME = "9999-12-31"

// A price change moves the numbers on the cost report and the economy page, so
// their cached results must be thrown away too.
const PRICE_DEPENDENT_QUERY_KEYS = [
  ["food", "monthly-cost"],
  ["food", "my-expenses"],
]

function MealPricesAdmin() {
  const queryClient = useQueryClient()

  const { data: prices, isLoading } = useMealPrices()

  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false)

  // Two-step modal: fill in the prices, then confirm the change explicitly.
  const [step, setStep] = useState<"form" | "confirm">("form")

  const [confirmed, setConfirmed] = useState(false)

  // Deleting is confirmed separately — it changes prices just as much as adding.
  const [deleteTarget, setDeleteTarget] = useState<MealPrice | null>(null)

  const today = dayjs().format("YYYY-MM-DD")

  const currentPrices = resolvePrices(prices, today)

  const invalidatePriceDependentQueries = () => {
    queryClient.invalidateQueries({ queryKey: MEAL_PRICES_QUERY_KEY })

    for (const queryKey of PRICE_DEPENDENT_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey })
    }
  }

  const [draft, setDraft] = useState<PriceDraft>({
    effectiveFrom: null,
    adultMeat: 0,
    adultVeg: 0,
    child: 0,
    note: "",
  })

  const handleOpen = () => {
    // Start from the last set in the schedule — a new set is normally appended
    // after any already-scheduled change, so that is what it replaces.
    const latestPrices = resolvePrices(prices, END_OF_TIME)

    setDraft({
      effectiveFrom: null,
      adultMeat: latestPrices.adultMeat,
      adultVeg: latestPrices.adultVeg,
      child: latestPrices.child,
      note: "",
    })

    setStep("form")

    setConfirmed(false)

    openModal()
  }

  const createMutation = useMutation({
    mutationFn: foodApi.createMealPrice,

    onSuccess: () => {
      invalidatePriceDependentQueries()

      closeModal()

      notifications.show({
        color: "green",

        message: "Det nye prissæt er gemt.",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme prissættet.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: foodApi.deleteMealPrice,

    onSuccess: () => {
      invalidatePriceDependentQueries()

      setDeleteTarget(null)

      notifications.show({
        color: "green",

        message: "Prissættet er slettet.",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette prissættet.")
    },
  })

  const draftDateStr = draft.effectiveFrom
    ? dayjs(draft.effectiveFrom).format("YYYY-MM-DD")
    : null

  // What applies the day before the new set starts — that is what changes.
  const replacedPrices = resolvePrices(
    prices,
    draftDateStr
      ? dayjs(draftDateStr).subtract(1, "day").format("YYYY-MM-DD")
      : today,
  )

  const handleSubmit = () => {
    if (!draftDateStr) return

    createMutation.mutate({
      effective_from: draftDateStr,
      price_adult_meat: draft.adultMeat,
      price_adult_veg: draft.adultVeg,
      price_child: draft.child,
      note: draft.note || undefined,
    })
  }

  const changeRows: [string, number, number][] = [
    ["Kød (voksen)", replacedPrices.adultMeat, draft.adultMeat],
    ["Vegetar (voksen)", replacedPrices.adultVeg, draft.adultVeg],
    ["Børn (1-12 år)", replacedPrices.child, draft.child],
  ]

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>
          <Group gap="xs">
            <IconCoins size={24} />
            Portionspriser
          </Group>
        </Title>
        <Button onClick={handleOpen} variant="light">
          Nyt prissæt
        </Button>
      </Group>

      <Alert color="blue" icon={<IconInfoCircle size={18} />}>
        Priser gælder ud fra <b>maddagen</b>, ikke ud fra hvornår de blev
        oprettet. Ændrer du priserne, påvirker det kun måltider fra startdatoen
        og frem — tidligere regnskaber og økonomisider står uændret. Derfor kan
        et prissæt ikke ændres eller slettes, når det først er trådt i kraft.
      </Alert>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb={4}>
          Gældende priser i dag
        </Text>
        <Text size="sm">
          Kød {currentPrices.adultMeat} kr · Vegetar {currentPrices.adultVeg} kr
          · Børn (1-12 år) {currentPrices.child} kr
        </Text>
      </Paper>

      {isLoading ? (
        <Center h={100}>
          <Loader size="md" />
        </Center>
      ) : (
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm">
            Alle prissæt
          </Text>
          <Table.ScrollContainer minWidth={520}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Gælder fra</Table.Th>
                  <Table.Th>Kød</Table.Th>
                  <Table.Th>Vegetar</Table.Th>
                  <Table.Th>Børn</Table.Th>
                  <Table.Th>Note</Table.Th>
                  <Table.Th w={50} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {prices?.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        {dayjs(p.effective_from).format("D. MMMM YYYY")}
                        {p.effective_from > today && (
                          <Badge size="sm" color="blue" variant="light">
                            Kommende
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{p.price_adult_meat} kr</Table.Td>
                    <Table.Td>{p.price_adult_veg} kr</Table.Td>
                    <Table.Td>{p.price_child} kr</Table.Td>
                    <Table.Td>{p.note || "-"}</Table.Td>
                    <Table.Td>
                      {p.is_locked ? (
                        <Tooltip label="Trådt i kraft — kan ikke ændres">
                          <ThemeIcon variant="subtle" color="gray">
                            <IconLock size={16} />
                          </ThemeIcon>
                        </Tooltip>
                      ) : (
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          aria-label="Slet prissæt"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={step === "form" ? "Nyt prissæt" : "Bekræft prisændring"}
      >
        {step === "form" ? (
          <Stack gap="sm">
            <DatePickerInput
              label="Gælder fra og med"
              placeholder="Vælg startdato"
              value={draft.effectiveFrom}
              onChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  effectiveFrom: value as unknown as Date | null,
                }))
              }
              minDate={dayjs().toDate()}
              valueFormat="D. MMMM YYYY"
              description="Måltider før denne dato beholder de gamle priser"
            />
            <NumberInput
              label="Kød (voksen), kr"
              value={draft.adultMeat}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  adultMeat: typeof v === "number" ? v : 0,
                }))
              }
              min={0}
              allowNegative={false}
              decimalScale={2}
            />
            <NumberInput
              label="Vegetar (voksen), kr"
              value={draft.adultVeg}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  adultVeg: typeof v === "number" ? v : 0,
                }))
              }
              min={0}
              allowNegative={false}
              decimalScale={2}
            />
            <NumberInput
              label="Børn (1-12 år), kr"
              value={draft.child}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  child: typeof v === "number" ? v : 0,
                }))
              }
              min={0}
              allowNegative={false}
              decimalScale={2}
            />
            <TextInput
              label="Note (valgfrit)"
              placeholder="F.eks. Prisstigning på råvarer"
              value={draft.note}
              onChange={(e) =>
                setDraft((d) => ({ ...d, note: e.currentTarget.value }))
              }
            />
            <Group justify="flex-end">
              <Button variant="light" onClick={closeModal}>
                Annuller
              </Button>
              <Button
                disabled={!draft.effectiveFrom}
                onClick={() => {
                  setConfirmed(false)

                  setStep("confirm")
                }}
              >
                Fortsæt
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="sm">
            <Text size="sm">
              Fra og med{" "}
              <b>{dayjs(draft.effectiveFrom).format("D. MMMM YYYY")}</b> koster
              portionerne:
            </Text>

            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Portion</Table.Th>
                  <Table.Th>Før</Table.Th>
                  <Table.Th>Efter</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {changeRows.map(([label, before, after]) => (
                  <Table.Tr key={label}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td c="dimmed">{before} kr</Table.Td>
                    <Table.Td fw={before === after ? undefined : 700}>
                      {after} kr
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              Når prissættet er trådt i kraft, kan det ikke ændres eller
              slettes. Måltider før startdatoen er ikke berørt.
            </Alert>

            <Checkbox
              checked={confirmed}
              onChange={(e) => setConfirmed(e.currentTarget.checked)}
              label="Jeg har tjekket priserne og startdatoen"
            />

            <Group justify="flex-end">
              <Button variant="light" onClick={() => setStep("form")}>
                Tilbage
              </Button>
              <Button
                color="red"
                disabled={!confirmed}
                loading={createMutation.isPending}
                onClick={handleSubmit}
              >
                Gem prissæt
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Slet prissæt?"
      >
        {deleteTarget && (
          <Stack gap="sm">
            <Text size="sm">
              Prissættet fra{" "}
              <b>{dayjs(deleteTarget.effective_from).format("D. MMMM YYYY")}</b>{" "}
              (kød {deleteTarget.price_adult_meat} kr, vegetar{" "}
              {deleteTarget.price_adult_veg} kr, børn {deleteTarget.price_child}{" "}
              kr) slettes. Måltider fra den dato prises derefter efter det
              foregående prissæt.
            </Text>
            <Group justify="flex-end">
              <Button variant="light" onClick={() => setDeleteTarget(null)}>
                Annuller
              </Button>
              <Button
                color="red"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >
                Slet
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}

// My Food Expenses Component (user-facing) — weekly buckets

function MyFoodExpenses() {
  const defaultEnd = dayjs().endOf("isoWeek")

  const defaultStart = defaultEnd.subtract(4, "week").startOf("isoWeek")

  const [range, setRange] = useState<[Date | null, Date | null]>([
    defaultStart.toDate(),

    defaultEnd.toDate(),
  ])

  const startStr = range[0] ? dayjs(range[0]).format("YYYY-MM-DD") : undefined

  const endStr = range[1] ? dayjs(range[1]).format("YYYY-MM-DD") : undefined

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["food", "my-expenses", startStr, endStr],

    queryFn: () => foodApi.getMyExpenses(startStr, endStr),

    enabled: !!startStr && !!endStr,
  })

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>
          <Group gap="xs">
            <IconWallet size={24} />
            Madudgifter
          </Group>
        </Title>
        <DatePickerInput
          type="range"
          value={range}
          onChange={(val) =>
            setRange(val as unknown as [Date | null, Date | null])
          }
          placeholder="Vælg datointerval"
          valueFormat="D/M YYYY"
          w={260}
          clearable={false}
        />
      </Group>

      {isLoading ? (
        <Center h={200}>
          <Loader size="lg" />
        </Center>
      ) : expenses ? (
        <Stack gap="md">
          <Group justify="space-between">
            <Text c="dimmed" size="sm">
              {dayjs(expenses.start_date).format("D/M YYYY")} –{" "}
              {dayjs(expenses.end_date).format("D/M YYYY")}
            </Text>
            <Badge size="lg" color="blue">
              Total: {parseFloat(expenses.total_cost).toFixed(0)}&nbsp;kr
            </Badge>
          </Group>

          {expenses.weeks.length === 0 ? (
            <Text c="dimmed">Ingen madudgifter i denne periode.</Text>
          ) : (
            expenses.weeks.map((week) => (
              <Card
                key={`${week.year}-${week.week_number}`}
                withBorder
                p="md"
                radius="md"
              >
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Badge color="grape" variant="light" size="lg">
                        Uge {week.week_number}
                      </Badge>
                      <Text size="sm" c="dimmed">
                        {dayjs(week.week_start).format("D/M")} –{" "}
                        {dayjs(week.week_end).format("D/M")}
                      </Text>
                    </Group>
                    <Badge size="lg" color="blue">
                      {parseFloat(week.total_cost).toFixed(0)}&nbsp;kr
                    </Badge>
                  </Group>

                  {week.days.length === 0 ? (
                    <Text c="dimmed" size="sm">
                      Ingen madudgifter denne uge.
                    </Text>
                  ) : (
                    <Table.ScrollContainer minWidth={350}>
                      <Table striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Dato</Table.Th>
                            <Table.Th>Dag</Table.Th>
                            <Table.Th ta="right">Kød</Table.Th>
                            <Table.Th ta="right">Vegetar</Table.Th>
                            <Table.Th ta="right">Børn</Table.Th>
                            <Table.Th ta="right">Pris</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {week.days.map((day) => (
                            <Table.Tr key={day.date}>
                              <Table.Td>
                                {dayjs(day.date).format("D/M")}
                              </Table.Td>
                              <Table.Td>{day.day_name}</Table.Td>
                              <Table.Td ta="right">{day.adults_meat}</Table.Td>
                              <Table.Td ta="right">{day.adults_veg}</Table.Td>
                              <Table.Td ta="right">
                                {day.children_count}
                              </Table.Td>
                              <Table.Td
                                ta="right"
                                fw={500}
                                style={{ whiteSpace: "nowrap" }}
                              >
                                {parseFloat(day.cost).toFixed(0)} kr
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  )}
                </Stack>
              </Card>
            ))
          )}

          <Card withBorder p="md" radius="md">
            <Stack gap="sm">
              <Title order={4}>Madbilletter</Title>
              {!expenses.tickets || expenses.tickets.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Ingen madbilletter i denne periode.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={500}>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Dato</Table.Th>
                        <Table.Th>Retning</Table.Th>
                        <Table.Th>Modpart</Table.Th>
                        <Table.Th ta="right">Kød</Table.Th>
                        <Table.Th ta="right">Vegetar</Table.Th>
                        <Table.Th ta="right">Børn</Table.Th>
                        <Table.Th ta="right">Pris</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {expenses.tickets.map((t) => (
                        <Table.Tr key={`${t.direction}-${t.id}`}>
                          <Table.Td>{dayjs(t.date).format("D/M")}</Table.Td>
                          <Table.Td>
                            <Badge
                              size="sm"
                              color={t.direction === "sold" ? "teal" : "orange"}
                              variant="light"
                            >
                              {t.direction === "sold" ? "Solgt" : "Købt"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            {t.counterparty_house.replace(/^\D+/, "") ||
                              t.counterparty_house}
                          </Table.Td>
                          <Table.Td ta="right">{t.adults_meat}</Table.Td>
                          <Table.Td ta="right">{t.adults_veg}</Table.Td>
                          <Table.Td ta="right">{t.children_count}</Table.Td>
                          <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
                            {t.price == null
                              ? "Gratis"
                              : `${parseFloat(t.price).toFixed(0)} kr`}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Stack>
          </Card>
        </Stack>
      ) : null}
    </Stack>
  )
}

// Cost Report Component (food admin only) — date range + CSV

function MonthlyCostReport() {
  const defaultEnd = dayjs().endOf("isoWeek")

  const defaultStart = defaultEnd.subtract(3, "week").startOf("isoWeek")

  const [range, setRange] = useState<[Date | null, Date | null]>([
    defaultStart.toDate(),

    defaultEnd.toDate(),
  ])

  const startStr = range[0] ? dayjs(range[0]).format("YYYY-MM-DD") : undefined

  const endStr = range[1] ? dayjs(range[1]).format("YYYY-MM-DD") : undefined

  const { data: costReport, isLoading } = useQuery({
    queryKey: ["food", "monthly-cost", startStr, endStr],

    queryFn: () => foodApi.getMonthlyFoodCost(startStr, endStr),

    enabled: !!startStr && !!endStr,
  })

  const handleDownloadCsv = async () => {
    try {
      const blob = await foodApi.downloadMonthlyFoodCostCsv(startStr, endStr)

      const url = URL.createObjectURL(blob)

      const a = document.createElement("a")

      a.href = url

      a.download = `madomkostninger_${startStr}_${endStr}.csv`

      document.body.appendChild(a)

      a.click()

      document.body.removeChild(a)

      URL.revokeObjectURL(url)
    } catch (err) {
      showErrorNotification(err, "Kunne ikke hente CSV.")
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>
          <Group gap="xs">
            <IconReceipt size={24} />
            Madomkostningsrapport
          </Group>
        </Title>
        <Group>
          <DatePickerInput
            type="range"
            value={range}
            onChange={(val) =>
              setRange(val as unknown as [Date | null, Date | null])
            }
            placeholder="Vælg datointerval"
            valueFormat="D/M YYYY"
            w={260}
            clearable={false}
          />
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={handleDownloadCsv}
            disabled={!startStr || !endStr}
          >
            CSV
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Center h={200}>
          <Loader size="lg" />
        </Center>
      ) : costReport ? (
        <Card withBorder p="md" radius="md">
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600} size="lg">
                {dayjs(costReport.start_date).format("D/M YYYY")} –{" "}
                {dayjs(costReport.end_date).format("D/M YYYY")}
              </Text>
              <Badge size="lg" color="blue" style={{ whiteSpace: "nowrap" }}>
                Total: {parseFloat(costReport.total_cost).toFixed(0)}&nbsp;kr
              </Badge>
            </Group>

            {costReport.houses.length === 0 ? (
              <Text c="dimmed">Ingen registreringer i denne periode.</Text>
            ) : (
              <Table.ScrollContainer minWidth={400}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Hus</Table.Th>
                      <Table.Th ta="right">Kød</Table.Th>
                      <Table.Th ta="right">Vegetar</Table.Th>
                      <Table.Th ta="right">Børn</Table.Th>
                      <Table.Th ta="right">Total pris</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {costReport.houses.map((house) => (
                      <Table.Tr key={house.house_id}>
                        <Table.Td>
                          {house.house_name.replace(/^\D+/, "")}
                        </Table.Td>
                        <Table.Td ta="right">
                          {house.adult_meat_portions}
                        </Table.Td>
                        <Table.Td ta="right">
                          {house.adult_veg_portions}
                        </Table.Td>
                        <Table.Td ta="right">{house.child_portions}</Table.Td>
                        <Table.Td
                          ta="right"
                          fw={500}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {parseFloat(house.total_cost).toFixed(0)} kr
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Td fw={600}>Total</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.adult_meat_portions,

                          0,
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.adult_veg_portions,

                          0,
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.child_portions,

                          0,
                        )}
                      </Table.Td>
                      <Table.Td
                        ta="right"
                        fw={600}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {parseFloat(costReport.total_cost).toFixed(0)} kr
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Card>
      ) : null}
    </Stack>
  )
}

interface DayRegistrationCardProps {
  date: string

  dayName: string

  registration?: MealRegistration

  menuText: string

  isWednesday: boolean

  isPast: boolean

  weekStart: string

  ticketsForDate: FoodTicket[]

  purchasedTicketsForDate: FoodTicket[]

  communityStats?: DailyRegistrationStats
}

function DayRegistrationCard({
  date,

  dayName,

  registration,

  menuText,

  isWednesday,

  isPast,

  weekStart,

  ticketsForDate,

  purchasedTicketsForDate,

  communityStats,
}: DayRegistrationCardProps) {
  const queryClient = useQueryClient()

  const navigate = useNavigate()

  const { user } = useAuthStore()

  const [
    ticketModalOpened,

    { open: openTicketModal, close: closeTicketModal },
  ] = useDisclosure(false)

  const [isSaving, setIsSaving] = useState(false)

  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const [statsOpen, setStatsOpen] = useState(true)

  // Fade out "Gemt" indicator after 3 seconds

  useEffect(() => {
    if (!lastSaved) return

    const timer = setTimeout(() => setLastSaved(null), 3000)

    return () => clearTimeout(timer)
  }, [lastSaved])

  const isLocked = isDateLocked(date)

  const isAfterCutoff = isAfterTicketSaleCutoff(date)

  // Default to house inhabitant count if no registration exists

  const houseCount = user?.house_inhabitant_count || 1

  const [adultsMeat, setAdultsMeat] = useState(
    registration?.adults_meat ?? (isWednesday ? houseCount : 0),
  )

  const [adultsVeg, setAdultsVeg] = useState(
    registration?.adults_veg ?? (isWednesday ? 0 : houseCount),
  )

  const [children, setChildren] = useState(registration?.children_count ?? 0)

  const [diningOption, setDiningOption] = useState<DiningOption>(
    registration?.dining_option ?? "eat_in",
  )

  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    registration?.seating_time ?? "17:30",
  )

  const [isActive, setIsActive] = useState(registration?.is_active ?? true)

  // Sync local state when registration prop changes (e.g. after preference change refetch).

  // React bails out of re-renders when primitive state values are identical, so syncing

  // to the same values on initial load is a no-op and doesn't trigger auto-save.

  useEffect(() => {
    if (!registration) return

    setAdultsMeat(registration.adults_meat)

    setAdultsVeg(registration.adults_veg)

    setChildren(registration.children_count)

    setDiningOption(registration.dining_option)

    setSeatingTime(registration.seating_time)

    setIsActive(registration.is_active)
  }, [registration])

  // Sell ticket modal state

  const availablePortions = registration?.available_portions ?? {
    adults_meat: 0,

    adults_veg: 0,

    children_count: 0,
  }

  const [sellMeat, setSellMeat] = useState(availablePortions.adults_meat)

  const [sellVeg, setSellVeg] = useState(availablePortions.adults_veg)

  const [sellChildren, setSellChildren] = useState(
    availablePortions.children_count,
  )

  const [sellDescription, setSellDescription] = useState("")

  const hasSomethingToSell =
    availablePortions.adults_meat > 0 ||
    availablePortions.adults_veg > 0 ||
    availablePortions.children_count > 0

  // All portions sold via tickets — seller should not control dining/seating

  const allPortionsSold = ticketsForDate.length > 0 && !hasSomethingToSell

  const { data: mealPrices } = useMealPrices()

  const sellPrice = calculateDefaultTicketPrice(
    mealPrices,
    date,
    sellMeat,
    sellVeg,
    sellChildren,
  )

  const prices = resolvePrices(mealPrices, date)

  const createMutation = useMutation({
    mutationFn: (data: CreateMealRegistrationData) =>
      foodApi.createRegistration(data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "registrations", weekStart],
      })

      queryClient.invalidateQueries({ queryKey: ["food", "stats"] })

      setLastSaved(new Date())

      setIsSaving(false)
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke gemme tilmelding. Prøv venligst igen.",
      )

      setIsSaving(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateMealRegistrationData>) =>
      foodApi.updateRegistration(registration!.id as number, data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "registrations", weekStart],
      })

      queryClient.invalidateQueries({ queryKey: ["food", "stats"] })

      setLastSaved(new Date())

      setIsSaving(false)
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke gemme tilmelding. Prøv venligst igen.",
      )

      setIsSaving(false)
    },
  })

  const createTicketMutation = useMutation({
    mutationFn: (data: CreateFoodTicketData) => foodApi.createTicket(data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })

      queryClient.invalidateQueries({
        queryKey: ["food", "registrations", weekStart],
      })

      closeTicketModal()

      setSellDescription("")

      notifications.show({
        title: "Billet oprettet",

        message: "Din madbillet er nu tilgængelig for andre.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke oprette billet. Prøv venligst igen.",
      )
    },
  })

  const deleteTicketMutation = useMutation({
    mutationFn: (ticketId: number) => foodApi.deleteTicket(ticketId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })

      queryClient.invalidateQueries({
        queryKey: ["food", "registrations", weekStart],
      })

      notifications.show({
        title: "Billet slettet",

        message: "Din billet er slettet.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(
        error,

        "Kunne ikke slette billet. Prøv venligst igen.",
      )
    },
  })

  // Debounced save function

  const debouncedSave = useDebouncedCallback(
    (data: CreateMealRegistrationData, regId: number | null | undefined) => {
      setIsSaving(true)

      if (regId) {
        updateMutation.mutate(data)
      } else {
        createMutation.mutate(data)
      }
    },

    500,
  )

  // Auto-save when user changes values.  Skip when local state matches server

  // data (sync-triggered change or initial mount — not a user interaction).

  useEffect(() => {
    if (!registration) return

    if (isPast) return

    // If local state matches what the server returned, nothing to save.

    if (
      adultsMeat === registration.adults_meat &&
      adultsVeg === registration.adults_veg &&
      children === registration.children_count &&
      diningOption === registration.dining_option &&
      seatingTime === registration.seating_time &&
      isActive === registration.is_active
    ) {
      return
    }

    // After the deadline only UPDATEs are allowed — never attempt a CREATE

    if (isLocked && !registration.id) return

    const data: CreateMealRegistrationData = {
      date,

      adults_meat: adultsMeat,

      adults_veg: adultsVeg,

      children_count: children,

      dining_option: diningOption,

      seating_time: seatingTime,

      is_active: isActive,
    }

    debouncedSave(data, registration.id)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adultsMeat, adultsVeg, children, diningOption, seatingTime, isActive])

  const handleEatingChange = (val: string) => {
    const eating = val === "yes"

    setIsActive(eating)

    // Restore default portions when switching back to eating

    if (eating && adultsMeat === 0 && adultsVeg === 0 && children === 0) {
      if (isWednesday) {
        setAdultsMeat(houseCount)
      } else {
        setAdultsVeg(houseCount)
      }
    }
  }

  // Auto-switch to "spiser ikke" when all portions are set to 0

  useEffect(() => {
    if (isActive && adultsMeat === 0 && adultsVeg === 0 && children === 0) {
      setIsActive(false)
    }
  }, [adultsMeat, adultsVeg, children, isActive])

  const handleOpenSellModal = () => {
    setSellMeat(availablePortions.adults_meat)

    setSellVeg(availablePortions.adults_veg)

    setSellChildren(availablePortions.children_count)

    setSellDescription("")

    openTicketModal()
  }

  const handleSellTicket = () => {
    // No `price`: the backend derives it from the price set in effect on the
    // meal date. `sellPrice` is only a preview — sending it would let a stale
    // or not-yet-loaded price schedule store the wrong amount.
    const ticketData: CreateFoodTicketData = {
      date,

      adults_meat: sellMeat,

      adults_veg: sellVeg,

      children_count: sellChildren,

      description: sellDescription,
    }

    createTicketMutation.mutate(ticketData)
  }

  const portionSummary = () => {
    if (!registration) return ""

    const parts: string[] = []

    if (registration.adults_meat > 0)
      parts.push(`${registration.adults_meat} kød`)

    if (registration.adults_veg > 0)
      parts.push(`${registration.adults_veg} vegetar`)

    if (registration.children_count > 0)
      parts.push(`${registration.children_count} børn`)

    return parts.join(", ")
  }

  return (
    <>
      <Paper withBorder p="md" radius="md" opacity={isPast ? 0.6 : 1}>
        <Group justify="space-between" mb="xs">
          <div>
            <Text fw={500} tt="capitalize">
              {dayName}
            </Text>
          </div>
          <Group gap="xs">
            {isLocked && (
              <Badge
                color="orange"
                variant="light"
                size="sm"
                leftSection={<IconLock size={12} />}
              >
                Bestilt
              </Badge>
            )}
            <Badge variant="light" color={isPast ? "gray" : "blue"}>
              {dayjs(date).format("D. MMM")}
            </Badge>
          </Group>
        </Group>

        {menuText && (
          <Text size="xs" mb="sm">
            {menuText.trim()}
          </Text>
        )}

        <Stack gap="sm">
          {/* When locked and registered: show read-only info */}
          {isLocked && registration && registration.is_active ? (
            <>
              <Text size="sm" c="dimmed">
                Tilmeldt: {portionSummary()}
              </Text>
              <MealFormFields
                adultsMeat={adultsMeat}
                adultsVeg={adultsVeg}
                children={children}
                diningOption={diningOption}
                seatingTime={seatingTime}
                isWednesday={isWednesday}
                disabled={true}
                portionsReadOnly={true}
                diningDisabled={allPortionsSold}
                onAdultsMeatChange={setAdultsMeat}
                onAdultsVegChange={setAdultsVeg}
                onChildrenChange={setChildren}
                onDiningOptionChange={setDiningOption}
                onSeatingTimeChange={setSeatingTime}
              />

              {/* Sell ticket button */}
              {hasSomethingToSell && !isPast && (
                <Tooltip
                  label="Salg lukket efter kl. 18:30"
                  disabled={!isAfterCutoff}
                >
                  <Button
                    variant="light"
                    color="orange"
                    size="sm"
                    leftSection={<IconTicket size={16} />}
                    onClick={handleOpenSellModal}
                    disabled={isAfterCutoff}
                  >
                    Sælg billet
                  </Button>
                </Tooltip>
              )}

              {/* Ticket status */}
              {ticketsForDate.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" fw={500} c="dimmed">
                    Mine billetter:
                  </Text>
                  {ticketsForDate.map((ticket) => (
                    <Group key={ticket.id} justify="space-between">
                      <Text size="xs" component="span">
                        {ticket.is_available ? (
                          <Badge color="orange" variant="light" size="xs">
                            Til salg
                          </Badge>
                        ) : (
                          <Badge
                            color="green"
                            variant="light"
                            size="sm"
                            leftSection={
                              <Avatar
                                src={ticket.claimed_by?.profile_picture}
                                size={14}
                                radius="xl"
                              >
                                {ticket.claimed_by?.first_name?.[0]}
                              </Avatar>
                            }
                            style={{ cursor: "pointer" }}
                            onClick={() =>
                              navigate(`/profil/${ticket.claimed_by?.id}`)
                            }
                          >
                            Solgt til {ticket.claimed_by?.first_name}
                          </Badge>
                        )}{" "}
                        {ticket.adults_meat > 0 && `${ticket.adults_meat} kød `}
                        {ticket.adults_veg > 0 && `${ticket.adults_veg} veg `}
                        {ticket.children_count > 0 &&
                          `${ticket.children_count} børn `}
                        {ticket.price && `· ${ticket.price} kr`}
                      </Text>
                      {ticket.is_available && (
                        <ActionIcon
                          size="sm"
                          color="red"
                          variant="subtle"
                          onClick={() => deleteTicketMutation.mutate(ticket.id)}
                          loading={deleteTicketMutation.isPending}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  ))}
                </Stack>
              )}
            </>
          ) : isLocked ? (
            /* Locked and not registered */

            <Text size="sm" c="dimmed" ta="center">
              Ikke tilmeldt
            </Text>
          ) : (
            /* Normal editable state (before deadline) */

            <>
              <SegmentedControl
                value={isActive ? "yes" : "no"}
                onChange={handleEatingChange}
                data={[
                  { label: "Spiser", value: "yes" },

                  { label: "Spiser ikke", value: "no" },
                ]}
                fullWidth
                disabled={isPast}
              />

              {isActive && (
                <>
                  <MealFormFields
                    adultsMeat={adultsMeat}
                    adultsVeg={adultsVeg}
                    children={children}
                    diningOption={diningOption}
                    seatingTime={seatingTime}
                    isWednesday={isWednesday}
                    disabled={isPast}
                    onAdultsMeatChange={setAdultsMeat}
                    onAdultsVegChange={setAdultsVeg}
                    onChildrenChange={setChildren}
                    onDiningOptionChange={setDiningOption}
                    onSeatingTimeChange={setSeatingTime}
                  />

                  {user?.house && (
                    <Text size="xs" c="blue" ta="center">
                      Tilmeldes for{" "}
                      {user.house_name || `Kløverbakkevej ${user.house}`}
                    </Text>
                  )}
                </>
              )}
            </>
          )}

          {/* Saving indicator */}
          {!isPast && !isLocked && (
            <Group gap={4} justify="center" h={20}>
              {isSaving && <Loader size={12} />}
              <Text
                size="xs"
                c={isSaving ? "blue" : lastSaved ? "green" : "dimmed"}
              >
                {isSaving
                  ? "Gemmer..."
                  : lastSaved
                    ? "Gemt"
                    : "Gemmes automatisk ved ændringer"}
              </Text>
            </Group>
          )}

          {/* Purchased tickets — always visible, independent of registration state */}
          {purchasedTicketsForDate.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={500} c="dimmed">
                Købt billet:
              </Text>
              {purchasedTicketsForDate.map((ticket) => (
                <Group key={ticket.id} gap="xs" wrap="nowrap">
                  <Avatar
                    src={ticket.owner.profile_picture}
                    size={18}
                    radius="xl"
                  >
                    {ticket.owner.first_name?.[0]}
                  </Avatar>
                  <Text size="xs" c="green" component="span">
                    <Badge color="green" variant="light" size="xs">
                      Købt
                    </Badge>{" "}
                    {ticket.adults_meat > 0 && `${ticket.adults_meat} kød `}
                    {ticket.adults_veg > 0 && `${ticket.adults_veg} veg `}
                    {ticket.children_count > 0 &&
                      `${ticket.children_count} børn `}
                    {ticket.price && `· ${ticket.price} kr`} fra{" "}
                    {ticket.owner.first_name}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}

          {/* Saving indicator for locked (dining/seating edits) */}
          {!isPast && isLocked && registration?.is_active && (
            <Group gap={4} justify="center" h={20}>
              {isSaving && <Loader size={12} />}
              {(isSaving || lastSaved) && (
                <Text size="xs" c={isSaving ? "blue" : "green"}>
                  {isSaving ? "Gemmer..." : "Gemt"}
                </Text>
              )}
            </Group>
          )}
        </Stack>

        {communityStats && (
          <>
            <Divider mt="sm" />
            <UnstyledButton
              onClick={() => setStatsOpen((o) => !o)}
              w="100%"
              mt="xs"
            >
              <Group gap="xs" justify="space-between">
                <Group gap={4}>
                  <IconUsers size={12} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    Tilmeldinger
                  </Text>
                </Group>
                {statsOpen ? (
                  <IconChevronUp
                    size={12}
                    color="var(--mantine-color-dimmed)"
                  />
                ) : (
                  <IconChevronDown
                    size={12}
                    color="var(--mantine-color-dimmed)"
                  />
                )}
              </Group>
            </UnstyledButton>
            <Collapse expanded={statsOpen}>
              <FoodPageCommunityStats stats={communityStats} />
            </Collapse>
          </>
        )}
      </Paper>

      {/* Sell Ticket Modal */}
      <Modal
        opened={ticketModalOpened}
        onClose={closeTicketModal}
        title="Sælg billet"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Vælg hvor mange portioner du vil sælge. Køber betaler dig direkte
            via MobilePay.
          </Text>

          {isWednesday ? (
            <>
              <NumberInput
                label="Kødportioner"
                value={sellMeat}
                onChange={(v) => setSellMeat(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_meat}
                clampBehavior="strict"
                allowLeadingZeros={false}
                disabled={availablePortions.adults_meat === 0}
              />
              <NumberInput
                label="Vegetarportioner"
                value={sellVeg}
                onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_veg}
                clampBehavior="strict"
                allowLeadingZeros={false}
                disabled={availablePortions.adults_veg === 0}
              />
            </>
          ) : (
            <NumberInput
              label="Vegetarportioner"
              value={sellVeg}
              onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
              min={0}
              max={availablePortions.adults_veg}
              clampBehavior="strict"
              allowLeadingZeros={false}
              disabled={availablePortions.adults_veg === 0}
            />
          )}

          {availablePortions.children_count > 0 && (
            <NumberInput
              label="Børneportioner"
              value={sellChildren}
              onChange={(v) => setSellChildren(typeof v === "number" ? v : 0)}
              min={0}
              max={availablePortions.children_count}
              clampBehavior="strict"
              allowLeadingZeros={false}
            />
          )}

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Pris
            </Text>
            <Text size="xl" fw={700}>
              {sellPrice} kr
            </Text>
            <Text size="xs" c="dimmed">
              {[
                availablePortions.adults_meat > 0
                  ? `${prices.adultMeat} kr/Kødportioner`
                  : null,

                availablePortions.adults_veg > 0
                  ? `${prices.adultVeg} kr/Vegetarportioner`
                  : null,

                availablePortions.children_count > 0
                  ? `${prices.child} kr/Børneportioner`
                  : null,
              ]

                .filter(Boolean)

                .join(" + ")}
            </Text>
          </Stack>

          <Textarea
            label="Note (valgfrit)"
            placeholder="Yderligere information..."
            value={sellDescription}
            onChange={(e) => setSellDescription(e.target.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={closeTicketModal}>
              Annuller
            </Button>
            <Button
              onClick={handleSellTicket}
              loading={createTicketMutation.isPending}
              disabled={sellMeat + sellVeg + sellChildren === 0}
            >
              Opret billet
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

interface TicketCardProps {
  ticket: FoodTicket
}

function TicketCard({ ticket }: TicketCardProps) {
  const queryClient = useQueryClient()

  const navigate = useNavigate()

  const clipboard = useClipboard({ timeout: 2000 })

  const [buyModalOpened, { open: openBuyModal, close: closeBuyModal }] =
    useDisclosure(false)

  const isWednesdayTicket = dayjs(ticket.date).day() === 3

  const [buyMeat, setBuyMeat] = useState(ticket.adults_meat)

  const [buyVeg, setBuyVeg] = useState(ticket.adults_veg)

  const [buyChildren, setBuyChildren] = useState(ticket.children_count)

  const handleOpenBuyModal = () => {
    setBuyMeat(ticket.adults_meat)

    setBuyVeg(ticket.adults_veg)

    setBuyChildren(ticket.children_count)

    openBuyModal()
  }

  const { data: mealPrices } = useMealPrices()

  const buyPrice = ticket.is_free
    ? 0
    : calculateDefaultTicketPrice(
        mealPrices,
        ticket.date,
        buyMeat,
        buyVeg,
        buyChildren,
      )

  const claimMutation = useMutation({
    mutationFn: () =>
      foodApi.claimTicket(ticket.id, {
        adults_meat: buyMeat,

        adults_veg: buyVeg,

        children_count: buyChildren,
      }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })

      closeBuyModal()

      if (ticket.is_own) {
        notifications.show({
          title: "Billet fortrudt",

          message: "Du har fjernet din billet fra salg.",

          color: "green",
        })
      } else {
        notifications.show({
          title: "Billet købt",

          message: "Husk at betale ejeren via MobilePay eller kontant.",

          color: "green",
        })
      }
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke købe billet.")
    },
  })

  const releaseMutation = useMutation({
    mutationFn: () => foodApi.releaseTicket(ticket.id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })

      notifications.show({
        title: "Billet frigivet",

        message: "Billetten er nu tilgængelig igen.",

        color: "blue",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke frigive billet.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => foodApi.deleteTicket(ticket.id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })

      notifications.show({
        title: "Billet slettet",

        message: "Din billet er blevet fjernet.",

        color: "blue",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette billet.")
    },
  })

  const isClaimed = !ticket.is_available

  const isOwner = ticket.is_own

  const isClaimedByMe = ticket.claimed_by && !isOwner

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          {/* Info row: avatar + ticket details */}
          <Group gap="md" wrap="nowrap">
            <Avatar src={ticket.owner.profile_picture} radius="xl" size="md">
              {ticket.owner.first_name?.[0]}
              {ticket.owner.last_name?.[0]}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs" mb={2}>
                <Text fw={500}>
                  {ticket.owner.first_name} {ticket.owner.last_name}
                </Text>
                {ticket.is_free ? (
                  <Badge color="green" variant="light">
                    Gratis
                  </Badge>
                ) : (
                  <Badge color="blue" variant="light">
                    {ticket.price} DKK
                  </Badge>
                )}
                {isClaimed &&
                  (isOwner && ticket.claimed_by ? (
                    <Badge
                      color="gray"
                      variant="light"
                      leftSection={
                        <Avatar
                          src={ticket.claimed_by.profile_picture}
                          size={14}
                          radius="xl"
                        >
                          {ticket.claimed_by.first_name?.[0]}
                        </Avatar>
                      }
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        navigate(`/profil/${ticket.claimed_by!.id}`)
                      }
                    >
                      Solgt til {ticket.claimed_by.first_name}
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Reserveret
                    </Badge>
                  ))}
              </Group>
              <Text size="sm" c="dimmed">
                {ticket.day_name}, {dayjs(ticket.date).format("D. MMM")} •{" "}
                {[
                  ticket.adults_meat > 0 ? `${ticket.adults_meat} kød` : null,

                  ticket.adults_veg > 0 ? `${ticket.adults_veg} vegetar` : null,

                  ticket.children_count > 0
                    ? `${ticket.children_count} ${
                        ticket.children_count === 1 ? "barn" : "børn"
                      }`
                    : null,
                ]

                  .filter(Boolean)

                  .join(", ")}
              </Text>
              {ticket.description && (
                <Text size="sm" mt={4}>
                  {ticket.description}
                </Text>
              )}
              {isClaimed && ticket.claimed_by && (
                <Group gap="xs">
                  <Avatar
                    src={ticket.claimed_by.profile_picture}
                    size={20}
                    radius="xl"
                  >
                    {ticket.claimed_by.first_name?.[0]}
                  </Avatar>
                  <Text size="sm" c="dimmed">
                    {isOwner ? "Købt" : "Reserveret"} af{" "}
                    {ticket.claimed_by.first_name} {ticket.claimed_by.last_name}
                  </Text>
                </Group>
              )}
            </div>
          </Group>

          {/* Actions row */}
          {((!ticket.is_own && ticket.is_available) ||
            isOwner ||
            (isClaimed && isClaimedByMe && ticket.owner.phone_number)) && (
            <Group gap="xs" justify="flex-end">
              {/* Phone number for buyer who claimed */}
              {isClaimed && isClaimedByMe && ticket.owner.phone_number && (
                <>
                  {!ticket.is_free && (
                    <>
                      <Button
                        variant="filled"
                        color={clipboard.copied ? "green" : "indigo"}
                        size="sm"
                        leftSection={<IconCopy size={14} />}
                        onClick={() =>
                          clipboard.copy(ticket.owner.phone_number)
                        }
                      >
                        {clipboard.copied ? "Kopieret!" : "Kopiér nr."}
                      </Button>
                      <Button
                        variant="light"
                        color="indigo"
                        size="sm"
                        leftSection={<IconWallet size={14} />}
                        component="a"
                        href={"mobilepay://"}
                      >
                        Åbn MobilePay
                      </Button>
                    </>
                  )}
                  <Box visibleFrom="sm">
                    <Text size="sm" c="dimmed">
                      {ticket.owner.phone_number}
                    </Text>
                  </Box>
                </>
              )}

              {/* Buy button */}
              {!ticket.is_own && ticket.is_available && (
                <Button size="sm" onClick={handleOpenBuyModal}>
                  Køb
                </Button>
              )}

              {/* Owner actions */}
              {isOwner && (
                <>
                  {ticket.is_available && (
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() => deleteMutation.mutate()}
                      loading={deleteMutation.isPending}
                    >
                      Fortryd
                    </Button>
                  )}
                  {!ticket.is_available && (
                    <Menu shadow="md" width={200}>
                      <Menu.Target>
                        <ActionIcon variant="subtle">
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => releaseMutation.mutate()}>
                          Frigiv billet
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </>
              )}
            </Group>
          )}
        </Stack>
      </Paper>

      {/* Buy Modal */}
      <Modal
        opened={buyModalOpened}
        onClose={closeBuyModal}
        title="Køb madbillet"
        centered
      >
        <Stack gap="md">
          <div>
            <Text size="sm" c="dimmed">
              Sælger
            </Text>
            <Group gap="sm">
              <Avatar src={ticket.owner.profile_picture} radius="xl" size="sm">
                {ticket.owner.first_name?.[0]}
                {ticket.owner.last_name?.[0]}
              </Avatar>
              <Text fw={500}>
                {ticket.owner.first_name} {ticket.owner.last_name}
              </Text>
            </Group>
          </div>

          <Text size="sm" c="dimmed">
            {ticket.day_name}, {dayjs(ticket.date).format("D. MMM")}
          </Text>

          <div>
            <Text size="sm" fw={500} mb={4}>
              Vælg antal portioner
            </Text>
            <Stack gap="xs">
              {isWednesdayTicket && ticket.adults_meat > 0 && (
                <NumberInput
                  label={`Kød-portioner (maks ${ticket.adults_meat})`}
                  value={buyMeat}
                  onChange={(v) => setBuyMeat(typeof v === "number" ? v : 0)}
                  min={0}
                  max={ticket.adults_meat}
                />
              )}
              {ticket.adults_veg > 0 && (
                <NumberInput
                  label={
                    isWednesdayTicket
                      ? `Vegetar-portioner (maks ${ticket.adults_veg})`
                      : `Voksenportioner (maks ${ticket.adults_veg})`
                  }
                  value={buyVeg}
                  onChange={(v) => setBuyVeg(typeof v === "number" ? v : 0)}
                  min={0}
                  max={ticket.adults_veg}
                />
              )}
              {ticket.children_count > 0 && (
                <NumberInput
                  label={`Børneportioner (maks ${ticket.children_count})`}
                  value={buyChildren}
                  onChange={(v) =>
                    setBuyChildren(typeof v === "number" ? v : 0)
                  }
                  min={0}
                  max={ticket.children_count}
                />
              )}
            </Stack>
          </div>

          <div>
            <Text size="sm" c="dimmed">
              Pris
            </Text>
            <Text fw={500} size="lg">
              {ticket.is_free ? "Gratis" : `${buyPrice} kr`}
            </Text>
          </div>

          {!ticket.is_free && buyPrice > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Betal med MobilePay
              </Text>
              {ticket.owner.phone_number ? (
                <>
                  <Box hiddenFrom="sm">
                    <Stack gap="xs">
                      <Button
                        variant="filled"
                        color={clipboard.copied ? "green" : "indigo"}
                        leftSection={<IconCopy size={16} />}
                        onClick={() =>
                          clipboard.copy(ticket.owner.phone_number)
                        }
                      >
                        {clipboard.copied
                          ? "Kopieret!"
                          : `Kopiér nr. (${ticket.owner.phone_number})`}
                      </Button>
                      <Button
                        variant="light"
                        color="indigo"
                        leftSection={<IconWallet size={16} />}
                        component="a"
                        href={"mobilepay://"}
                      >
                        Åbn MobilePay
                      </Button>
                    </Stack>
                  </Box>
                  <Box visibleFrom="sm">
                    <Text fw={500} size="lg">
                      {ticket.owner.phone_number}
                    </Text>
                  </Box>
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  Sælger har ikke registreret telefonnummer
                </Text>
              )}
            </Stack>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={closeBuyModal}>
              Annuller
            </Button>
            <Button
              onClick={() => claimMutation.mutate()}
              loading={claimMutation.isPending}
              disabled={buyMeat + buyVeg + buyChildren === 0}
            >
              Bekræft køb
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

interface FoodPageCommunityStatsProps {
  stats: DailyRegistrationStats
}

function FoodPageCommunityStats({ stats }: FoodPageCommunityStatsProps) {
  const hasWednesdayData =
    stats.eat_in_1730.adults_meat > 0 ||
    stats.eat_in_1830.adults_meat > 0 ||
    stats.takeaway.adults_meat > 0

  const formatSlot = (slot: DailyRegistrationStats["eat_in_1730"]) => {
    if (slot.adults === 0 && slot.children === 0) return null

    const parts: string[] = []

    if (hasWednesdayData) {
      if (slot.adults_veg > 0) parts.push(`${slot.adults_veg} veg`)

      if (slot.adults_meat > 0) parts.push(`${slot.adults_meat} kød`)
    } else {
      if (slot.adults > 0) parts.push(`${slot.adults} voksne`)
    }

    if (slot.children > 0) parts.push(`${slot.children} børn`)

    return parts.join(" · ")
  }

  // Weighted headcount where children count as half a person.
  const weightedCount = (slot: DailyRegistrationStats["eat_in_1730"]) =>
    slot.adults + slot.children * 0.5

  const totalWeighted =
    weightedCount(stats.eat_in_1730) +
    weightedCount(stats.eat_in_1830) +
    weightedCount(stats.takeaway)

  const formatPercent = (slot: DailyRegistrationStats["eat_in_1730"]) => {
    if (totalWeighted <= 0) return null

    return Math.round((weightedCount(slot) / totalWeighted) * 100)
  }

  const slot1730 = formatSlot(stats.eat_in_1730)

  const slot1830 = formatSlot(stats.eat_in_1830)

  const slotTakeaway = formatSlot(stats.takeaway)

  const pct1730 = formatPercent(stats.eat_in_1730)

  const pct1830 = formatPercent(stats.eat_in_1830)

  const pctTakeaway = formatPercent(stats.takeaway)

  if (!slot1730 && !slot1830 && !slotTakeaway) {
    return (
      <Text size="xs" c="dimmed" mt="xs">
        Ingen tilmeldte endnu
      </Text>
    )
  }

  return (
    <Stack gap={4} mt="xs">
      {slot1730 && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            17:30
          </Text>
          <Text size="xs" c="dimmed">
            {slot1730}
            {pct1730 != null && (
              <Text span fw={600}>
                {` · ${pct1730}%`}
              </Text>
            )}
          </Text>
        </Group>
      )}
      {slot1830 && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            18:30
          </Text>
          <Text size="xs" c="dimmed">
            {slot1830}
            {pct1830 != null && (
              <Text span fw={600}>
                {` · ${pct1830}%`}
              </Text>
            )}
          </Text>
        </Group>
      )}
      {slotTakeaway && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            Tag med
          </Text>
          <Text size="xs" c="dimmed">
            {slotTakeaway}
            {pctTakeaway != null && (
              <Text span fw={600}>
                {` · ${pctTakeaway}%`}
              </Text>
            )}
          </Text>
        </Group>
      )}
    </Stack>
  )
}
