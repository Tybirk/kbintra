import { useState } from 'react';
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
  Alert,
  Tabs,
  Modal,
  Textarea,
  Avatar,
  Card,
  Collapse,
  ActionIcon,
  Divider,
  Checkbox,
  SimpleGrid,
  TextInput,
  Select,
  Table,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { DatePickerInput, DateTimePicker } from '@mantine/dates';
import {
  IconUsers,
  IconCalendar,
  IconArrowsExchange,
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconX,
  IconClipboardList,
  IconSend,
  IconSettings,
  IconPlayerPlay,
  IconPlus,
  IconReceipt,
} from '@tabler/icons-react';
import dayjs from 'dayjs';

import { foodApi } from '../api/food';
import { useAuthStore } from '../store/authStore';
import type { FoodTeam, FoodTeamListItem, TeamSwapRequest, FoodTeamMember, FoodTeamCycle, TeamGenerationResult } from '../types';

export default function FoodTeamsPage() {
  const { user } = useAuthStore();

  // Fetch my teams
  const { data: myTeams, isLoading: myTeamsLoading } = useQuery({
    queryKey: ['food', 'teams', 'my'],
    queryFn: foodApi.getMyTeams,
  });

  // Fetch all upcoming teams
  const { data: allTeams, isLoading: allTeamsLoading } = useQuery({
    queryKey: ['food', 'teams', 'all'],
    queryFn: () => foodApi.getTeams(),
  });

  // Fetch swap requests
  const { data: swapRequests, isLoading: swapRequestsLoading } = useQuery({
    queryKey: ['food', 'swap-requests'],
    queryFn: foodApi.getSwapRequests,
  });

  // Fetch active cycle for wish submission
  const { data: activeCycle, isLoading: cycleLoading } = useQuery({
    queryKey: ['food', 'cycles', 'active'],
    queryFn: foodApi.getActiveCycle,
    retry: false,
  });

  const pendingRequests = swapRequests?.filter((r) => r.status === 'pending') ?? [];
  const incomingRequests = pendingRequests.filter((r) => r.is_incoming);
  const outgoingRequests = pendingRequests.filter((r) => r.is_outgoing);

  const isLoading = myTeamsLoading || allTeamsLoading || swapRequestsLoading;

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Food Teams</Title>
          <Text c="dimmed">Your cooking schedule and team swaps</Text>
        </div>
      </Group>

      <Tabs defaultValue="my-teams">
        <Tabs.List mb="md">
          <Tabs.Tab value="my-teams" leftSection={<IconCalendar size={16} />}>
            My Teams
          </Tabs.Tab>
          <Tabs.Tab value="all-teams" leftSection={<IconUsers size={16} />}>
            All Teams
          </Tabs.Tab>
          <Tabs.Tab
            value="swaps"
            leftSection={<IconArrowsExchange size={16} />}
            rightSection={
              pendingRequests.length > 0 ? (
                <Badge size="xs" color="red" variant="filled">
                  {pendingRequests.length}
                </Badge>
              ) : null
            }
          >
            Swap Requests
          </Tabs.Tab>
          <Tabs.Tab
            value="wishes"
            leftSection={<IconClipboardList size={16} />}
            rightSection={
              activeCycle?.is_accepting_wishes && !activeCycle?.my_wish_submitted ? (
                <Badge size="xs" color="orange" variant="filled">
                  !
                </Badge>
              ) : null
            }
          >
            Submit Wishes
          </Tabs.Tab>
          {user?.is_staff && (
            <Tabs.Tab value="admin" leftSection={<IconSettings size={16} />}>
              Admin
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="my-teams">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : !myTeams || myTeams.length === 0 ? (
            <Alert icon={<IconAlertCircle size={16} />} color="blue">
              You are not assigned to any upcoming cooking teams.
            </Alert>
          ) : (
            <Stack gap="md">
              {myTeams.map((team) => (
                <MyTeamCard
                  key={team.id}
                  team={team}
                  allTeams={allTeams ?? []}
                  myTeams={myTeams}
                  currentUserId={user?.id}
                />
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="all-teams">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : !allTeams || allTeams.length === 0 ? (
            <Alert icon={<IconAlertCircle size={16} />} color="yellow">
              No upcoming cooking teams scheduled.
            </Alert>
          ) : (
            <Stack gap="sm">
              {allTeams.map((team) => (
                <AllTeamCard key={team.id} team={team} />
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="swaps">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : (
            <Stack gap="lg">
              {/* Incoming requests */}
              <div>
                <Title order={4} mb="sm">
                  Incoming Requests
                </Title>
                {incomingRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No incoming swap requests.
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {incomingRequests.map((request) => (
                      <SwapRequestCard key={request.id} request={request} />
                    ))}
                  </Stack>
                )}
              </div>

              <Divider />

              {/* Outgoing requests */}
              <div>
                <Title order={4} mb="sm">
                  My Requests
                </Title>
                {outgoingRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    You have no pending swap requests.
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {outgoingRequests.map((request) => (
                      <SwapRequestCard key={request.id} request={request} />
                    ))}
                  </Stack>
                )}
              </div>
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="wishes">
          {cycleLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : !activeCycle ? (
            <Alert icon={<IconAlertCircle size={16} />} color="blue">
              There is no active cooking cycle at the moment. Please check back later when a new cycle is announced.
            </Alert>
          ) : (
            <WishSubmissionPanel cycle={activeCycle} />
          )}
        </Tabs.Panel>

        {user?.is_staff && (
          <Tabs.Panel value="admin">
            <AdminPanel />
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  );
}

// Wish Submission Panel
interface WishSubmissionPanelProps {
  cycle: FoodTeamCycle;
}

function WishSubmissionPanel({ cycle }: WishSubmissionPanelProps) {
  const queryClient = useQueryClient();
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Fetch existing wish
  const { data: existingWish, isLoading: wishLoading } = useQuery({
    queryKey: ['food', 'wishes', 'my', cycle.id],
    queryFn: () => foodApi.getMyWish(cycle.id),
    retry: false,
    refetchOnMount: true,
  });

  // Fetch default cooking days
  const { data: defaultCookingDaysData } = useQuery({
    queryKey: ['food', 'default-cooking-days'],
    queryFn: foodApi.getDefaultCookingDays,
  });

  // Update default cooking days mutation
  const updateDefaultsMutation = useMutation({
    mutationFn: foodApi.updateDefaultCookingDays,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'default-cooking-days'] });
      notifications.show({
        title: 'Defaults saved',
        message: 'Your default cooking days have been saved.',
        color: 'green',
      });
    },
  });

  const defaultDays = defaultCookingDaysData?.default_cooking_days ?? [];

  const handleDefaultDayToggle = (day: number) => {
    const newDefaults = defaultDays.includes(day)
      ? defaultDays.filter((d) => d !== day)
      : [...defaultDays, day].sort();
    updateDefaultsMutation.mutate(newDefaults);
  };

  // Apply defaults to selected dates when first loading (if no existing wish)
  const applyDefaultsToSelection = () => {
    if (defaultDays.length === 0) return;

    // Find cooking dates that match the default weekdays
    const matchingDates = cycle.cooking_dates.filter((date) => {
      const weekday = dayjs(date).day(); // 0=Sunday, 1=Monday, etc.
      // Convert to our format: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday
      const adjustedDay = weekday === 0 ? 6 : weekday - 1;
      return defaultDays.includes(adjustedDay);
    });

    setSelectedDates(matchingDates);
    setDefaultsApplied(true);
  };

  // Initialize selected dates from existing wish
  useState(() => {
    if (existingWish) {
      setSelectedDates(existingWish.available_dates);
      setComment(existingWish.comment);
    }
  });

  const submitWishMutation = useMutation({
    mutationFn: (data: { available_dates: string[]; comment: string }) =>
      foodApi.submitWish(cycle.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'wishes', 'my', cycle.id] });
      queryClient.invalidateQueries({ queryKey: ['food', 'cycles', 'active'] });
      notifications.show({
        title: 'Wish submitted',
        message: 'Your date preferences have been saved.',
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to submit wish. Please try again.',
        color: 'red',
      });
    },
  });

  const handleDateToggle = (date: string) => {
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]
    );
  };

  const handleSelectAll = () => {
    setSelectedDates(cycle.cooking_dates);
  };

  const handleClearAll = () => {
    setSelectedDates([]);
  };

  const handleSubmit = () => {
    submitWishMutation.mutate({
      available_dates: selectedDates,
      comment,
    });
  };

  // Update selected dates when existing wish loads
  if (existingWish && selectedDates.length === 0 && existingWish.available_dates.length > 0) {
    setSelectedDates(existingWish.available_dates);
    setComment(existingWish.comment);
  }

  if (wishLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  const deadlinePassed = dayjs(cycle.wish_deadline).isBefore(dayjs());

  return (
    <Stack gap="lg">
      <Card withBorder p="lg" radius="md">
        <Stack gap="md">
          <div>
            <Group justify="space-between" mb="xs">
              <Title order={3}>{cycle.name}</Title>
              <Badge
                color={cycle.is_accepting_wishes ? 'green' : deadlinePassed ? 'red' : 'gray'}
                size="lg"
              >
                {cycle.is_accepting_wishes ? 'Accepting Wishes' : deadlinePassed ? 'Closed' : cycle.status}
              </Badge>
            </Group>
            <Text c="dimmed" size="sm">
              Cooking period: {cycle.cooking_dates.length > 0
                ? `${dayjs(cycle.cooking_dates[0]).format('MMMM D')} - ${dayjs(cycle.cooking_dates[cycle.cooking_dates.length - 1]).format('MMMM D, YYYY')} (${cycle.cooking_dates.length} days)`
                : 'No dates selected'}
            </Text>
            <Text c="dimmed" size="sm">
              Deadline: {dayjs(cycle.wish_deadline).format('MMMM D, YYYY [at] HH:mm')}
            </Text>
          </div>

          {existingWish && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                You have already submitted your wishes ({existingWish.available_date_count} dates selected).
                You can update them below until the deadline.
              </Text>
            </Alert>
          )}

          {!cycle.is_accepting_wishes ? (
            <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
              This cycle is no longer accepting wishes. The deadline has passed.
            </Alert>
          ) : (
            <>
              {/* Default cooking days section */}
              <Paper withBorder p="md" radius="md" bg="gray.0">
                <Text fw={500} mb="sm">
                  Your default cooking days
                </Text>
                <Text size="sm" c="dimmed" mb="md">
                  Set your typical availability. These will be saved and can be applied to future cycles.
                </Text>
                <Group gap="md" mb="md">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday'].map((day, index) => (
                    <Checkbox
                      key={day}
                      label={day}
                      checked={defaultDays.includes(index)}
                      onChange={() => handleDefaultDayToggle(index)}
                    />
                  ))}
                </Group>
                {defaultDays.length > 0 && !existingWish && (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={applyDefaultsToSelection}
                    disabled={defaultsApplied}
                  >
                    {defaultsApplied ? 'Defaults applied' : 'Apply defaults to selection below'}
                  </Button>
                )}
              </Paper>

              <Divider />

              <div>
                <Group justify="space-between" mb="sm">
                  <Text fw={500}>Select dates you are available to cook:</Text>
                  <Group gap="xs">
                    <Button variant="subtle" size="xs" onClick={handleSelectAll}>
                      Select all
                    </Button>
                    <Button variant="subtle" size="xs" color="gray" onClick={handleClearAll}>
                      Clear all
                    </Button>
                  </Group>
                </Group>
                <Text size="sm" c="dimmed" mb="md">
                  Select all dates when you CAN cook. The more dates you select, the better chance you have of being assigned.
                </Text>
                <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
                  {cycle.cooking_dates.map((date) => {
                    const isSelected = selectedDates.includes(date);
                    const dayName = dayjs(date).format('ddd');
                    return (
                      <Paper
                        key={date}
                        withBorder
                        p="sm"
                        radius="md"
                        style={{ cursor: 'pointer' }}
                        bg={isSelected ? 'green.0' : undefined}
                        onClick={() => handleDateToggle(date)}
                      >
                        <Group gap="sm">
                          <Checkbox
                            checked={isSelected}
                            onChange={() => handleDateToggle(date)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div>
                            <Text size="sm" fw={500}>
                              {dayName}, {dayjs(date).format('MMM D')}
                            </Text>
                          </div>
                        </Group>
                      </Paper>
                    );
                  })}
                </SimpleGrid>
              </div>

              <Textarea
                label="Comment (optional)"
                description="Any special circumstances or preferences"
                placeholder="E.g., I prefer to cook with my housemate, I can only do Mondays in week 2..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                minRows={2}
              />

              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {selectedDates.length} of {cycle.cooking_dates.length} dates selected
                </Text>
                <Button
                  leftSection={<IconSend size={16} />}
                  onClick={handleSubmit}
                  loading={submitWishMutation.isPending}
                  disabled={selectedDates.length === 0}
                >
                  {existingWish ? 'Update Wishes' : 'Submit Wishes'}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// Admin Panel for managing cycles and generating teams
function AdminPanel() {
  const queryClient = useQueryClient();
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [generationResult, setGenerationResult] = useState<TeamGenerationResult | null>(null);

  // Fetch all cycles
  const { data: cycles, isLoading: cyclesLoading } = useQuery({
    queryKey: ['food', 'cycles'],
    queryFn: foodApi.getCycles,
  });

  // Create cycle mutation
  const createCycleMutation = useMutation({
    mutationFn: foodApi.createCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'cycles'] });
      notifications.show({
        title: 'Cycle created',
        message: 'The new food team cycle has been created.',
        color: 'green',
      });
      closeCreateModal();
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to create cycle.',
        color: 'red',
      });
    },
  });

  // Generate teams mutation
  const generateTeamsMutation = useMutation({
    mutationFn: ({ cycleId, dryRun }: { cycleId: number; dryRun: boolean }) =>
      foodApi.generateTeams(cycleId, dryRun),
    onSuccess: (result) => {
      setGenerationResult(result);
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['food', 'cycles'] });
        queryClient.invalidateQueries({ queryKey: ['food', 'teams'] });
        notifications.show({
          title: 'Teams generated',
          message: `Successfully created ${result.teams_created} teams.`,
          color: 'green',
        });
      }
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to generate teams.',
        color: 'red',
      });
    },
  });

  if (cyclesLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Manage Cycles</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Create Cycle
        </Button>
      </Group>

      {!cycles || cycles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue">
          No cycles have been created yet. Create a cycle to start collecting wishes.
        </Alert>
      ) : (
        <Stack gap="md">
          {cycles.map((cycle) => (
            <CycleAdminCard
              key={cycle.id}
              cycle={cycle}
              onGenerate={(dryRun) =>
                generateTeamsMutation.mutate({ cycleId: cycle.id, dryRun })
              }
              isGenerating={generateTeamsMutation.isPending}
            />
          ))}
        </Stack>
      )}

      {generationResult && (
        <Modal
          opened={!!generationResult}
          onClose={() => setGenerationResult(null)}
          title="Team Generation Result"
          size="lg"
        >
          <Stack gap="md">
            <Alert
              color={generationResult.success ? 'green' : 'red'}
              icon={generationResult.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
            >
              {generationResult.message}
            </Alert>

            <Text>Teams created: {generationResult.teams_created}</Text>

            {generationResult.unassigned_persons.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Unassigned persons ({generationResult.unassigned_persons.length}):
                </Text>
                <Paper withBorder p="sm" bg="yellow.0">
                  <Text size="sm">{generationResult.unassigned_persons.join(', ')}</Text>
                </Paper>
              </div>
            )}

            {generationResult.warnings.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Warnings:
                </Text>
                <Stack gap="xs">
                  {generationResult.warnings.map((warning, i) => (
                    <Alert key={i} color="yellow" variant="light" p="xs">
                      {warning}
                    </Alert>
                  ))}
                </Stack>
              </div>
            )}

            <Button onClick={() => setGenerationResult(null)}>Close</Button>
          </Stack>
        </Modal>
      )}

      <CreateCycleModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onCreate={(data) => createCycleMutation.mutate(data)}
        isLoading={createCycleMutation.isPending}
      />

      <Divider my="xl" />

      {/* Monthly Food Cost Report */}
      <MonthlyCostReport />
    </Stack>
  );
}

