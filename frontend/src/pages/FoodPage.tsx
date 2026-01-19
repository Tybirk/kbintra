import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
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
  NumberInput,
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
} from "@mantine/core"
import { useDisclosure, useDebouncedCallback } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconSoup,
  IconCalendar,
  IconTicket,
  IconSettings,
  IconAlertCircle,
  IconChefHat,
  IconChevronLeft,
  IconChevronRight,
  IconUsers,
  IconChevronDown,
  IconChevronUp,
  IconRefresh,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

import { foodApi } from "../api/food"
import { useAuthStore } from "../store/authStore"
import { calculateDefaultTicketPrice } from "../utils/priceCalculation"
import type {
  MealRegistration,
  CreateMealRegistrationData,
  CreateFoodTicketData,
  DiningOption,
  SeatingTime,
  DailyRegistrationStats,
} from "../types"

export default function FoodPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

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
            leftSection={<IconChefHat size={16} />}
            onClick={() => navigate("/mad/admin")}
          >
            Administrer menuer
          </Button>
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

      <Tabs defaultValue="registration">
        <Tabs.List mb="md">
          <Tabs.Tab value="menu" leftSection={<IconSoup size={16} />}>
            Menu
          </Tabs.Tab>
          <Tabs.Tab
            value="registration"
            leftSection={<IconCalendar size={16} />}
          >
            Min tilmelding
          </Tabs.Tab>
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

        <Tabs.Panel value="registration">
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
                    {regWeekStart.format("MMMM D")} -{" "}
                    {regWeekStart.add(3, "day").format("MMMM D, YYYY")}
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
                    />
                  )
                })}
              </SimpleGrid>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </>
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
            Total: {totalAdults} voksne, {totalChildren} børn ({totalPortions})
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

      <Collapse in={expanded}>
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
              <Table.Td ta="right">{stats?.eat_in_1730.children ?? 0}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Spise i fælleshuset 18:30</Table.Td>
              <Table.Td ta="right">{stats?.eat_in_1830.adults ?? 0}</Table.Td>
              <Table.Td ta="right">{stats?.eat_in_1830.children ?? 0}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td fw={600}>Total</Table.Td>
              <Table.Td ta="right" fw={600}>
                {totalAdults}
              </Table.Td>
              <Table.Td ta="right" fw={600}>
                {totalChildren}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
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
}

