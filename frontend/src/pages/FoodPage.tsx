import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from '@mantine/core';
import { useDisclosure, useDebouncedCallback } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
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
} from '@tabler/icons-react';
import dayjs from 'dayjs';

import { foodApi } from '../api/food';
import { useAuthStore } from '../store/authStore';
import { calculateDefaultTicketPrice } from '../utils/priceCalculation';
import type { MealRegistration, CreateMealRegistrationData, CreateFoodTicketData, DiningOption, SeatingTime, DailyMenu, DailyRegistrationStats } from '../types';

export default function FoodPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get current week's Monday
  const today = dayjs();
  const currentWeekStart = today.startOf('week').add(1, 'day'); // Monday

  // Week offset state for menu view (0 = current, 1 = next, etc.)
  const [menuWeekOffset, setMenuWeekOffset] = useState(0);
  // Week offset state for registration view - defaults to next week (1)
  const [regWeekOffset, setRegWeekOffset] = useState(1);

  const menuWeekStart = currentWeekStart.add(menuWeekOffset, 'week');
  const regWeekStart = currentWeekStart.add(regWeekOffset, 'week');

  // Fetch all menus to enable navigation
  const { data: allMenus, isLoading: menusLoading } = useQuery({
    queryKey: ['food', 'menus'],
    queryFn: foodApi.getWeeklyMenus,
  });

  // Find the menu for the selected week
  const selectedMenu = allMenus?.find(
    (m) => m.week_start_date === menuWeekStart.format('YYYY-MM-DD')
  );

  // Fetch registrations for the selected registration week
  const { data: registrations, isLoading: regsLoading } = useQuery({
    queryKey: ['food', 'registrations', regWeekStart.format('YYYY-MM-DD')],
    queryFn: () => foodApi.getRegistrations(regWeekStart.format('YYYY-MM-DD')),
  });

  // Fetch registrations for the menu week (to show registration status)
  const { data: menuWeekRegistrations } = useQuery({
    queryKey: ['food', 'registrations', menuWeekStart.format('YYYY-MM-DD')],
    queryFn: () => foodApi.getRegistrations(menuWeekStart.format('YYYY-MM-DD')),
    enabled: menuWeekOffset !== regWeekOffset, // Only fetch if different from reg week
  });

  // Fetch registration stats for the menu week
  const { data: menuWeekStats } = useQuery({
    queryKey: ['food', 'stats', menuWeekStart.format('YYYY-MM-DD')],
    queryFn: () => foodApi.getRegistrationStats(menuWeekStart.format('YYYY-MM-DD')),
  });

  const applyDefaultsMutation = useMutation({
    mutationFn: () => foodApi.applyDefaults(regWeekStart.format('YYYY-MM-DD')),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['food', 'registrations'] });
      notifications.show({
        title: 'Standardindstillinger anvendt',
        message: data.detail,
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke anvende standardindstillinger. Sørg for at du har sat dine præferencer først.',
        color: 'red',
      });
    },
  });

  const isLoading = menusLoading || regsLoading;

  // Create a map of registrations by date for registration tab
  const registrationsByDate = new Map<string, MealRegistration>();
  registrations?.forEach((reg) => {
    registrationsByDate.set(reg.date, reg);
  });

  // Create a map of registrations by date for menu view
  const menuRegistrationsByDate = new Map<string, MealRegistration>();
  const menuRegs = menuWeekOffset === regWeekOffset ? registrations : menuWeekRegistrations;
  menuRegs?.forEach((reg) => {
    menuRegistrationsByDate.set(reg.date, reg);
  });

  // Create a map of daily menus by date for the registration week
  const regMenusByDate = new Map<string, DailyMenu>();
  const regWeekMenu = allMenus?.find(
    (m) => m.week_start_date === regWeekStart.format('YYYY-MM-DD')
  );
  regWeekMenu?.daily_menus.forEach((dailyMenu) => {
    regMenusByDate.set(dailyMenu.date, dailyMenu);
  });

  // Helper to get week label
  const getWeekLabel = (offset: number) => {
    if (offset === 0) return 'Denne uge';
    if (offset === 1) return 'Næste uge';
    if (offset === -1) return 'Sidste uge';
    return `${offset > 0 ? '+' : ''}${offset} uger`;
  };

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
            onClick={() => navigate('/mad/admin')}
          >
            Administrer menuer
          </Button>
          <Button
            variant="light"
            leftSection={<IconSettings size={16} />}
            onClick={() => navigate('/mad/praeferencer')}
          >
            Præferencer
          </Button>
          <Button
            variant="light"
            leftSection={<IconTicket size={16} />}
            onClick={() => navigate('/mad/billetter')}
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
          <Tabs.Tab value="registration" leftSection={<IconCalendar size={16} />}>
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
                    {menuWeekStart.format('MMMM D')} - {menuWeekStart.add(3, 'day').format('MMMM D, YYYY')}
                  </Text>
                  <Badge color={menuWeekOffset === 0 ? 'blue' : menuWeekOffset === 1 ? 'green' : 'gray'} variant="light" size="sm">
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

            {isLoading ? (
              <Center h={200}>
                <Loader size="lg" />
              </Center>
            ) : !selectedMenu ? (
              <Alert icon={<IconAlertCircle size={16} />} color="yellow">
                Ingen menu tilgængelig for denne uge endnu. Kom tilbage senere!
              </Alert>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {selectedMenu.daily_menus.map((day) => {
                  const reg = menuRegistrationsByDate.get(day.date);
                  const stats = menuWeekStats?.[day.date];
                  return (
                    <MenuDayCard
                      key={day.id}
                      day={day}
                      myRegistration={reg}
                      stats={stats}
                    />
                  );
                })}
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
                    {regWeekStart.format('MMMM D')} - {regWeekStart.add(3, 'day').format('MMMM D, YYYY')}
                  </Text>
                  <Badge color={regWeekOffset === 1 ? 'green' : regWeekOffset === 0 ? 'blue' : 'gray'} variant="light" size="sm">
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
                  const date = regWeekStart.add(dayOffset, 'day');
                  const dateStr = date.format('YYYY-MM-DD');
                  const registration = registrationsByDate.get(dateStr);
                  const dailyMenu = regMenusByDate.get(dateStr);
                  const isWednesday = dayOffset === 2;
                  const isPast = date.isBefore(dayjs(), 'day');

                  return (
                    <DayRegistrationCard
                      key={dateStr}
                      date={dateStr}
                      dayName={date.format('dddd')}
                      registration={registration}
                      dailyMenu={dailyMenu}
                      isWednesday={isWednesday}
                      isPast={isPast}
                      weekStart={regWeekStart.format('YYYY-MM-DD')}
                    />
                  );
                })}
              </SimpleGrid>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// Menu Day Card with stats