// Monthly Cost Report Component
function MonthlyCostReport() {
  const currentDate = dayjs();
  const [selectedYear, setSelectedYear] = useState(currentDate.year().toString());
  const [selectedMonth, setSelectedMonth] = useState((currentDate.month() + 1).toString());

  const { data: costReport, isLoading } = useQuery({
    queryKey: ['food', 'monthly-cost', selectedYear, selectedMonth],
    queryFn: () => foodApi.getMonthlyFoodCost(parseInt(selectedYear), parseInt(selectedMonth)),
    enabled: !!selectedYear && !!selectedMonth,
  });

  const years = Array.from({ length: 5 }, (_, i) => {
    const year = currentDate.year() - 2 + i;
    return { value: year.toString(), label: year.toString() };
  });

  const months = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  return (
    <>
      <Group justify="space-between">
        <Title order={3}>
          <Group gap="xs">
            <IconReceipt size={24} />
            Monthly Food Cost Report
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
              <Text c="dimmed">No food tickets claimed this month.</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>House</Table.Th>
                    <Table.Th ta="right">Tickets</Table.Th>
                    <Table.Th ta="right">Adults</Table.Th>
                    <Table.Th ta="right">Children</Table.Th>
                    <Table.Th ta="right">Total Cost</Table.Th>
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
                      {costReport.houses.reduce((sum, h) => sum + h.ticket_count, 0)}
                    </Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {costReport.houses.reduce((sum, h) => sum + h.adult_portions, 0)}
                    </Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {costReport.houses.reduce((sum, h) => sum + h.child_portions, 0)}
                    </Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {parseFloat(costReport.total_cost).toFixed(2)} kr
                    </Table.Td>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            )}
          </Stack>
        </Card>
      ) : null}
    </>
  );
}

