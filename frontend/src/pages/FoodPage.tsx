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
  Alert,
  Tabs,
  Divider,
  Modal,
  Textarea,
  ActionIcon,
  Collapse,
  Table,
  Card,
  Select,
  NumberInput,
} from "@mantine/core"
import { useDisclosure, useDebouncedCallback } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconSoup,
  IconCalendar,
  IconTicket,
  IconSettings,
  IconAlertCircle,
  IconChevronLeft,
  IconChevronRight,
  IconUsers,
  IconChevronDown,
  IconChevronUp,
  IconRefresh,
  IconReceipt,
  IconLock,
  IconTrash,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

import { foodApi } from "../api/food"
import { MealFormFields } from "../components/MealFormFields"
import { useAuthStore } from "../store/authStore"
import { calculateDefaultTicketPrice } from "../utils/priceCalculation"
import type {
  MealRegistration,
  CreateMealRegistrationData,
  CreateFoodTicketData,
  DiningOption,
  SeatingTime,
  DailyRegistrationStats,
  FoodTicket,
} from "../types"

export default function FoodPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  // Path-based tab state
  const validTabs = ["menu", "tilmelding", "admin"]
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

  // Week offset state for menu view (0 = current, 1 = next, etc.)
  const [menuWeekOffset, setMenuWeekOffset] = useState(0)
  // Week offset state for registration view - defaults to next week (1)
  const [regWeekOffset, setRegWeekOffset] = useState(1)

  const menuWeekStart = currentWeekStart.add(menuWeekOffset, "week")
  const regWeekStart = currentWeekStart.add(regWeekOffset, "week")

  // Calculate week number and year for drive menus
  const menuWeekNumber = menuWeekStart.isoWeek()
  const menuYear = menuWeekStart.isoWeekYear()
  const regWeekNumber = regWeekStart.isoWeek()
  const regYear = regWeekStart.isoWeekYear()

  // Fetch drive menu for the selected menu week
  const {
    data: driveMenu,
    isLoading: driveMenuLoading,
    error: driveMenuError,
  } = useQuery({
    queryKey: ["food", "drive-menu", menuWeekNumber, menuYear],
    queryFn: () => foodApi.getDriveMenu(menuWeekNumber, menuYear),
  })

  // Mutation to refresh drive menu
  const refreshDriveMenuMutation = useMutation({
    mutationFn: () => foodApi.refreshDriveMenu(menuWeekNumber, menuYear),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "drive-menu", menuWeekNumber, menuYear],
      })
      notifications.show({
        title: "Menu opdateret",
        message: "Menuen er blevet opdateret fra Google Drive.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere menuen fra Google Drive.",
        color: "red",
      })
    },
  })

  // Fetch registrations for the selected registration week
  const { data: registrations, isLoading: regsLoading } = useQuery({
    queryKey: ["food", "registrations", regWeekStart.format("YYYY-MM-DD")],
    queryFn: () => foodApi.getRegistrations(regWeekStart.format("YYYY-MM-DD")),
  })

  // Fetch registrations for the menu week (to show registration status)
  const { data: menuWeekRegistrations } = useQuery({
    queryKey: ["food", "registrations", menuWeekStart.format("YYYY-MM-DD")],
    queryFn: () => foodApi.getRegistrations(menuWeekStart.format("YYYY-MM-DD")),
    enabled: menuWeekOffset !== regWeekOffset, // Only fetch if different from reg week
  })

  // Fetch registration stats for the menu week
  const { data: menuWeekStats } = useQuery({
    queryKey: ["food", "stats", menuWeekStart.format("YYYY-MM-DD")],
    queryFn: () =>
      foodApi.getRegistrationStats(menuWeekStart.format("YYYY-MM-DD")),
  })

  // Fetch drive menu for the registration week
  const { data: regDriveMenu } = useQuery({
    queryKey: ["food", "drive-menu", regWeekNumber, regYear],
    queryFn: () => foodApi.getDriveMenu(regWeekNumber, regYear),
    enabled: regWeekNumber !== menuWeekNumber || regYear !== menuYear, // Only fetch if different from menu week
  })

  // Fetch user's tickets to check for active tickets when switching eating status
  const { data: myTickets } = useQuery({
    queryKey: ["food", "tickets", "my"],
    queryFn: foodApi.getMyTickets,
  })

  // Create a map of my tickets (owned) by date
  const myTicketsByDate = new Map<string, FoodTicket[]>()
  myTickets?.forEach((ticket) => {
    if (ticket.is_own) {
      const existing = myTicketsByDate.get(ticket.date) ?? []
      myTicketsByDate.set(ticket.date, [...existing, ticket])
    }
  })

  // Helper to get menu text for a specific day offset (0=Mon, 1=Tue, 2=Wed, 3=Thu)
  const getMenuTextForDay = (
    menu: typeof driveMenu,
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

  // Get the appropriate drive menu for registration week
  const regWeekDriveMenu =
    regWeekNumber === menuWeekNumber && regYear === menuYear
      ? driveMenu
      : regDriveMenu

  const applyDefaultsMutation = useMutation({
    mutationFn: () => foodApi.applyDefaults(regWeekStart.format("YYYY-MM-DD")),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["food", "registrations"] })
      notifications.show({
        title: "Standardindstillinger anvendt",
        message: data.detail,
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message:
          "Kunne ikke anvende standardindstillinger. Sørg for at du har sat dine præferencer først.",
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

  // Create a map of registrations by date for menu view
  const menuRegistrationsByDate = new Map<string, MealRegistration>()
  const menuRegs =
    menuWeekOffset === regWeekOffset ? registrations : menuWeekRegistrations
  menuRegs?.forEach((reg) => {
    menuRegistrationsByDate.set(reg.date, reg)
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
          <Button
            variant="light"
            leftSection={<IconTicket size={16} />}
            onClick={() => navigate("/mad/billetter")}
          >
            Billetter
          </Button>
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="menu" leftSection={<IconSoup size={16} />}>
            Menu
          </Tabs.Tab>
          <Tabs.Tab value="tilmelding" leftSection={<IconCalendar size={16} />}>
            Min tilmelding
          </Tabs.Tab>
          {user?.is_staff && (
            <Tabs.Tab value="admin" leftSection={<IconSettings size={16} />}>
              Admin
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="menu">
          <Stack gap="md">
            {/* Week Navigation */}
            <Paper withBorder p="sm" radius="md">
              <Group justify="space-between">
                <ActionIcon
                  variant="light"
                  size="lg"
                  onClick={() => setMenuWeekOffset(menuWeekOffset - 1)}
                >
                  <IconChevronLeft size={20} />
                </ActionIcon>

                <Stack gap={0} align="center">
                  <Text fw={500}>
                    Uge {menuWeekNumber}: {menuWeekStart.format("D. MMM")} -{" "}
                    {menuWeekStart.add(3, "day").format("D. MMM YYYY")}
                  </Text>
                  <Badge
                    color={
                      menuWeekOffset === 0
                        ? "blue"
                        : menuWeekOffset === 1
                          ? "green"
                          : "gray"
                    }
                    variant="light"
                    size="sm"
                  >
                    {getWeekLabel(menuWeekOffset)}
                  </Badge>
                </Stack>

                <ActionIcon
                  variant="light"
                  size="lg"
                  onClick={() => setMenuWeekOffset(menuWeekOffset + 1)}
                >
                  <IconChevronRight size={20} />
                </ActionIcon>
              </Group>
            </Paper>

            {/* Refresh button and stale indicator */}
            {user?.is_staff && (
              <Group justify="flex-end" gap="xs">
                {driveMenu?.is_stale && (
                  <Badge color="yellow" variant="light" size="sm">
                    Menu kan være forældet
                  </Badge>
                )}
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => refreshDriveMenuMutation.mutate()}
                  loading={refreshDriveMenuMutation.isPending}
                >
                  Opdater fra Google Drive
                </Button>
              </Group>
            )}

            {driveMenuLoading ? (
              <Center h={200}>
                <Loader size="lg" />
              </Center>
            ) : driveMenuError ? (
              <Alert icon={<IconAlertCircle size={16} />} color="red">
                Kunne ikke hente menu fra Google Drive. Prøv igen senere.
              </Alert>
            ) : !driveMenu ? (
              <Alert icon={<IconAlertCircle size={16} />} color="yellow">
                Ingen menu tilgængelig for uge {menuWeekNumber} endnu.
              </Alert>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <DriveMenuDayCard
                  dayName="Mandag"
                  date={menuWeekStart.format("D. MMM")}
                  menu={driveMenu.monday_menu}
                  registration={menuRegistrationsByDate.get(
                    menuWeekStart.format("YYYY-MM-DD"),
                  )}
                  stats={menuWeekStats?.[menuWeekStart.format("YYYY-MM-DD")]}
                />
                <DriveMenuDayCard
                  dayName="Tirsdag"
                  date={menuWeekStart.add(1, "day").format("D. MMM")}
                  menu={driveMenu.tuesday_menu}
                  registration={menuRegistrationsByDate.get(
                    menuWeekStart.add(1, "day").format("YYYY-MM-DD"),
                  )}
                  stats={
                    menuWeekStats?.[
                      menuWeekStart.add(1, "day").format("YYYY-MM-DD")
                    ]
                  }
                />
                <DriveMenuDayCard
                  dayName="Onsdag"
                  date={menuWeekStart.add(2, "day").format("D. MMM")}
                  menu={driveMenu.wednesday_menu}
                  registration={menuRegistrationsByDate.get(
                    menuWeekStart.add(2, "day").format("YYYY-MM-DD"),
                  )}
                  stats={
                    menuWeekStats?.[
                      menuWeekStart.add(2, "day").format("YYYY-MM-DD")
                    ]
                  }
                />
                <DriveMenuDayCard
                  dayName="Torsdag"
                  date={menuWeekStart.add(3, "day").format("D. MMM")}
                  menu={driveMenu.thursday_menu}
                  registration={menuRegistrationsByDate.get(
                    menuWeekStart.add(3, "day").format("YYYY-MM-DD"),
                  )}
                  stats={
                    menuWeekStats?.[
                      menuWeekStart.add(3, "day").format("YYYY-MM-DD")
                    ]
                  }
                />
              </SimpleGrid>
            )}
          </Stack>
        </Tabs.Panel>

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
                    {regWeekStart.format("D. MMMM")} -{" "}
                    {regWeekStart.add(3, "day").format("D. MMMM YYYY")}
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

            <Group justify="flex-end">
              <Button
                variant="light"
                size="sm"
                onClick={() => applyDefaultsMutation.mutate()}
                loading={applyDefaultsMutation.isPending}
              >
                Anvend standardpræferencer
              </Button>
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
                  const menuText = getMenuTextForDay(
                    regWeekDriveMenu,
                    dayOffset,
                  )
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
                    />
                  )
                })}
              </SimpleGrid>
            )}
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