interface MenuDayCardProps {
  day: DailyMenu;
  myRegistration?: MealRegistration;
  stats?: DailyRegistrationStats;
}

function MenuDayCard({ day, myRegistration, stats }: MenuDayCardProps) {
  const [expanded, setExpanded] = useState(false);

  const totalAdults = stats?.total.adults ?? 0;
  const totalChildren = stats?.total.children ?? 0;
  const totalPortions = totalAdults + totalChildren;

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Text fw={500}>{day.day_name}</Text>
          {day.menu_name && (
            <Text size="sm" c="blue" fw={500}>
              {day.menu_name}
            </Text>
          )}
        </div>
        <Stack gap={4} align="flex-end">
          <Badge variant="light">
            {dayjs(day.date).format('MMM D')}
          </Badge>
          {myRegistration && myRegistration.is_active && (
            <Badge color="green" variant="light" size="sm">
              Dig: {myRegistration.total_portions}
            </Badge>
          )}
        </Stack>
      </Group>

      {day.has_meat_option ? (
        <Stack gap="xs" mb="sm">
          <div>
            <Badge size="xs" color="red" mb={4}>
              Kød
            </Badge>
            <Text size="sm">
              {day.effective_meat_description || 'Kommer snart'}
            </Text>
          </div>
          <div>
            <Badge size="xs" color="green" mb={4}>
              Vegetar
            </Badge>
            <Text size="sm">
              {day.effective_vegetarian_description || 'Kommer snart'}
            </Text>
          </div>
        </Stack>
      ) : (
        <Text size="sm" mb="sm">
          {day.effective_description || 'Menu kommer snart'}
        </Text>
      )}

      {/* Total signups */}
      <Divider my="xs" />
      <Group
        justify="space-between"
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <Group gap="xs">
          <IconUsers size={16} />
          <Text size="sm" fw={500}>
            Total: {totalAdults} voksne, {totalChildren} børn ({totalPortions})
          </Text>
        </Group>
        <ActionIcon variant="subtle" size="sm">
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
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
              <Table.Td ta="right" fw={600}>{totalAdults}</Table.Td>
              <Table.Td ta="right" fw={600}>{totalChildren}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Collapse>
    </Paper>
  );
}