// Cycle Admin Card
interface CycleAdminCardProps {
  cycle: FoodTeamCycle;
  onGenerate: (dryRun: boolean) => void;
  isGenerating: boolean;
}

function CycleAdminCard({ cycle, onGenerate, isGenerating }: CycleAdminCardProps) {
  const statusColors: Record<string, string> = {
    draft: 'gray',
    collecting_wishes: 'blue',
    generating: 'yellow',
    finalized: 'green',
  };

  return (
    <Card withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Text fw={600} size="lg">
            {cycle.name}
          </Text>
          <Text size="sm" c="dimmed">
            {cycle.cooking_dates.length > 0
              ? `${dayjs(cycle.cooking_dates[0]).format('MMM D')} - ${dayjs(cycle.cooking_dates[cycle.cooking_dates.length - 1]).format('MMM D, YYYY')}`
              : 'No dates'}
          </Text>
        </div>
        <Badge color={statusColors[cycle.status] || 'gray'} size="lg">
          {cycle.status.replace('_', ' ')}
        </Badge>
      </Group>

      <SimpleGrid cols={4} mb="md">
        <div>
          <Text size="xs" c="dimmed">
            Cooking Days
          </Text>
          <Text fw={500}>{cycle.cooking_dates.length}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Wishes
          </Text>
          <Text fw={500}>{cycle.wish_count}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Teams
          </Text>
          <Text fw={500}>{cycle.team_count}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Deadline
          </Text>
          <Text fw={500}>{dayjs(cycle.wish_deadline).format('MMM D, HH:mm')}</Text>
        </div>
      </SimpleGrid>

      {cycle.status !== 'finalized' && (
        <Group>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => onGenerate(true)}
            loading={isGenerating}
          >
            Preview (Dry Run)
          </Button>
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => onGenerate(false)}
            loading={isGenerating}
          >
            Generate Teams
          </Button>
        </Group>
      )}
    </Card>
  );
}