// Drive Menu Day Card - displays menu from Google Drive
interface DriveMenuDayCardProps {
  dayName: string
  date: string
  menu: string
  registration?: MealRegistration
  stats?: DailyRegistrationStats
}

function DriveMenuDayCard({
  dayName,
  date,
  menu,
  registration,
  stats,
}: DriveMenuDayCardProps) {
  const [expanded, setExpanded] = useState(false)

  const totalAdults = stats?.total.adults ?? 0
  const totalChildren = stats?.total.children ?? 0
  const totalPortions = totalAdults + totalChildren
  const totalMeat = stats?.total.adults_meat ?? 0
  const totalVeg = stats?.total.adults_veg ?? 0
  const hasMeatVegSplit = totalMeat > 0 && totalVeg > 0

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Text fw={500}>{dayName}</Text>
        <Stack gap={4} align="flex-end">
          <Badge variant="light">{date}</Badge>
          {registration && registration.is_active && (
            <Badge color="green" variant="light" size="sm">
              Dig: {registration.total_portions}
            </Badge>
          )}
        </Stack>
      </Group>

      <Text size="sm" mb="sm">
        {menu || "Menu kommer snart"}
      </Text>

      {/* Total signups */}
      <Divider my="xs" />
      <Group
        justify="space-between"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <Group gap="xs">
          <IconUsers size={16} />
          <Text size="sm" fw={500}>
            Total:{" "}
            {hasMeatVegSplit
              ? `${totalMeat} kød + ${totalVeg} vegetar`
              : `${totalAdults} voksne`}
            , {totalChildren} børn ({totalPortions})
          </Text>
        </Group>
        <ActionIcon variant="subtle" size="sm">
          {expanded ? (
            <IconChevronUp size={16} />
          ) : (
            <IconChevronDown size={16} />
          )}
        </ActionIcon>
      </Group>

      <Collapse expanded={expanded}>
        <Table.ScrollContainer minWidth={300}>
          <Table mt="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th></Table.Th>
                <Table.Th ta="right">Voksne</Table.Th>
                <Table.Th ta="right">Børn</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Take Away</Table.Td>
                <Table.Td ta="right">{stats?.takeaway.adults ?? 0}</Table.Td>
                <Table.Td ta="right">{stats?.takeaway.children ?? 0}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Spise i fælleshuset 17:30</Table.Td>
                <Table.Td ta="right">{stats?.eat_in_1730.adults ?? 0}</Table.Td>
                <Table.Td ta="right">
                  {stats?.eat_in_1730.children ?? 0}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Spise i fælleshuset 18:30</Table.Td>
                <Table.Td ta="right">{stats?.eat_in_1830.adults ?? 0}</Table.Td>
                <Table.Td ta="right">
                  {stats?.eat_in_1830.children ?? 0}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>Total</Table.Td>
                <Table.Td ta="right" fw={600}>
                  {hasMeatVegSplit
                    ? `${totalMeat} kød + ${totalVeg} veg`
                    : totalAdults}
                </Table.Td>
                <Table.Td ta="right" fw={600}>
                  {totalChildren}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Collapse>
    </Paper>
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
}: DayRegistrationCardProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [
    ticketModalOpened,
    { open: openTicketModal, close: closeTicketModal },
  ] = useDisclosure(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const isLocked = registration?.is_locked ?? false

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
      foodApi.updateRegistration(registration!.id, data),
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
    (data: CreateMealRegistrationData, regId: number | undefined) => {
      setIsSaving(true)
      if (regId) {
        updateMutation.mutate(data)
      } else {
        createMutation.mutate(data)
      }
    },
    500,
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
    setIsActive(val === "yes")
  }

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
              {hasSomethingToSell && (
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
                          <Badge color="green" variant="light" size="xs">
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
                label="Kød-portioner"
                value={sellMeat}
                onChange={(v) => setSellMeat(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_meat}
              />
              <NumberInput
                label="Vegetar-portioner"
                value={sellVeg}
                onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
                min={0}
                max={availablePortions.adults_veg}
              />
            </>
          ) : (
            <NumberInput
              label="Voksne"
              value={sellVeg}
              onChange={(v) => setSellVeg(typeof v === "number" ? v : 0)}
              min={0}
              max={availablePortions.adults_veg}
            />
          )}

          <NumberInput
            label="Børn"
            value={sellChildren}
            onChange={(v) => setSellChildren(typeof v === "number" ? v : 0)}
            min={0}
            max={availablePortions.children_count}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Pris
            </Text>
            <Text size="xl" fw={700}>
              {sellPrice} kr
            </Text>
            <Text size="xs" c="dimmed">
              37/voksen (kød) + 26/voksen (vegetar) + 18/barn
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
