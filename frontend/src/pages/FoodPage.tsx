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
  Select,
  NumberInput,
  Avatar,
  Menu,
  Box,
  ThemeIcon,
  Collapse,
  UnstyledButton,
  Divider,
  Anchor,
} from "@mantine/core"
import {
  useDisclosure,
  useDebouncedCallback,
  useClipboard,
} from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconCalendar,
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
  PRICE_ADULT_MEAT,
  PRICE_ADULT_VEG,
  PRICE_CHILD,
} from "../utils/priceCalculation"
import { isDateLocked } from "../utils/foodDeadline"
import type {
  MealRegistration,
  CreateMealRegistrationData,
  CreateFoodTicketData,
  DiningOption,
  SeatingTime,
  DriveMenu,
  FoodTicket,
  DailyRegistrationStats,
} from "../types"

export default function FoodPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  // Path-based tab state
  const validTabs = ["tilmelding", "billetter", "admin"]
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
    onError: () => {
      notifications.show({
        color: "red",
        message: "Kunne ikke opdatere menuen fra Google Drive.",
      })
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
    myTickets?.filter((t) => t.is_own && t.is_available) ?? []
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
      void notificationsApi.markReadByLink("/mad/billetter").then(() => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke nulstille tilmeldinger.",
        color: "red",
      })
    },
  })

  const isLoading = regsLoading

  // Create a map of registrations by date for registration tab
  const registrationsByDate = new Map<string, MealRegistration>()
  registrations?.forEach((reg) => {
    registrationsByDate.set(reg.date, reg)
  })

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
          <Badge color="red" size="xl">
            DETTE MODUL ER IKKE FÆRDIGT; VENT MED AT TESTE
          </Badge>
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
          {user?.is_staff && (
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
              {user?.is_staff ? (
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

            {isLoading ? (
              <Center h={200}>
                <Loader size="lg" />
              </Center>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {[0, 1, 2, 3].map((dayOffset) => {
                  const date = regWeekStart.add(dayOffset, "day")
                  const dateStr = date.format("YYYY-MM-DD")
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
                      communityStats={weeklyStats?.[dateStr]}
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

        {user?.is_staff && (
          <Tabs.Panel value="admin">
            <MonthlyCostReport />
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  )
}

// Monthly Cost Report Component (Admin only)
function MonthlyCostReport() {
  const currentDate = dayjs()
  const [selectedYear, setSelectedYear] = useState(
    currentDate.year().toString(),
  )
  const [selectedMonth, setSelectedMonth] = useState(
    (currentDate.month() + 1).toString(),
  )

  const { data: costReport, isLoading } = useQuery({
    queryKey: ["food", "monthly-cost", selectedYear, selectedMonth],
    queryFn: () =>
      foodApi.getMonthlyFoodCost(
        parseInt(selectedYear),
        parseInt(selectedMonth),
      ),
    enabled: !!selectedYear && !!selectedMonth,
  })

  const years = Array.from({ length: 5 }, (_, i) => {
    const year = currentDate.year() - 2 + i
    return { value: year.toString(), label: year.toString() }
  })

  const months = [
    { value: "1", label: "Januar" },
    { value: "2", label: "Februar" },
    { value: "3", label: "Marts" },
    { value: "4", label: "April" },
    { value: "5", label: "Maj" },
    { value: "6", label: "Juni" },
    { value: "7", label: "Juli" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "Oktober" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ]

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>
          <Group gap="xs">
            <IconReceipt size={24} />
            Månedlig madomkostningsrapport
          </Group>
        </Title>
        <Group>
          <Select
            value={selectedMonth}
            onChange={(val) => val && setSelectedMonth(val)}
            data={months}
            w={140}
          />
          <Select
            value={selectedYear}
            onChange={(val) => val && setSelectedYear(val)}
            data={years}
            w={100}
          />
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
                {costReport.month_name} {costReport.year}
              </Text>
              <Badge size="lg" color="blue">
                Total: {parseFloat(costReport.total_cost).toFixed(2)} kr
              </Badge>
            </Group>

            {costReport.houses.length === 0 ? (
              <Text c="dimmed">Ingen madbilletter taget denne måned.</Text>
            ) : (
              <Table.ScrollContainer minWidth={400}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Hus</Table.Th>
                      <Table.Th ta="right">Billetter</Table.Th>
                      <Table.Th ta="right">Voksne</Table.Th>
                      <Table.Th ta="right">Børn</Table.Th>
                      <Table.Th ta="right">Total pris</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {costReport.houses.map((house) => (
                      <Table.Tr key={house.house_id}>
                        <Table.Td>{house.house_name}</Table.Td>
                        <Table.Td ta="right">{house.ticket_count}</Table.Td>
                        <Table.Td ta="right">{house.adult_portions}</Table.Td>
                        <Table.Td ta="right">{house.child_portions}</Table.Td>
                        <Table.Td ta="right" fw={500}>
                          {parseFloat(house.total_cost).toFixed(2)} kr
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Td fw={600}>Total</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.ticket_count,
                          0,
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.adult_portions,
                          0,
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {costReport.houses.reduce(
                          (sum, h) => sum + h.child_portions,
                          0,
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {parseFloat(costReport.total_cost).toFixed(2)} kr
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

  const sellPrice = calculateDefaultTicketPrice(sellMeat, sellVeg, sellChildren)

  // Track if initial mount to prevent auto-save on mount
  const [hasInitialized, setHasInitialized] = useState(false)

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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme tilmelding. Prøv venligst igen.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme tilmelding. Prøv venligst igen.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette billet. Prøv venligst igen.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette billet. Prøv venligst igen.",
        color: "red",
      })
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
    2000,
  )

  // Auto-save when values change. When locked, only dining_option and seating_time
  // can actually change (portions and isActive are read-only), so the save still works.
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true)
      return
    }

    if (isPast) return

    const data: CreateMealRegistrationData = {
      date,
      adults_meat: adultsMeat,
      adults_veg: adultsVeg,
      children_count: children,
      dining_option: diningOption,
      seating_time: seatingTime,
      house_id: user?.house ?? null,
      is_active: isActive,
    }

    debouncedSave(data, registration?.id)
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
    const ticketData: CreateFoodTicketData = {
      date,
      adults_meat: sellMeat,
      adults_veg: sellVeg,
      children_count: sellChildren,
      price: sellPrice,
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
                Låst
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
                onAdultsMeatChange={setAdultsMeat}
                onAdultsVegChange={setAdultsVeg}
                onChildrenChange={setChildren}
                onDiningOptionChange={setDiningOption}
                onSeatingTimeChange={setSeatingTime}
              />

              {/* Sell ticket button */}
              {hasSomethingToSell && !isPast && (
                <Button
                  variant="light"
                  color="orange"
                  size="sm"
                  leftSection={<IconTicket size={16} />}
                  onClick={handleOpenSellModal}
                >
                  Sælg billet
                </Button>
              )}

              {/* Ticket status */}
              {ticketsForDate.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" fw={500} c="dimmed">
                    Mine billetter:
                  </Text>
                  {ticketsForDate.map((ticket) => (
                    <Group key={ticket.id} justify="space-between">
                      <Text size="xs">
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
            <Text
              size="xs"
              c={isSaving ? "blue" : lastSaved ? "green" : "dimmed"}
              ta="center"
            >
              {isSaving ? (
                <Group gap={4} justify="center">
                  <Loader size={12} />
                  Gemmer...
                </Group>
              ) : lastSaved ? (
                "Gemt"
              ) : (
                "Gemmes automatisk ved ændringer"
              )}
            </Text>
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
                  <Text size="xs" c="green">
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
            <Text
              size="xs"
              c={isSaving ? "blue" : lastSaved ? "green" : "dimmed"}
              ta="center"
            >
              {isSaving ? (
                <Group gap={4} justify="center">
                  <Loader size={12} />
                  Gemmer...
                </Group>
              ) : lastSaved ? (
                "Gemt"
              ) : null}
            </Text>
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
                    Fællesskabets tilmeldinger
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
                  ? `${PRICE_ADULT_MEAT} kr/Kødportioner`
                  : null,
                availablePortions.adults_veg > 0
                  ? `${PRICE_ADULT_VEG} kr/Vegetarportioner`
                  : null,
                availablePortions.children_count > 0
                  ? `${PRICE_CHILD} kr/Børneportioner`
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

  const buyPrice = ticket.is_free
    ? 0
    : calculateDefaultTicketPrice(buyMeat, buyVeg, buyChildren)

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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke købe billet.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke frigive billet.",
        color: "red",
      })
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
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette billet.",
        color: "red",
      })
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
                  ticket.adults_meat > 0
                    ? `${ticket.adults_meat} voksen kød`
                    : null,
                  ticket.adults_veg > 0
                    ? ticket.adults_meat > 0
                      ? `${ticket.adults_veg} vegetar`
                      : `${ticket.adults_veg} ${
                          ticket.adults_veg === 1 ? "voksen" : "voksne"
                        }`
                    : null,
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
                      : `Voksne (maks ${ticket.adults_veg})`
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

  const slot1730 = formatSlot(stats.eat_in_1730)
  const slot1830 = formatSlot(stats.eat_in_1830)
  const slotTakeaway = formatSlot(stats.takeaway)

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
          </Text>
        </Group>
      )}
      {slotTakeaway && (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" fw={500}>
            Take away
          </Text>
          <Text size="xs" c="dimmed">
            {slotTakeaway}
          </Text>
        </Group>
      )}
    </Stack>
  )
}