// Create Cycle Modal
interface CreateCycleModalProps {
  opened: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    cooking_dates: string[];
    wish_deadline: string;
  }) => void;
  isLoading: boolean;
}

function CreateCycleModal({ opened, onClose, onCreate, isLoading }: CreateCycleModalProps) {
  const [name, setName] = useState('');
  const [cookingDates, setCookingDates] = useState<Date[]>([]);
  const [wishDeadline, setWishDeadline] = useState<Date | null>(null);

  const handleSubmit = () => {
    onCreate({
      name,
      cooking_dates: cookingDates.map((d) => dayjs(d).format('YYYY-MM-DD')),
      wish_deadline: wishDeadline ? dayjs(wishDeadline).toISOString() : '',
    });
  };

  const handleClose = () => {
    // Reset form on close
    setName('');
    setCookingDates([]);
    setWishDeadline(null);
    onClose();
  };

  const isValid = name && cookingDates.length > 0 && wishDeadline;

  return (
    <Modal opened={opened} onClose={handleClose} title="Create Food Team Cycle" centered size="lg">
      <Stack gap="md">
        <TextInput
          label="Cycle Name"
          placeholder="e.g., January 2025 Cycle"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <DatePickerInput
          type="multiple"
          label="Cooking Dates"
          placeholder="Click to select dates"
          value={cookingDates}
          onChange={setCookingDates}
          required
          description={`${cookingDates.length} date${cookingDates.length !== 1 ? 's' : ''} selected. Click dates to add/remove them.`}
          valueFormat="ddd, MMM D"
          clearable
        />

        {cookingDates.length > 0 && (
          <Paper withBorder p="sm" bg="gray.0">
            <Text size="sm" fw={500} mb="xs">
              Selected dates ({cookingDates.length}):
            </Text>
            <Text size="sm" c="dimmed">
              {[...cookingDates]
                .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())
                .map((d) => dayjs(d).format('ddd, MMM D'))
                .join(' - ')}
            </Text>
          </Paper>
        )}

        <DateTimePicker
          label="Wish Deadline"
          placeholder="Select deadline for wish submission"
          value={wishDeadline}
          onChange={setWishDeadline}
          required
          description="Users must submit their date preferences before this deadline"
        />

        <Group justify="flex-end">
          <Button variant="light" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isLoading} disabled={!isValid}>
            Create Cycle
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// My Team Card with swap request capability
interface MyTeamCardProps {
  team: FoodTeam;
  allTeams: FoodTeamListItem[];
  myTeams: FoodTeam[];
  currentUserId?: number;
}

