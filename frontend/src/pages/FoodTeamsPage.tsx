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
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import { DatePickerInput, DateTimePicker } from "@mantine/dates"
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
} from "@tabler/icons-react"
import dayjs from "dayjs"
import "dayjs/locale/da"

dayjs.locale("da")

import { foodApi } from "../api/food"
import { useAuthStore } from "../store/authStore"
import type {
  FoodTeam,
  FoodTeamListItem,
  TeamSwapRequest,
  FoodTeamMember,
  FoodTeamCycle,
  TeamGenerationResult,
} from "../types"

interface WishSubmitData {
  available_dates: string[]
  comment: string
}

interface GenerateTeamsParams {
  cycleId: number
  dryRun: boolean
}

export default function FoodTeamsPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()
  const { user } = useAuthStore()

  // Path-based tab state
  const validTabs = ["my-teams", "all-teams", "swaps", "wishes", "admin"]
  const activeTab = tab && validTabs.includes(tab) ? tab : "my-teams"
  const setActiveTab = (newTab: string | null) => {
    if (newTab && newTab !== "my-teams") {
      navigate(`/madhold/${newTab}`)
    } else {
      navigate("/madhold")
    }
  }

  // Fetch my teams
  const { data: myTeams, isLoading: myTeamsLoading } = useQuery({
    queryKey: ["food", "teams", "my"],
    queryFn: foodApi.getMyTeams,
  })

  // Fetch all upcoming teams
  const { data: allTeams, isLoading: allTeamsLoading } = useQuery({
    queryKey: ["food", "teams", "all"],
    queryFn: () => foodApi.getTeams(),
  })

  // Fetch swap requests
  const { data: swapRequests, isLoading: swapRequestsLoading } = useQuery({
    queryKey: ["food", "swap-requests"],
    queryFn: foodApi.getSwapRequests,
  })

  // Fetch active cycle for wish submission
  const { data: activeCycle, isLoading: cycleLoading } = useQuery({
    queryKey: ["food", "cycles", "active"],
    queryFn: foodApi.getActiveCycle,
    retry: false,
  })

  const pendingRequests =
    swapRequests?.filter((r) => r.status === "pending") ?? []
  const incomingRequests = pendingRequests.filter((r) => r.is_incoming)
  const outgoingRequests = pendingRequests.filter((r) => r.is_outgoing)

  const isLoading = myTeamsLoading || allTeamsLoading || swapRequestsLoading

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Madhold</Title>
          <Text c="dimmed">Din madlavningsplan og bytte af vagter</Text>
        </div>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="my-teams" leftSection={<IconCalendar size={16} />}>
            Mine hold
          </Tabs.Tab>
          <Tabs.Tab value="all-teams" leftSection={<IconUsers size={16} />}>
            Alle hold
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
            Bytteanmodninger
          </Tabs.Tab>
          <Tabs.Tab
            value="wishes"
            leftSection={<IconClipboardList size={16} />}
            rightSection={
              activeCycle?.is_accepting_wishes &&
              !activeCycle?.my_wish_submitted ? (
                <Badge size="xs" color="orange" variant="filled">
                  !
                </Badge>
              ) : null
            }
          >
            Indsend ønsker
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
              Du er ikke tildelt nogle kommende madhold.
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
              Ingen kommende madhold planlagt.
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
                  Indgående anmodninger
                </Title>
                {incomingRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    Ingen indgående bytteanmodninger.
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
                  Mine anmodninger
                </Title>
                {outgoingRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    Du har ingen afventende bytteanmodninger.
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
              Der er ingen aktiv madholdsperiode i øjeblikket. Kom tilbage
              senere når en ny periode bliver annonceret.
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
  )
}

// Wish Submission Panel
interface WishSubmissionPanelProps {
  cycle: FoodTeamCycle
}