interface DayRegistrationCardProps {
  date: string;
  dayName: string;
  registration?: MealRegistration;
  dailyMenu?: DailyMenu;
  isWednesday: boolean;
  isPast: boolean;
  weekStart: string;
}

function DayRegistrationCard({
  date,
  dayName,
  registration,
  dailyMenu,
  isWednesday,
  isPast,
  weekStart,
}: DayRegistrationCardProps) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [ticketModalOpened, { open: openTicketModal, close: closeTicketModal }] = useDisclosure(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Default to house inhabitant count if no registration exists
  const defaultAdults = registration?.adults_count ?? (user?.house_inhabitant_count || 1);
  const [adults, setAdults] = useState(defaultAdults);
  const [children, setChildren] = useState(registration?.children_count ?? 0);
  const [mealType, setMealType] = useState<'meat' | 'vegetarian'>(
    registration?.meal_type ?? 'meat'
  );
  const [diningOption, setDiningOption] = useState<DiningOption>(
    registration?.dining_option ?? 'eat_in'
  );
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    registration?.seating_time ?? '17:30'
  );
  const [isActive, setIsActive] = useState(registration?.is_active ?? true);

  // Ticket creation state
  const [ticketDescription, setTicketDescription] = useState('');

  // Calculate default ticket price using shared utility
  const calculateDefaultPrice = () => {
    const portionCount = registration?.adults_count ?? adults;
    const childCount = registration?.children_count ?? children;
    return calculateDefaultTicketPrice(mealType, portionCount, childCount);
  };
  const [ticketPrice, setTicketPrice] = useState<number | null>(null);

  // Track if initial mount to prevent auto-save on mount
  const [hasInitialized, setHasInitialized] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: CreateMealRegistrationData) => foodApi.createRegistration(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'registrations', weekStart] });
      queryClient.invalidateQueries({ queryKey: ['food', 'stats'] });
      setLastSaved(new Date());
      setIsSaving(false);
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke gemme tilmelding. Prøv venligst igen.',
        color: 'red',
      });
      setIsSaving(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateMealRegistrationData>) =>
      foodApi.updateRegistration(registration!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'registrations', weekStart] });
      queryClient.invalidateQueries({ queryKey: ['food', 'stats'] });
      setLastSaved(new Date());
      setIsSaving(false);
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke gemme tilmelding. Prøv venligst igen.',
        color: 'red',
      });
      setIsSaving(false);
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: (data: CreateFoodTicketData) => foodApi.createTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'tickets'] });
      notifications.show({
        title: 'Billet oprettet',
        message: 'Din madbillet er nu tilgængelig for andre.',
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke oprette billet. Prøv venligst igen.',
        color: 'red',
      });
    },
  });

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (data: CreateMealRegistrationData, regId: number | undefined) => {
      setIsSaving(true);
      if (regId) {
        updateMutation.mutate(data);
      } else {
        createMutation.mutate(data);
      }
    },
    500
  );

  // Auto-save when values change
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true);
      return;
    }

    if (isPast) return;

    const data: CreateMealRegistrationData = {
      date,
      adults_count: adults,
      children_count: children,
      meal_type: mealType,
      dining_option: diningOption,
      seating_time: seatingTime,
      house_id: user?.house ?? null,
      is_active: isActive,
    };

    debouncedSave(data, registration?.id);
  }, [adults, children, mealType, diningOption, seatingTime, isActive]);

  const handleEatingChange = (val: string) => {
    if (val === 'no' && registration?.is_active) {
      // User is switching from eating to not eating - prompt for ticket
      openTicketModal();
    } else {
      setIsActive(val === 'yes');
    }
  };

  const handleCreateTicketAndSave = () => {
    // Create the ticket - use explicit price or calculated default
    const finalPrice = ticketPrice ?? calculateDefaultPrice();
    const ticketData: CreateFoodTicketData = {
      date,
      adults_count: registration?.adults_count ?? adults,
      children_count: registration?.children_count ?? children,
      meal_type: mealType,
      price: finalPrice,
      description: ticketDescription,
    };
    createTicketMutation.mutate(ticketData);

    // Update registration to not active
    setIsActive(false);
    closeTicketModal();
    setTicketPrice(null);
    setTicketDescription('');
  };

  const handleSkipTicket = () => {
    setIsActive(false);
    closeTicketModal();
    setTicketPrice(null);
    setTicketDescription('');
  };

  return (
    <>
      <Paper withBorder p="md" radius="md" opacity={isPast ? 0.6 : 1}>
        <Group justify="space-between" mb="xs">
          <div>
            <Text fw={500}>{dayName}</Text>
            {dailyMenu?.menu_name && (
              <Text size="sm" c="blue" fw={500}>
                {dailyMenu.menu_name}
              </Text>
            )}
          </div>
          <Badge variant="light" color={isPast ? 'gray' : 'blue'}>
            {dayjs(date).format('MMM D')}
          </Badge>
        </Group>

        {dailyMenu && (
          <Text size="xs" c="dimmed" mb="sm" lineClamp={2}>
            {dailyMenu.has_meat_option
              ? `Kød: ${dailyMenu.effective_meat_description || 'Kommer snart'} / Veg: ${dailyMenu.effective_vegetarian_description || 'Kommer snart'}`
              : dailyMenu.effective_description || 'Menu kommer snart'}
          </Text>
        )}

        <Stack gap="sm">
          <SegmentedControl
            value={isActive ? 'yes' : 'no'}
            onChange={handleEatingChange}
            data={[
              { label: 'Spiser', value: 'yes' },
              { label: 'Spiser ikke', value: 'no' },
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
                  onChange={(val) => setMealType(val as 'meat' | 'vegetarian')}
                  data={[
                    { label: 'Kød', value: 'meat' },
                    { label: 'Vegetar', value: 'vegetarian' },
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
                  { label: 'Spise i fælleshuset', value: 'eat_in' },
                  { label: 'Take Away', value: 'take_away' },
                ]}
                fullWidth
                disabled={isPast}
              />
            </div>

            {diningOption === 'eat_in' && (
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Spisetid
                </Text>
                <SegmentedControl
                  value={seatingTime}
                  onChange={(val) => setSeatingTime(val as SeatingTime)}
                  data={[
                    { label: '17:30', value: '17:30' },
                    { label: '18:30', value: '18:30' },
                  ]}
                  fullWidth
                  disabled={isPast}
                />
              </div>
            )}

            {user?.house && (
              <Text size="xs" c="blue" ta="center">
                Tilmeldes for {user.house_name || `Hus ${user.house}`}
              </Text>
            )}
          </>
        )}

        {/* Saving indicator */}
        {!isPast && (
          <Text size="xs" c={isSaving ? 'blue' : lastSaved ? 'green' : 'dimmed'} ta="center">
            {isSaving ? (
              <Group gap={4} justify="center">
                <Loader size={12} />
                Gemmer...
              </Group>
            ) : lastSaved ? (
              `Gemt`
            ) : registration ? (
              'Gemmes automatisk ved ændringer'
            ) : (
              'Gemmes automatisk ved ændringer'
            )}
          </Text>
        )}

        {registration && registration.is_active && (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" ta="center">
              {registration.total_portions} portioner • {registration.dining_option === 'eat_in' ? `Spiser kl. ${registration.seating_time}` : 'Take away'}
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
            description={`Foreslået pris: ${calculateDefaultPrice()} kr (${mealType === 'meat' ? '37' : '26'}/voksen + 18/barn)`}
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
  );
}