function DayRegistrationCard({
  date,
  dayName,
  registration,
  menuText,
  isWednesday,
  isPast,
  weekStart,
}: DayRegistrationCardProps) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [
    ticketModalOpened,
    { open: openTicketModal, close: closeTicketModal },
  ] = useDisclosure(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Default to house inhabitant count if no registration exists
  const defaultAdults =
    registration?.adults_count ?? (user?.house_inhabitant_count || 1)
  const [adults, setAdults] = useState(defaultAdults)
  const [children, setChildren] = useState(registration?.children_count ?? 0)
  const [mealType, setMealType] = useState<"meat" | "vegetarian">(
    registration?.meal_type ?? "meat",
  )
  const [diningOption, setDiningOption] = useState<DiningOption>(
    registration?.dining_option ?? "eat_in",
  )
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    registration?.seating_time ?? "17:30",
  )
  const [isActive, setIsActive] = useState(registration?.is_active ?? true)

  // Ticket creation state
  const [ticketDescription, setTicketDescription] = useState("")

  // Calculate default ticket price using shared utility
  const calculateDefaultPrice = () => {
    const portionCount = registration?.adults_count ?? adults
    const childCount = registration?.children_count ?? children
    return calculateDefaultTicketPrice(mealType, portionCount, childCount)
  }
  const [ticketPrice, setTicketPrice] = useState<number | null>(null)

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

  // Auto-save when values change
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true)
      return
    }

    if (isPast) return

    const data: CreateMealRegistrationData = {
      date,
      adults_count: adults,
      children_count: children,
      meal_type: mealType,
      dining_option: diningOption,
      seating_time: seatingTime,
      house_id: user?.house ?? null,
      is_active: isActive,
    }

    debouncedSave(data, registration?.id)
  }, [adults, children, mealType, diningOption, seatingTime, isActive])

  const handleEatingChange = (val: string) => {
    if (val === "no" && registration?.is_active) {
      // User is switching from eating to not eating - prompt for ticket
      openTicketModal()
    } else {
      setIsActive(val === "yes")
    }
  }

  const handleCreateTicketAndSave = () => {
    // Create the ticket - use explicit price or calculated default
    const finalPrice = ticketPrice ?? calculateDefaultPrice()
    const ticketData: CreateFoodTicketData = {
      date,
      adults_count: registration?.adults_count ?? adults,
      children_count: registration?.children_count ?? children,
      meal_type: mealType,
      price: finalPrice,
      description: ticketDescription,
    }
    createTicketMutation.mutate(ticketData)

    // Update registration to not active
    setIsActive(false)
    closeTicketModal()
    setTicketPrice(null)
    setTicketDescription("")
  }

  const handleSkipTicket = () => {
    setIsActive(false)
    closeTicketModal()
    setTicketPrice(null)
    setTicketDescription("")
  }

  return (
    <>
      <Paper withBorder p="md" radius="md" opacity={isPast ? 0.6 : 1}>
        <Group justify="space-between" mb="xs">
          <div>
            <Text fw={500}>{dayName}</Text>
          </div>
          <Badge variant="light" color={isPast ? "gray" : "blue"}>
            {dayjs(date).format("MMM D")}
          </Badge>
        </Group>

        {menuText && (
          <Text size="xs" c="dimmed" mb="sm" lineClamp={2}>
            {menuText}
          </Text>
        )}

        <Stack gap="sm">
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
              <Group grow>
                <NumberInput
                  label="Voksne"
                  value={adults}
                  onChange={(val) => setAdults(Number(val) || 0)}
                  min={0}
                  max={10}
                  disabled={isPast}
                />
                <NumberInput
                  label="Børn"
                  value={children}
                  onChange={(val) => setChildren(Number(val) || 0)}
                  min={0}
                  max={10}
                  disabled={isPast}
                />
              </Group>

              {isWednesday && (
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Måltidstype
                  </Text>
                  <SegmentedControl
                    value={mealType}
                    onChange={(val) =>
                      setMealType(val as "meat" | "vegetarian")
                    }
                    data={[
                      { label: "Kød", value: "meat" },
                      { label: "Vegetar", value: "vegetarian" },
                    ]}
                    fullWidth
                    disabled={isPast}
                  />
                </div>
              )}

              <Divider />

              <div>
                <Text size="sm" fw={500} mb={4}>
                  Spisested
                </Text>
                <SegmentedControl
                  value={diningOption}
                  onChange={(val) => setDiningOption(val as DiningOption)}
                  data={[
                    { label: "Spise i fælleshuset", value: "eat_in" },
                    { label: "Take Away", value: "take_away" },
                  ]}
                  fullWidth
                  disabled={isPast}
                />
              </div>

              {diningOption === "eat_in" && (
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Spisetid
                  </Text>
                  <SegmentedControl
                    value={seatingTime}
                    onChange={(val) => setSeatingTime(val as SeatingTime)}
                    data={[
                      { label: "17:30", value: "17:30" },
                      { label: "18:30", value: "18:30" },
                    ]}
                    fullWidth
                    disabled={isPast}
                  />
                </div>
              )}

              {user?.house && (
                <Text size="xs" c="blue" ta="center">
                  Tilmeldes for{" "}
                  {user.house_name || `Kløverbakkevej ${user.house}`}
                </Text>
              )}
            </>
          )}

          {/* Saving indicator */}
          {!isPast && (
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
                `Gemt`
              ) : registration ? (
                "Gemmes automatisk ved ændringer"
              ) : (
                "Gemmes automatisk ved ændringer"
              )}
            </Text>
          )}

          {registration && registration.is_active && (
            <Stack gap={2}>
              <Text size="xs" c="dimmed" ta="center">
                {registration.total_portions} portioner •{" "}
                {registration.dining_option === "eat_in"
                  ? `Spiser kl. ${registration.seating_time}`
                  : "Take away"}
              </Text>
              {registration.house && (
                <Text size="xs" c="blue" ta="center" fw={500}>
                  Tilmeldt for {registration.house.name}
                </Text>
              )}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Modal
        opened={ticketModalOpened}
        onClose={closeTicketModal}
        title="Gør dit måltid tilgængeligt?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Vil du gøre din madbillet tilgængelig for andre?
          </Text>

          <NumberInput
            label="Pris (DKK)"
            description={`Foreslået pris: ${calculateDefaultPrice()} kr (${
              mealType === "meat" ? "37" : "26"
            }/voksen + 18/barn)`}
            value={ticketPrice ?? calculateDefaultPrice()}
            onChange={(val) => setTicketPrice(Number(val) || 0)}
            min={0}
            max={500}
            decimalScale={0}
          />

          <Textarea
            label="Note (valgfrit)"
            placeholder="Yderligere information..."
            value={ticketDescription}
            onChange={(e) => setTicketDescription(e.target.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={handleSkipTicket}>
              Nej, marker bare som ikke-spisende
            </Button>
            <Button
              onClick={handleCreateTicketAndSave}
              loading={createTicketMutation.isPending}
            >
              Opret billet
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