function WishSubmissionPanel({ cycle }: WishSubmissionPanelProps) {
  const queryClient = useQueryClient()
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [comment, setComment] = useState("")
  const [defaultsApplied, setDefaultsApplied] = useState(false)

  // Fetch existing wish
  const { data: existingWish, isLoading: wishLoading } = useQuery({
    queryKey: ["food", "wishes", "my", cycle.id],
    queryFn: () => foodApi.getMyWish(cycle.id),
    retry: false,
    refetchOnMount: true,
  })

  // Fetch default cooking days
  const { data: defaultCookingDaysData } = useQuery({
    queryKey: ["food", "default-cooking-days"],
    queryFn: foodApi.getDefaultCookingDays,
  })

  // Update default cooking days mutation
  const updateDefaultsMutation = useMutation({
    mutationFn: foodApi.updateDefaultCookingDays,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "default-cooking-days"],
      })
      notifications.show({
        title: "Standarder gemt",
        message: "Dine standard madlavningsdage er blevet gemt.",
        color: "green",
      })
    },
  })

  const defaultDays = defaultCookingDaysData?.default_cooking_days ?? []

  const handleDefaultDayToggle = (day: number) => {
    const newDefaults = defaultDays.includes(day)
      ? defaultDays.filter((d) => d !== day)
      : [...defaultDays, day].sort()
    updateDefaultsMutation.mutate(newDefaults)
  }

  // Apply defaults to selected dates when first loading (if no existing wish)
  const applyDefaultsToSelection = () => {
    if (defaultDays.length === 0) return

    // Find cooking dates that match the default weekdays
    const matchingDates = cycle.cooking_dates.filter((date) => {
      const weekday = dayjs(date).day() // 0=Sunday, 1=Monday, etc.
      // Convert to our format: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday
      const adjustedDay = weekday === 0 ? 6 : weekday - 1
      return defaultDays.includes(adjustedDay)
    })

    setSelectedDates(matchingDates)
    setDefaultsApplied(true)
  }

  // Initialize selected dates from existing wish
  useEffect(() => {
    if (existingWish) {
      setSelectedDates(existingWish.available_dates)
      setComment(existingWish.comment)
    }
  }, [existingWish])

  const submitWishMutation = useMutation({
    mutationFn: (data: WishSubmitData) => foodApi.submitWish(cycle.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["food", "wishes", "my", cycle.id],
      })
      queryClient.invalidateQueries({ queryKey: ["food", "cycles", "active"] })
      notifications.show({
        title: "Ønsker indsendt",
        message: "Dine datopræferencer er blevet gemt.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke indsende ønsker. Prøv igen.",
        color: "red",
      })
    },
  })

  const handleDateToggle = (date: string) => {
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    )
  }

  const handleSelectAll = () => {
    setSelectedDates(cycle.cooking_dates)
  }

  const handleClearAll = () => {
    setSelectedDates([])
  }

  const handleSubmit = () => {
    submitWishMutation.mutate({
      available_dates: selectedDates,
      comment,
    })
  }

  // Update selected dates when existing wish loads
  if (
    existingWish &&
    selectedDates.length === 0 &&
    existingWish.available_dates.length > 0
  ) {
    setSelectedDates(existingWish.available_dates)
    setComment(existingWish.comment)
  }

  if (wishLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  const deadlinePassed = dayjs(cycle.wish_deadline).isBefore(dayjs())

  return (
    <Stack gap="lg">
      <Card withBorder p="lg" radius="md">
        <Stack gap="md">
          <div>
            <Group justify="space-between" mb="xs">
              <Title order={3}>{cycle.name}</Title>
              <Badge
                color={
                  cycle.is_accepting_wishes
                    ? "green"
                    : deadlinePassed
                      ? "red"
                      : "gray"
                }
                size="lg"
              >
                {cycle.is_accepting_wishes
                  ? "Modtager ønsker"
                  : deadlinePassed
                    ? "Lukket"
                    : cycle.status}
              </Badge>
            </Group>
            <Text c="dimmed" size="sm">
              Madlavningsperiode:{" "}
              {cycle.cooking_dates.length > 0
                ? `${dayjs(cycle.cooking_dates[0]).format("D. MMMM")} - ${dayjs(cycle.cooking_dates[cycle.cooking_dates.length - 1]).format("D. MMMM YYYY")} (${cycle.cooking_dates.length} dage)`
                : "Ingen datoer valgt"}
            </Text>
            <Text c="dimmed" size="sm">
              Deadline:{" "}
              {dayjs(cycle.wish_deadline).format("D. MMMM YYYY [kl.] HH:mm")}
            </Text>
          </div>

          {existingWish && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                Du har allerede indsendt dine ønsker (
                {existingWish.available_date_count} datoer valgt). Du kan
                opdatere dem nedenfor indtil deadline.
              </Text>
            </Alert>
          )}

          {!cycle.is_accepting_wishes ? (
            <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
              Denne periode modtager ikke længere ønsker. Deadline er
              overskredet.
            </Alert>
          ) : (
            <>
              {/* Default cooking days section */}
              <Paper withBorder p="md" radius="md" bg="gray.0">
                <Text fw={500} mb="sm">
                  Dine standard madlavningsdage
                </Text>
                <Text size="sm" c="dimmed" mb="md">
                  Vælg din typiske tilgængelighed. Disse gemmes og kan bruges
                  til fremtidige perioder.
                </Text>
                <Group gap="md" mb="md">
                  {["Mandag", "Tirsdag", "Onsdag", "Torsdag"].map(
                    (day, index) => (
                      <Checkbox
                        key={day}
                        label={day}
                        checked={defaultDays.includes(index)}
                        onChange={() => handleDefaultDayToggle(index)}
                      />
                    ),
                  )}
                </Group>
                {defaultDays.length > 0 && !existingWish && (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={applyDefaultsToSelection}
                    disabled={defaultsApplied}
                  >
                    {defaultsApplied
                      ? "Standarder anvendt"
                      : "Anvend standarder til valget nedenfor"}
                  </Button>
                )}
              </Paper>

              <Divider />

              <div>
                <Group justify="space-between" mb="sm">
                  <Text fw={500}>Vælg datoer hvor du kan lave mad:</Text>
                  <Group gap="xs">
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={handleSelectAll}
                    >
                      Vælg alle
                    </Button>
                    <Button
                      variant="subtle"
                      size="xs"
                      color="gray"
                      onClick={handleClearAll}
                    >
                      Ryd alle
                    </Button>
                  </Group>
                </Group>
                <Text size="sm" c="dimmed" mb="md">
                  Vælg alle datoer hvor du KAN lave mad. Jo flere datoer du
                  vælger, jo større chance har du for at blive tildelt.
                </Text>
                <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
                  {cycle.cooking_dates.map((date) => {
                    const isSelected = selectedDates.includes(date)
                    const dayName = dayjs(date).format("ddd")
                    return (
                      <Paper
                        key={date}
                        withBorder
                        p="sm"
                        radius="md"
                        style={{ cursor: "pointer" }}
                        bg={isSelected ? "green.0" : undefined}
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
                              {dayName}, {dayjs(date).format("MMM D")}
                            </Text>
                          </div>
                        </Group>
                      </Paper>
                    )
                  })}
                </SimpleGrid>
              </div>

              <Textarea
                label="Kommentar (valgfri)"
                description="Eventuelle særlige omstændigheder eller præferencer"
                placeholder="F.eks. jeg foretrækker at lave mad med min husfælle, jeg kan kun mandage i uge 2..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                minRows={2}
              />

              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {selectedDates.length} af {cycle.cooking_dates.length} datoer
                  valgt
                </Text>
                <Button
                  leftSection={<IconSend size={16} />}
                  onClick={handleSubmit}
                  loading={submitWishMutation.isPending}
                  disabled={selectedDates.length === 0}
                >
                  {existingWish ? "Opdater ønsker" : "Indsend ønsker"}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}

// Admin Panel for managing cycles and generating teams
function AdminPanel() {
  const queryClient = useQueryClient()
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)
  const [generationResult, setGenerationResult] =
    useState<TeamGenerationResult | null>(null)

  // Fetch all cycles
  const { data: cycles, isLoading: cyclesLoading } = useQuery({
    queryKey: ["food", "cycles"],
    queryFn: foodApi.getCycles,
  })

  // Create cycle mutation
  const createCycleMutation = useMutation({
    mutationFn: foodApi.createCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "cycles"] })
      notifications.show({
        title: "Periode oprettet",
        message: "Den nye madholdsperiode er blevet oprettet.",
        color: "green",
      })
      closeCreateModal()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette periode.",
        color: "red",
      })
    },
  })

  // Generate teams mutation
  const generateTeamsMutation = useMutation({
    mutationFn: ({ cycleId, dryRun }: GenerateTeamsParams) =>
      foodApi.generateTeams(cycleId, dryRun),
    onSuccess: (result) => {
      setGenerationResult(result)
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["food", "cycles"] })
        queryClient.invalidateQueries({ queryKey: ["food", "teams"] })
        notifications.show({
          title: "Hold genereret",
          message: `Oprettede ${result.teams_created} hold.`,
          color: "green",
        })
      }
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke generere hold.",
        color: "red",
      })
    },
  })

  if (cyclesLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Administrer perioder</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Opret periode
        </Button>
      </Group>

      {!cycles || cycles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue">
          Der er endnu ikke oprettet nogen perioder. Opret en periode for at
          begynde at indsamle ønsker.
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
          title="Holdgenerering resultat"
          size="lg"
        >
          <Stack gap="md">
            <Alert
              color={generationResult.success ? "green" : "red"}
              icon={
                generationResult.success ? (
                  <IconCheck size={16} />
                ) : (
                  <IconAlertCircle size={16} />
                )
              }
            >
              {generationResult.message}
            </Alert>

            <Text>Hold oprettet: {generationResult.teams_created}</Text>

            {generationResult.unassigned_persons.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Ikke-tildelte personer (
                  {generationResult.unassigned_persons.length}):
                </Text>
                <Paper withBorder p="sm" bg="yellow.0">
                  <Text size="sm">
                    {generationResult.unassigned_persons.join(", ")}
                  </Text>
                </Paper>
              </div>
            )}

            {generationResult.warnings.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Advarsler:
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

            <Button onClick={() => setGenerationResult(null)}>Luk</Button>
          </Stack>
        </Modal>
      )}

      <CreateCycleModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onCreate={(data) => createCycleMutation.mutate(data)}
        isLoading={createCycleMutation.isPending}
      />
    </Stack>
  )
}