function MyTeamCard({ team, allTeams, myTeams, currentUserId }: MyTeamCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [swapModalOpened, { open: openSwapModal, close: closeSwapModal }] = useDisclosure(false);
  const [selectedTargetTeamId, setSelectedTargetTeamId] = useState<number | null>(null);
  const [selectedTargetMemberId, setSelectedTargetMemberId] = useState<number | null>(null);
  const [swapMessage, setSwapMessage] = useState('');
  const queryClient = useQueryClient();

  // Find my membership in this team
  const myMembership = team.members.find((m) => m.user.id === currentUserId);

  // Get teams I'm not already on (for swap targets)
  const myTeamDates = new Set(myTeams.map((t) => t.date));
  const availableSwapTeams = allTeams.filter((t) => !myTeamDates.has(t.date));

  // Fetch selected team details for swap
  const { data: selectedTeamDetails } = useQuery({
    queryKey: ['food', 'teams', selectedTargetTeamId],
    queryFn: () => foodApi.getTeam(selectedTargetTeamId!),
    enabled: !!selectedTargetTeamId,
  });

  const createSwapMutation = useMutation({
    mutationFn: foodApi.createSwapRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'swap-requests'] });
      notifications.show({
        title: 'Swap requested',
        message: 'Your swap request has been sent.',
        color: 'green',
      });
      closeSwapModal();
      setSelectedTargetTeamId(null);
      setSelectedTargetMemberId(null);
      setSwapMessage('');
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to create swap request.',
        color: 'red',
      });
    },
  });

  const handleRequestSwap = () => {
    if (!myMembership || !selectedTargetMemberId) return;
    createSwapMutation.mutate({
      requester_membership_id: myMembership.id,
      target_membership_id: selectedTargetMemberId,
      message: swapMessage,
    });
  };

  const isPast = dayjs(team.date).isBefore(dayjs(), 'day');

  return (
    <>
      <Card withBorder p="md" radius="md" bg={isPast ? 'gray.0' : undefined}>
        <Group justify="space-between" mb="xs">
          <Group>
            <div>
              <Text fw={600} size="lg">
                {team.day_name}, {dayjs(team.date).format('MMMM D, YYYY')}
              </Text>
              <Text size="sm" c="dimmed">
                {team.member_count} team members
              </Text>
            </div>
          </Group>
          <Group>
            {isPast ? (
              <Badge color="gray">Past</Badge>
            ) : (
              <Button
                variant="light"
                size="xs"
                leftSection={<IconArrowsExchange size={14} />}
                onClick={openSwapModal}
              >
                Request Swap
              </Button>
            )}
          </Group>
        </Group>

        <Group
          gap="xs"
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
          mb={expanded ? 'sm' : 0}
        >
          <Text size="sm" fw={500}>
            Team members
          </Text>
          <ActionIcon variant="subtle" size="xs">
            {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </ActionIcon>
        </Group>

        <Collapse in={expanded}>
          <Stack gap="xs">
            {team.members.map((member) => (
              <TeamMemberRow key={member.id} member={member} />
            ))}
          </Stack>
        </Collapse>
      </Card>

      {/* Swap Request Modal */}
      <Modal
        opened={swapModalOpened}
        onClose={closeSwapModal}
        title="Request Team Swap"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Select another team date to swap with. The person you select will need to accept your
            request.
          </Text>

          <div>
            <Text fw={500} mb="xs">
              Your date: {dayjs(team.date).format('dddd, MMMM D, YYYY')}
            </Text>
          </div>

          <div>
            <Text fw={500} mb="xs">
              Select a date to swap with:
            </Text>
            <Stack gap="xs">
              {availableSwapTeams.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No other team dates available.
                </Text>
              ) : (
                availableSwapTeams.slice(0, 8).map((t) => (
                  <Paper
                    key={t.id}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{ cursor: 'pointer' }}
                    bg={selectedTargetTeamId === t.id ? 'blue.0' : undefined}
                    onClick={() => {
                      setSelectedTargetTeamId(t.id);
                      setSelectedTargetMemberId(null);
                    }}
                  >
                    <Group justify="space-between">
                      <div>
                        <Text fw={500}>
                          {t.day_name}, {dayjs(t.date).format('MMMM D')}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t.members_display}
                        </Text>
                      </div>
                      {selectedTargetTeamId === t.id && (
                        <Badge color="blue" variant="light">
                          Selected
                        </Badge>
                      )}
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </div>

          {selectedTargetTeamId && selectedTeamDetails && (
            <div>
              <Text fw={500} mb="xs">
                Select who to swap with:
              </Text>
              <Stack gap="xs">
                {selectedTeamDetails.members.map((member) => (
                  <Paper
                    key={member.id}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{ cursor: 'pointer' }}
                    bg={selectedTargetMemberId === member.id ? 'green.0' : undefined}
                    onClick={() => setSelectedTargetMemberId(member.id)}
                  >
                    <Group>
                      <Avatar
                        src={member.user.profile_picture}
                        radius="xl"
                        size="sm"
                      >
                        {member.user.first_name[0]}
                      </Avatar>
                      <div>
                        <Text size="sm" fw={500}>
                          {member.user.first_name} {member.user.last_name}
                        </Text>
                        {member.house_number && (
                          <Text size="xs" c="dimmed">
                            House {member.house_number}
                          </Text>
                        )}
                      </div>
                      {selectedTargetMemberId === member.id && (
                        <Badge color="green" variant="light" ml="auto">
                          Selected
                        </Badge>
                      )}
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </div>
          )}

          <Textarea
            label="Message (optional)"
            placeholder="Add a message to your swap request..."
            value={swapMessage}
            onChange={(e) => setSwapMessage(e.target.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={closeSwapModal}>
              Cancel
            </Button>
            <Button
              onClick={handleRequestSwap}
              disabled={!selectedTargetMemberId}
              loading={createSwapMutation.isPending}
            >
              Send Request
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// All Teams Card (compact view)
interface AllTeamCardProps {
  team: FoodTeamListItem;
}

function AllTeamCard({ team }: AllTeamCardProps) {
  const isPast = dayjs(team.date).isBefore(dayjs(), 'day');

  return (
    <Paper withBorder p="sm" radius="md" bg={team.is_my_team ? 'blue.0' : isPast ? 'gray.0' : undefined}>
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Text fw={500}>
              {team.day_name}, {dayjs(team.date).format('MMM D')}
            </Text>
            {team.is_my_team && (
              <Badge size="sm" color="blue" variant="filled">
                My Team
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {team.members_display}
          </Text>
        </div>
        <Badge variant="light">{team.member_count} members</Badge>
      </Group>
    </Paper>
  );
}

// Team Member Row
interface TeamMemberRowProps {
  member: FoodTeamMember;
}

function TeamMemberRow({ member }: TeamMemberRowProps) {
  return (
    <Group gap="sm">
      <Avatar src={member.user.profile_picture} radius="xl" size="sm">
        {member.user.first_name[0]}
      </Avatar>
      <div>
        <Text size="sm" fw={member.is_own ? 600 : 400}>
          {member.user.first_name} {member.user.last_name}
          {member.is_own && ' (You)'}
        </Text>
        {member.house_number && (
          <Text size="xs" c="dimmed">
            House {member.house_number}
          </Text>
        )}
      </div>
    </Group>
  );
}

// Swap Request Card
interface SwapRequestCardProps {
  request: TeamSwapRequest;
}

function SwapRequestCard({ request }: SwapRequestCardProps) {
  const [responseMessage, setResponseMessage] = useState('');
  const [showResponseInput, setShowResponseInput] = useState(false);
  const queryClient = useQueryClient();

  const respondMutation = useMutation({
    mutationFn: ({ action, message }: { action: 'accept' | 'decline'; message: string }) =>
      foodApi.respondSwapRequest(request.id, { action, response_message: message }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['food', 'swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['food', 'teams'] });
      notifications.show({
        title: variables.action === 'accept' ? 'Swap accepted' : 'Swap declined',
        message:
          variables.action === 'accept'
            ? 'The team swap has been completed.'
            : 'The swap request has been declined.',
        color: variables.action === 'accept' ? 'green' : 'orange',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to respond to swap request.',
        color: 'red',
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => foodApi.cancelSwapRequest(request.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food', 'swap-requests'] });
      notifications.show({
        title: 'Request cancelled',
        message: 'Your swap request has been cancelled.',
        color: 'blue',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to cancel swap request.',
        color: 'red',
      });
    },
  });

  const handleAccept = () => {
    respondMutation.mutate({ action: 'accept', message: responseMessage });
  };

  const handleDecline = () => {
    respondMutation.mutate({ action: 'decline', message: responseMessage });
  };

  return (
    <Card withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Avatar
              src={request.requester.profile_picture}
              radius="xl"
              size="sm"
            >
              {request.requester.first_name[0]}
            </Avatar>
            <div>
              {request.is_incoming ? (
                <Text size="sm">
                  <Text span fw={600}>
                    {request.requester.first_name} {request.requester.last_name}
                  </Text>{' '}
                  wants to swap with you
                </Text>
              ) : (
                <Text size="sm">
                  You requested to swap with{' '}
                  <Text span fw={600}>
                    {request.target_membership.user.first_name}{' '}
                    {request.target_membership.user.last_name}
                  </Text>
                </Text>
              )}
            </div>
          </Group>
          <Badge
            color={
              request.status === 'pending'
                ? 'yellow'
                : request.status === 'accepted'
                ? 'green'
                : 'red'
            }
          >
            {request.status}
          </Badge>
        </Group>

        <Group gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Their date
            </Text>
            <Text size="sm" fw={500}>
              {request.requester_membership.team_day_name},{' '}
              {dayjs(request.requester_membership.team_date).format('MMM D')}
            </Text>
          </div>
          <IconArrowsExchange size={16} />
          <div>
            <Text size="xs" c="dimmed">
              Your date
            </Text>
            <Text size="sm" fw={500}>
              {request.target_membership.team_day_name},{' '}
              {dayjs(request.target_membership.team_date).format('MMM D')}
            </Text>
          </div>
        </Group>

        {request.message && (
          <Paper p="xs" bg="gray.0" radius="sm">
            <Text size="sm" c="dimmed">
              "{request.message}"
            </Text>
          </Paper>
        )}

        {request.status === 'pending' && (
          <>
            {request.is_incoming ? (
              <>
                {showResponseInput && (
                  <Textarea
                    placeholder="Optional response message..."
                    value={responseMessage}
                    onChange={(e) => setResponseMessage(e.target.value)}
                    size="sm"
                  />
                )}
                <Group>
                  {!showResponseInput && (
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => setShowResponseInput(true)}
                    >
                      Add message
                    </Button>
                  )}
                  <Group ml="auto">
                    <Button
                      variant="light"
                      color="red"
                      size="sm"
                      leftSection={<IconX size={14} />}
                      onClick={handleDecline}
                      loading={respondMutation.isPending}
                    >
                      Decline
                    </Button>
                    <Button
                      color="green"
                      size="sm"
                      leftSection={<IconCheck size={14} />}
                      onClick={handleAccept}
                      loading={respondMutation.isPending}
                    >
                      Accept
                    </Button>
                  </Group>
                </Group>
              </>
            ) : (
              <Button
                variant="light"
                color="gray"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                loading={cancelMutation.isPending}
              >
                Cancel Request
              </Button>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