// Cycle Admin Card
interface CycleAdminCardProps {
  cycle: FoodTeamCycle
  onGenerate: (dryRun: boolean) => void
  isGenerating: boolean
}

function CycleAdminCard({
  cycle,
  onGenerate,
  isGenerating,
}: CycleAdminCardProps) {
  const statusColors: Record<string, string> = {
    draft: "gray",
    collecting_wishes: "blue",
    generating: "yellow",
    finalized: "green",
  }

  return (
    <Card withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Text fw={600} size="lg">
            {cycle.name}
          </Text>
          <Text size="sm" c="dimmed">
            {cycle.cooking_dates.length > 0
              ? `${dayjs(cycle.cooking_dates[0]).format("MMM D")} - ${dayjs(cycle.cooking_dates[cycle.cooking_dates.length - 1]).format("MMM D, YYYY")}`
              : "No dates"}
          </Text>
        </div>
        <Badge color={statusColors[cycle.status] || "gray"} size="lg">
          {cycle.status.replace("_", " ")}
        </Badge>
      </Group>

      <SimpleGrid cols={4} mb="md">
        <div>
          <Text size="xs" c="dimmed">
            Madlavningsdage
          </Text>
          <Text fw={500}>{cycle.cooking_dates.length}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Ønsker
          </Text>
          <Text fw={500}>{cycle.wish_count}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Hold
          </Text>
          <Text fw={500}>{cycle.team_count}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Deadline
          </Text>
          <Text fw={500}>
            {dayjs(cycle.wish_deadline).format("MMM D, HH:mm")}
          </Text>
        </div>
      </SimpleGrid>

      {cycle.status !== "finalized" && (
        <Group>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => onGenerate(true)}
            loading={isGenerating}
          >
            Forhåndsvisning
          </Button>
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => onGenerate(false)}
            loading={isGenerating}
          >
            Generer hold
          </Button>
        </Group>
      )}
    </Card>
  )
}

// Create Cycle Modal
interface CreateCycleModalProps {
  opened: boolean
  onClose: () => void
  onCreate: (data: {
    name: string
    cooking_dates: string[]
    wish_deadline: string
  }) => void
  isLoading: boolean
}

function CreateCycleModal({
  opened,
  onClose,
  onCreate,
  isLoading,
}: CreateCycleModalProps) {
  const [name, setName] = useState("")
  const [cookingDates, setCookingDates] = useState<Date[]>([])
  const [wishDeadline, setWishDeadline] = useState<Date | null>(null)

  const handleSubmit = () => {
    onCreate({
      name,
      cooking_dates: cookingDates.map((d) => dayjs(d).format("YYYY-MM-DD")),
      wish_deadline: wishDeadline ? dayjs(wishDeadline).toISOString() : "",
    })
  }

  const handleClose = () => {
    // Reset form on close
    setName("")
    setCookingDates([])
    setWishDeadline(null)
    onClose()
  }

  const isValid = name && cookingDates.length > 0 && wishDeadline

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Opret madholdsperiode"
      centered
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label="Periodenavn"
          placeholder="F.eks. Januar 2025 periode"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <DatePickerInput<"multiple">
          type="multiple"
          label="Madlavningsdatoer"
          placeholder="Klik for at vælge datoer"
          value={cookingDates}
          onChange={(dates) => setCookingDates(dates as unknown as Date[])}
          required
          description={`${cookingDates.length} dato${
            cookingDates.length !== 1 ? "er" : ""
          } valgt. Klik på datoer for at tilføje/fjerne dem.`}
          valueFormat="ddd, D. MMM"
          clearable
        />

        {cookingDates.length > 0 && (
          <Paper withBorder p="sm" bg="gray.0">
            <Text size="sm" fw={500} mb="xs">
              Valgte datoer ({cookingDates.length}):
            </Text>
            <Text size="sm" c="dimmed">
              {[...cookingDates]
                .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())
                .map((d) => dayjs(d).format("ddd, D. MMM"))
                .join(" - ")}
            </Text>
          </Paper>
        )}

        <DateTimePicker
          label="Deadline for ønsker"
          placeholder="Vælg deadline for indsendelse af ønsker"
          value={wishDeadline}
          onChange={(date) => setWishDeadline(date as unknown as Date | null)}
          required
          description="Brugere skal indsende deres datopræferencer før denne deadline"
        />

        <Group justify="flex-end">
          <Button variant="light" onClick={handleClose}>
            Annuller
          </Button>
          <Button
            onClick={handleSubmit}
            loading={isLoading}
            disabled={!isValid}
          >
            Opret periode
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// My Team Card with swap request capability
interface MyTeamCardProps {
  team: FoodTeam
  allTeams: FoodTeamListItem[]
  myTeams: FoodTeam[]
  currentUserId?: number
}

function MyTeamCard({
  team,
  allTeams,
  myTeams,
  currentUserId,
}: MyTeamCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [swapModalOpened, { open: openSwapModal, close: closeSwapModal }] =
    useDisclosure(false)
  const [selectedTargetTeamId, setSelectedTargetTeamId] =
    useState<number | null>(null)
  const [selectedTargetMemberId, setSelectedTargetMemberId] =
    useState<number | null>(null)
  const [swapMessage, setSwapMessage] = useState("")
  const queryClient = useQueryClient()

  // Find my membership in this team
  const myMembership = team.members.find((m) => m.user.id === currentUserId)

  // Get teams I'm not already on (for swap targets)
  const myTeamDates = new Set(myTeams.map((t) => t.date))
  const availableSwapTeams = allTeams.filter((t) => !myTeamDates.has(t.date))

  // Fetch selected team details for swap
  const { data: selectedTeamDetails } = useQuery({
    queryKey: ["food", "teams", selectedTargetTeamId],
    queryFn: () => foodApi.getTeam(selectedTargetTeamId!),
    enabled: !!selectedTargetTeamId,
  })

  const createSwapMutation = useMutation({
    mutationFn: foodApi.createSwapRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-requests"] })
      notifications.show({
        title: "Bytte anmodet",
        message: "Din bytteanmodning er blevet sendt.",
        color: "green",
      })
      closeSwapModal()
      setSelectedTargetTeamId(null)
      setSelectedTargetMemberId(null)
      setSwapMessage("")
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette bytteanmodning.",
        color: "red",
      })
    },
  })

  const handleRequestSwap = () => {
    if (!myMembership || !selectedTargetMemberId) return
    createSwapMutation.mutate({
      requester_membership_id: myMembership.id,
      target_membership_id: selectedTargetMemberId,
      message: swapMessage,
    })
  }

  const isPast = dayjs(team.date).isBefore(dayjs(), "day")

  return (
    <>
      <Card withBorder p="md" radius="md" bg={isPast ? "gray.0" : undefined}>
        <Group justify="space-between" mb="xs">
          <Group>
            <div>
              <Text fw={600} size="lg">
                {team.day_name}, {dayjs(team.date).format("MMMM D, YYYY")}
              </Text>
              <Text size="sm" c="dimmed">
                {team.member_count} holdmedlemmer
              </Text>
            </div>
          </Group>
          <Group>
            {isPast ? (
              <Badge color="gray">Overstået</Badge>
            ) : (
              <Button
                variant="light"
                size="xs"
                leftSection={<IconArrowsExchange size={14} />}
                onClick={openSwapModal}
              >
                Anmod om bytte
              </Button>
            )}
          </Group>
        </Group>

        <Group
          gap="xs"
          style={{ cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
          mb={expanded ? "sm" : 0}
        >
          <Text size="sm" fw={500}>
            Holdmedlemmer
          </Text>
          <ActionIcon variant="subtle" size="xs">
            {expanded ? (
              <IconChevronUp size={14} />
            ) : (
              <IconChevronDown size={14} />
            )}
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
        title="Anmod om bytte af hold"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Vælg en anden holddato at bytte med. Personen du vælger skal
            acceptere din anmodning.
          </Text>

          <div>
            <Text fw={500} mb="xs">
              Din dato: {dayjs(team.date).format("dddd, D. MMMM YYYY")}
            </Text>
          </div>

          <div>
            <Text fw={500} mb="xs">
              Vælg en dato at bytte med:
            </Text>
            <Stack gap="xs">
              {availableSwapTeams.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Ingen andre holddatoer tilgængelige.
                </Text>
              ) : (
                availableSwapTeams.slice(0, 8).map((t) => (
                  <Paper
                    key={t.id}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{ cursor: "pointer" }}
                    bg={selectedTargetTeamId === t.id ? "blue.0" : undefined}
                    onClick={() => {
                      setSelectedTargetTeamId(t.id)
                      setSelectedTargetMemberId(null)
                    }}
                  >
                    <Group justify="space-between">
                      <div>
                        <Text fw={500}>
                          {t.day_name}, {dayjs(t.date).format("MMMM D")}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t.members_display}
                        </Text>
                      </div>
                      {selectedTargetTeamId === t.id && (
                        <Badge color="blue" variant="light">
                          Valgt
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
                Vælg hvem du vil bytte med:
              </Text>
              <Stack gap="xs">
                {selectedTeamDetails.members.map((member) => (
                  <Paper
                    key={member.id}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{ cursor: "pointer" }}
                    bg={
                      selectedTargetMemberId === member.id
                        ? "green.0"
                        : undefined
                    }
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
                            Hus {member.house_number}
                          </Text>
                        )}
                      </div>
                      {selectedTargetMemberId === member.id && (
                        <Badge color="green" variant="light" ml="auto">
                          Valgt
                        </Badge>
                      )}
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </div>
          )}

          <Textarea
            label="Besked (valgfri)"
            placeholder="Tilføj en besked til din bytteanmodning..."
            value={swapMessage}
            onChange={(e) => setSwapMessage(e.target.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={closeSwapModal}>
              Annuller
            </Button>
            <Button
              onClick={handleRequestSwap}
              disabled={!selectedTargetMemberId}
              loading={createSwapMutation.isPending}
            >
              Send anmodning
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// All Teams Card (compact view)
interface AllTeamCardProps {
  team: FoodTeamListItem
}

function AllTeamCard({ team }: AllTeamCardProps) {
  const isPast = dayjs(team.date).isBefore(dayjs(), "day")

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      bg={team.is_my_team ? "blue.0" : isPast ? "gray.0" : undefined}
    >
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Text fw={500}>
              {team.day_name}, {dayjs(team.date).format("MMM D")}
            </Text>
            {team.is_my_team && (
              <Badge size="sm" color="blue" variant="filled">
                Mit hold
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {team.members_display}
          </Text>
        </div>
        <Badge variant="light">{team.member_count} medlemmer</Badge>
      </Group>
    </Paper>
  )
}

// Team Member Row
interface TeamMemberRowProps {
  member: FoodTeamMember
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
          {member.is_own && " (Dig)"}
        </Text>
        {member.house_number && (
          <Text size="xs" c="dimmed">
            Hus {member.house_number}
          </Text>
        )}
      </div>
    </Group>
  )
}

// Swap Request Card
interface SwapRequestCardProps {
  request: TeamSwapRequest
}

function SwapRequestCard({ request }: SwapRequestCardProps) {
  const [responseMessage, setResponseMessage] = useState("")
  const [showResponseInput, setShowResponseInput] = useState(false)
  const queryClient = useQueryClient()

  const respondMutation = useMutation({
    mutationFn: ({
      action,
      message,
    }: {
      action: "accept" | "decline"
      message: string
    }) =>
      foodApi.respondSwapRequest(request.id, {
        action,
        response_message: message,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-requests"] })
      queryClient.invalidateQueries({ queryKey: ["food", "teams"] })
      notifications.show({
        title:
          variables.action === "accept" ? "Bytte accepteret" : "Bytte afvist",
        message:
          variables.action === "accept"
            ? "Holdbyttet er gennemført."
            : "Bytteanmodningen er blevet afvist.",
        color: variables.action === "accept" ? "green" : "orange",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke svare på bytteanmodning.",
        color: "red",
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => foodApi.cancelSwapRequest(request.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-requests"] })
      notifications.show({
        title: "Anmodning annulleret",
        message: "Din bytteanmodning er blevet annulleret.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke annullere bytteanmodning.",
        color: "red",
      })
    },
  })

  const handleAccept = () => {
    respondMutation.mutate({ action: "accept", message: responseMessage })
  }

  const handleDecline = () => {
    respondMutation.mutate({ action: "decline", message: responseMessage })
  }

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
                  </Text>{" "}
                  vil bytte med dig
                </Text>
              ) : (
                <Text size="sm">
                  Du anmodede om at bytte med{" "}
                  <Text span fw={600}>
                    {request.target_membership.user.first_name}{" "}
                    {request.target_membership.user.last_name}
                  </Text>
                </Text>
              )}
            </div>
          </Group>
          <Badge
            color={
              request.status === "pending"
                ? "yellow"
                : request.status === "accepted"
                  ? "green"
                  : "red"
            }
          >
            {request.status}
          </Badge>
        </Group>

        <Group gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Deres dato
            </Text>
            <Text size="sm" fw={500}>
              {request.requester_membership.team_day_name},{" "}
              {dayjs(request.requester_membership.team_date).format("D. MMM")}
            </Text>
          </div>
          <IconArrowsExchange size={16} />
          <div>
            <Text size="xs" c="dimmed">
              Din dato
            </Text>
            <Text size="sm" fw={500}>
              {request.target_membership.team_day_name},{" "}
              {dayjs(request.target_membership.team_date).format("D. MMM")}
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

        {request.status === "pending" && (
          <>
            {request.is_incoming ? (
              <>
                {showResponseInput && (
                  <Textarea
                    placeholder="Valgfri svarbesked..."
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
                      Tilføj besked
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
                      Afvis
                    </Button>
                    <Button
                      color="green"
                      size="sm"
                      leftSection={<IconCheck size={14} />}
                      onClick={handleAccept}
                      loading={respondMutation.isPending}
                    >
                      Accepter
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
                Annuller anmodning
              </Button>
            )}
          </>
        )}
      </Stack>
    </Card>
  )
}
