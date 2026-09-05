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
  Switch,
  Chip,
  MultiSelect,
  Select,
  List,
} from "@mantine/core"

import { useDisclosure } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import { DatePickerInput, DateTimePicker } from "@mantine/dates"

import {
  IconUsers,
  IconCalendar,
  IconArrowsExchange,
  IconAlertCircle,
  IconInfoCircle,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconX,
  IconClipboardList,
  IconSend,
  IconSettings,
  IconPlayerPlay,
  IconPlus,
  IconUser,
  IconHeartHandshake,
  IconBroadcast,
  IconExternalLink,
  IconTrash,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { foodApi } from "../api/food"

import { useAuthStore } from "../store/authStore"

import { forumApi } from "../api/forum"

import { saveDraft } from "../utils/draftStorage"

import type {
  FoodTeam,
  FoodTeamListItem,
  TeamSwapRequest,
  FoodTeamMember,
  FoodTeamCycle,
  TeamGenerationResult,
  FoodRosterEntry,
  TeamFavour,
  SwapBroadcast,
  MyFoodProfile,
  TeamMemberPreview,
  CycleResetPreview,
} from "../types"

interface WishSubmitData {
  available_dates: string[]

  is_unavailable: boolean
}

interface GenerateTeamsParams {
  cycleId: number

  dryRun: boolean
}

export default function FoodTeamsPage() {
  const navigate = useNavigate()

  const { tab } = useParams<{ tab?: string }>()

  const { user } = useAuthStore()

  // Matches the backend IsFoodAdmin permission (is_staff OR is_food_admin) —
  // the food admin who runs the rotation is usually not a Django superuser.
  const canFoodAdmin = !!(user?.is_staff || user?.is_food_admin)

  // Path-based tab state

  const validTabs = [
    "mine-hold",
    "alle-hold",
    "bytte",
    "oensker",
    "profil",
    "admin",
  ]

  const activeTab = tab && validTabs.includes(tab) ? tab : "mine-hold"

  const setActiveTab = (newTab: string | null) => {
    if (newTab && newTab !== "mine-hold") {
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

  // Fetch the upcoming maddage of everyone else in my house

  const { data: housemateTeams, isLoading: housemateTeamsLoading } = useQuery({
    queryKey: ["food", "teams", "housemates"],

    queryFn: foodApi.getHousemateTeams,
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

  // Fetch favours ledger

  const { data: favours, isLoading: favoursLoading } = useQuery({
    queryKey: ["food", "favours"],

    queryFn: foodApi.getFavours,
  })

  // Fetch swap broadcasts

  const { data: broadcasts, isLoading: broadcastsLoading } = useQuery({
    queryKey: ["food", "swap-broadcasts"],

    queryFn: foodApi.getSwapBroadcasts,
  })

  const pendingRequests =
    swapRequests?.filter((r) => r.status === "pending") ?? []

  const incomingRequests = pendingRequests.filter((r) => r.is_incoming)

  const outgoingRequests = pendingRequests.filter((r) => r.is_outgoing)

  const incomingBroadcasts =
    broadcasts?.filter(
      (b) => b.can_accept && b.status === "open" && !b.is_mine,
    ) ?? []

  const byttenBadgeCount = pendingRequests.length + incomingBroadcasts.length

  // My shifts and my household's, in one list by date: a day in the kitchen is
  // the household's evening either way, and the bold name on the card says
  // whose it is without a heading over a second list.
  const mineOgHusstandensDage = [
    ...(myTeams ?? []).map((team) => ({ kind: "min" as const, team })),
    ...(housemateTeams ?? []).map((team) => ({
      kind: "husstand" as const,
      team,
    })),
  ].sort((a, b) => a.team.date.localeCompare(b.team.date))

  const isLoading =
    myTeamsLoading ||
    allTeamsLoading ||
    housemateTeamsLoading ||
    swapRequestsLoading ||
    favoursLoading ||
    broadcastsLoading

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
          <Tabs.Tab value="mine-hold" leftSection={<IconCalendar size={16} />}>
            Mine hold
          </Tabs.Tab>
          <Tabs.Tab value="alle-hold" leftSection={<IconUsers size={16} />}>
            Alle hold
          </Tabs.Tab>
          <Tabs.Tab
            value="bytte"
            leftSection={<IconArrowsExchange size={16} />}
            rightSection={
              byttenBadgeCount > 0 ? (
                <Badge size="xs" color="red" variant="filled">
                  {byttenBadgeCount}
                </Badge>
              ) : null
            }
          >
            Bytte
          </Tabs.Tab>
          <Tabs.Tab
            value="oensker"
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
          <Tabs.Tab value="profil" leftSection={<IconUser size={16} />}>
            Min profil
          </Tabs.Tab>
          {canFoodAdmin && (
            <Tabs.Tab value="admin" leftSection={<IconSettings size={16} />}>
              Admin
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="mine-hold">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : (
            <Stack gap="md">
              {(!myTeams || myTeams.length === 0) && (
                <Alert icon={<IconAlertCircle size={16} />} color="blue">
                  Du er ikke tildelt nogle kommende madhold.
                </Alert>
              )}

              {mineOgHusstandensDage.map((day) =>
                day.kind === "min" ? (
                  <MyTeamCard
                    key={`min-${day.team.id}`}
                    team={day.team}
                    allTeams={allTeams ?? []}
                    myTeams={myTeams ?? []}
                    currentUserId={user?.id}
                  />
                ) : (
                  <AllTeamCard
                    key={`husstand-${day.team.id}`}
                    team={day.team}
                    membersPreview={day.team.members_preview}
                  />
                ),
              )}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="alle-hold">
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

        <Tabs.Panel value="bytte">
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

              <Divider />

              {/* Swap broadcasts */}
              <BroadcastsSection
                broadcasts={broadcasts ?? []}
                myTeams={myTeams ?? []}
              />

              <Divider />

              {/* Favours ledger */}
              <FavoursSection favours={favours ?? []} />
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="profil">
          <FoodProfilePanel />
        </Tabs.Panel>

        <Tabs.Panel value="oensker">
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

        {canFoodAdmin && (
          <Tabs.Panel value="admin">
            <AdminPanel canFoodAdmin={canFoodAdmin} />
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  )
}

// Wish Submission Panel

/** One name on a team card's always-visible member line. */
interface TeamNameEntry {
  key: string

  name: string

  houseNumber: string

  /** Someone from your own house (you included) — printed in bold. */
  isHousehold: boolean
}

interface TeamNamesLineProps {
  members: TeamNameEntry[]
}

/**
 * The whole team on one line, so a card never has to be expanded to see who is
 * cooking. Your own house is set in bold: on your own day that is you (and your
 * partner if you cook together), and on a day only your household cooks it is
 * the name that explains why the day is on your list at all.
 */
function TeamNamesLine({ members }: TeamNamesLineProps) {
  return (
    <Text size="sm" c="dimmed">
      {members.map((member, index) => (
        <Text
          key={member.key}
          span
          inherit
          fw={member.isHousehold ? 700 : undefined}
          c={member.isHousehold ? "var(--mantine-color-text)" : undefined}
        >
          {index > 0 && ", "}
          {member.name}
          {member.houseNumber && ` (${member.houseNumber})`}
        </Text>
      ))}
    </Text>
  )
}

interface WishSubmissionPanelProps {
  cycle: FoodTeamCycle
}

function WishSubmissionPanel({ cycle }: WishSubmissionPanelProps) {
  const queryClient = useQueryClient()

  const [selectedDates, setSelectedDates] = useState<string[]>([])

  const [comment, setComment] = useState("")

  const [commentLoaded, setCommentLoaded] = useState(false)

  const [isUnavailable, setIsUnavailable] = useState(false)

  const [defaultsApplied, setDefaultsApplied] = useState(false)

  // The reason for being away is kept on the profile, not on this cycle's wish,
  // so it survives the period and the organiser can follow it up later.
  const { data: myProfile } = useQuery({
    queryKey: ["food", "my-food-profile"],

    queryFn: foodApi.getMyFoodProfile,
  })

  useEffect(() => {
    if (myProfile && !commentLoaded) {
      setComment(myProfile.food_team_pause_reason)

      setCommentLoaded(true)
    }
  }, [myProfile, commentLoaded])

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

      setIsUnavailable(existingWish.is_unavailable)
    }
  }, [existingWish])

  const saveProfileMutation = useMutation({
    mutationFn: (data: Partial<MyFoodProfile>) =>
      foodApi.updateMyFoodProfile(data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "my-food-profile"] })

      queryClient.invalidateQueries({ queryKey: ["food", "roster"] })
    },
  })

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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke indsende ønsker. Prøv igen.")
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
    // The reason lives on the profile, so the organiser still sees it when it is
    // the only thing that changed.
    if (myProfile) {
      if (isUnavailable) {
        if (comment !== myProfile.food_team_pause_reason) {
          saveProfileMutation.mutate({ food_team_pause_reason: comment })
        }
      } else {
        // Naming the days you can cook is how you say you are back, so a pause
        // cannot survive it — leaving the switch on would have the generator
        // skip someone who just signed up. Lift it, and drop the explanation
        // for an absence that is over.
        const updates: Partial<MyFoodProfile> = {}

        if (myProfile.is_exempt_from_food_teams) {
          updates.is_exempt_from_food_teams = false
        }

        if (myProfile.food_team_pause_reason) {
          updates.food_team_pause_reason = ""
        }

        if (Object.keys(updates).length > 0) {
          saveProfileMutation.mutate(updates)
        }
      }
    }

    submitWishMutation.mutate({
      available_dates: isUnavailable ? [] : selectedDates,

      is_unavailable: isUnavailable,
    })
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
              {/* Unavailable for the whole period */}
              <Paper
                withBorder
                p="md"
                radius="md"
                bg={
                  isUnavailable
                    ? "var(--mantine-color-red-light)"
                    : "var(--mantine-color-default-hover)"
                }
              >
                <Switch
                  checked={isUnavailable}
                  onChange={(e) => setIsUnavailable(e.currentTarget.checked)}
                  label="Jeg kan ikke i denne periode"
                  description="Markér dette hvis du slet ikke kan lave mad i denne periode. Så behøver du ikke vælge datoer."
                  color="red"
                />

                {myProfile?.is_exempt_from_food_teams && !isUnavailable && (
                  <Alert color="blue" variant="light" mt="sm" p="xs">
                    Du holder pause fra madhold lige nu. Indsender du ønsker,
                    ophæver du pausen, og du kan komme på et hold igen.
                  </Alert>
                )}
              </Paper>

              {/* Default cooking days section */}
              <Paper
                withBorder
                p="md"
                radius="md"
                bg="var(--mantine-color-default-hover)"
                style={
                  isUnavailable
                    ? { opacity: 0.5, pointerEvents: "none" }
                    : undefined
                }
              >
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

              <div
                style={
                  isUnavailable
                    ? { opacity: 0.5, pointerEvents: "none" }
                    : undefined
                }
              >
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
                        bg={
                          isSelected
                            ? "var(--mantine-color-green-light)"
                            : undefined
                        }
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
                              {dayName}, {dayjs(date).format("D. MMM")}
                            </Text>
                          </div>
                        </Group>
                      </Paper>
                    )
                  })}
                </SimpleGrid>
              </div>

              {isUnavailable && (
                <Textarea
                  label="Hvorfor kan du ikke? (valgfri)"
                  description="Læses af madhold-ansvarlig. Gemmes på din profil, så den også gælder, hvis pausen varer længere end denne periode."
                  placeholder="F.eks. jeg er på ferie hele september..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  minRows={2}
                />
              )}

              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {isUnavailable
                    ? "Du har markeret, at du ikke kan i denne periode"
                    : `${selectedDates.length} af ${cycle.cooking_dates.length} datoer valgt`}
                </Text>
                <Button
                  leftSection={<IconSend size={16} />}
                  onClick={handleSubmit}
                  loading={submitWishMutation.isPending}
                  disabled={!isUnavailable && selectedDates.length === 0}
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

// Resident overview for food admins: who can cook, and who is sitting out.

interface OverblikGroupProps {
  title: string

  description: string

  rows: FoodRosterEntry[]

  /** Pulls the reason out of whichever field this group's state stores it in. */
  reasonOf?: (row: FoodRosterEntry) => string

  color?: string
}

function OverblikGroup({
  title,
  description,
  rows,
  reasonOf,
  color,
}: OverblikGroupProps) {
  return (
    <div>
      <Group gap="xs" mb={4}>
        <Text fw={500}>{title}</Text>
        <Badge variant="light" color={color}>
          {rows.length}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        {description}
      </Text>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Ingen.
        </Text>
      ) : (
        <Stack gap={6}>
          {rows.map((row) => {
            const reason = reasonOf?.(row) ?? ""

            return (
              <Paper key={row.id} withBorder p="xs" radius="sm">
                <Text size="sm">
                  {row.first_name} {row.last_name}
                  {row.house_number && (
                    <Text span c="dimmed">
                      {" "}
                      (hus {row.house_number})
                    </Text>
                  )}
                </Text>
                {reason && (
                  <Text size="xs" c="dimmed" mt={2}>
                    "{reason}"
                  </Text>
                )}
              </Paper>
            )
          })}
        </Stack>
      )}
    </div>
  )
}

/**
 * Who is available to cook, and who is not.
 *
 * The two ways of sitting out are kept apart on purpose: a pause is set on the
 * person and lasts until they lift it, while "ikke med i denne periode" comes
 * from this period's wish and resets with it. Each carries its own reason,
 * which is the part a food admin actually needs when planning.
 */
function BeboerOverblik() {
  const { data, isLoading } = useQuery({
    queryKey: ["food", "roster"],

    queryFn: foodApi.getFoodRoster,
  })

  if (isLoading) {
    return (
      <Center h={120}>
        <Loader size="sm" />
      </Center>
    )
  }

  const residents = data?.residents ?? []

  const paused = residents.filter((r) => r.is_exempt_from_food_teams)

  const outThisCycle = residents.filter(
    (r) => !r.is_exempt_from_food_teams && r.is_unavailable_this_cycle,
  )

  const cooking = residents.filter(
    (r) => !r.is_exempt_from_food_teams && !r.is_unavailable_this_cycle,
  )

  const headChefs = cooking.filter((r) => r.can_be_head_chef)

  const withHousemate = cooking.filter((r) => r.prefers_cooking_with_housemate)

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>Beboeroverblik</Title>
        <Text size="sm" c="dimmed">
          {data?.cycle
            ? `Svar for perioden "${data.cycle.name}". ${cooking.length} af ${residents.length} beboere er med.`
            : `${cooking.length} af ${residents.length} beboere er med i madhold.`}
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <OverblikGroup
          title="Holder pause"
          description="Sat på deres egen profil. Gælder indtil de selv slår den fra."
          rows={paused}
          reasonOf={(r) => r.food_team_pause_reason}
          color="red"
        />
        <OverblikGroup
          title="Ikke med i denne periode"
          description="Fra deres ønske til netop denne periode."
          rows={outThisCycle}
          reasonOf={(r) => r.food_team_pause_reason}
          color="orange"
        />
        <OverblikGroup
          title="Kan være chefkok"
          description="Mindst én pr. hold, højst tre."
          rows={headChefs}
          color="green"
        />
        <OverblikGroup
          title="Vil lave mad med medbeboer"
          description="Sættes på begge i husstanden, ellers kan holdene ikke dannes."
          rows={withHousemate}
          color="blue"
        />
      </SimpleGrid>
    </Stack>
  )
}

interface AdminPanelProps {
  canFoodAdmin: boolean
}

function AdminPanel({ canFoodAdmin }: AdminPanelProps) {
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette periode.")
    },
  })

  // Generate teams mutation

  const generateTeamsMutation = useMutation({
    mutationFn: ({ cycleId, dryRun }: GenerateTeamsParams) =>
      foodApi.generateTeams(cycleId, dryRun),

    onSuccess: (result) => {
      setGenerationResult(result)

      // A real run persists/finalizes even when it completes with problems, so
      // refresh either way. The detailed outcome (unassigned, warnings) is in
      // the result modal; the toast is just a quick summary.
      queryClient.invalidateQueries({ queryKey: ["food", "cycles"] })

      queryClient.invalidateQueries({ queryKey: ["food", "teams"] })

      notifications.show({
        title: result.success
          ? "Hold genereret"
          : "Generering gennemført med problemer",

        message: result.success
          ? `Oprettede ${result.teams_created} hold.`
          : result.message,

        color: result.success ? "green" : "yellow",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke generere hold.")
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
      <BeboerOverblik />

      <Divider />

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
              canFoodAdmin={canFoodAdmin}
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

            {generationResult.dropped_dates.length > 0 && (
              <Alert
                color="blue"
                variant="light"
                icon={<IconInfoCircle size={16} />}
              >
                <Text size="sm" fw={500} mb={4}>
                  {generationResult.dropped_dates.length === 1
                    ? "1 dato rykker til næste periode"
                    : `${generationResult.dropped_dates.length} datoer rykker til næste periode`}
                </Text>
                <Text size="sm">
                  Der var ikke kokke nok til fulde hold på alle datoer, så
                  perioden slutter tidligere:{" "}
                  {generationResult.dropped_dates
                    .map((d) => dayjs(d).format("ddd D. MMM"))
                    .join(", ")}
                  . Næste periode starter automatisk på den første af dem.
                </Text>
              </Alert>
            )}

            {generationResult.unassigned_persons.length > 0 && (
              <div>
                <Text fw={500} mb="xs">
                  Ikke-tildelte personer (
                  {generationResult.unassigned_persons.length}):
                </Text>
                <Paper withBorder p="sm" bg="var(--mantine-color-yellow-light)">
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

  canFoodAdmin: boolean

  onGenerate: (dryRun: boolean) => void

  isGenerating: boolean
}

function CycleAdminCard({
  cycle,

  canFoodAdmin,

  onGenerate,

  isGenerating,
}: CycleAdminCardProps) {
  const [resetModalOpened, { open: openResetModal, close: closeResetModal }] =
    useDisclosure(false)

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
              ? `${dayjs(cycle.cooking_dates[0]).format("D. MMM")} - ${dayjs(cycle.cooking_dates[cycle.cooking_dates.length - 1]).format("D. MMM YYYY")}`
              : "Ingen datoer"}
          </Text>
        </div>
        <Badge color={statusColors[cycle.status] || "gray"} size="lg">
          {{
            draft: "Kladde",

            collecting_wishes: "Indsamler ønsker",

            generating: "Genererer",

            finalized: "Afsluttet",
          }[cycle.status] || cycle.status}
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
            {dayjs(cycle.wish_deadline).format("D. MMM, HH:mm")}
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

      {/* A finalized cycle refuses regeneration, so the only way back to a new
          plan is to delete the teams and reopen the period for wishes. */}
      {canFoodAdmin && cycle.status === "finalized" && (
        <>
          <Group>
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={openResetModal}
            >
              Slet hold og åbn perioden igen
            </Button>
          </Group>

          <ResetTeamsModal
            cycle={cycle}
            opened={resetModalOpened}
            onClose={closeResetModal}
          />
        </>
      )}
    </Card>
  )
}

// Reset Teams Modal — deletes a finalized cycle's teams after an explicit,
// itemised confirmation. This throws away a plan ~90 people depend on.

interface ResetTeamsModalProps {
  cycle: FoodTeamCycle

  opened: boolean

  onClose: () => void
}

function ResetTeamsModal({ cycle, opened, onClose }: ResetTeamsModalProps) {
  const queryClient = useQueryClient()

  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewFailed,
  } = useQuery<CycleResetPreview>({
    queryKey: ["food", "cycles", cycle.id, "reset-preview"],

    queryFn: () => foodApi.getCycleResetPreview(cycle.id),

    enabled: opened,
  })

  const resetMutation = useMutation({
    mutationFn: () => foodApi.resetCycleTeams(cycle.id),

    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["food", "cycles"] })

      queryClient.invalidateQueries({ queryKey: ["food", "teams"] })

      notifications.show({
        title: "Holdene er slettet",

        message: `${result.deleted.teams} hold blev slettet. Perioden indsamler ønsker igen, så du kan generere hold på ny.`,

        color: "green",
      })

      onClose()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette holdene.")
    },
  })

  const blocked = preview?.has_past_dates ?? false

  // Also treat "opened, nothing yet, no error" as loading so the error alert
  // can't flash in the frame before the disabled query starts fetching.
  const showLoading = previewLoading || (!preview && !previewFailed)

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Slet hold og åbn perioden igen"
      size="lg"
    >
      <Stack gap="md">
        {showLoading ? (
          <Center h={120}>
            <Loader />
          </Center>
        ) : previewFailed || !preview ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            Kunne ikke hente overblik over, hvad der bliver slettet. Prøv igen.
          </Alert>
        ) : blocked ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            <Text size="sm" fw={600} mb={4}>
              Holdene kan ikke slettes
            </Text>
            <Text size="sm">
              Perioden har madlavningsdage, der allerede er passeret (
              {preview.past_dates
                .slice(0, 3)
                .map((d) => dayjs(d).format("D. MMM"))
                .join(", ")}
              {preview.past_dates.length > 3 ? " m.fl." : ""}). Der er allerede
              lavet mad på dem, og en sletning ville slette historikken om
              afholdte vagter, bytninger og tjenester. Opret i stedet en ny
              periode.
            </Text>
          </Alert>
        ) : (
          <>
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              <Text size="sm" fw={600}>
                Dette kan ikke fortrydes.
              </Text>
            </Alert>

            <Text size="sm">
              Hele madholdsplanen for <strong>{cycle.name}</strong> bliver
              slettet. Følgende forsvinder permanent:
            </Text>

            <List size="sm" spacing={4}>
              <List.Item>{preview.teams} madhold</List.Item>
              <List.Item>
                {preview.memberships} tildelte madlavningsvagter
              </List.Item>
              <List.Item>
                {preview.pending_swap_requests} afventende bytteanmodninger
              </List.Item>
              <List.Item>{preview.open_broadcasts} åbne bytteopslag</List.Item>
              <List.Item>
                {preview.favours} tjenester (»du skylder mig en«)
              </List.Item>
            </List>

            <Text size="sm">
              Perioden og beboernes indsendte ønsker bliver bevaret, og perioden
              går tilbage til at indsamle ønsker, så du kan generere hold på ny.
            </Text>

            <Text size="sm" c="dimmed">
              Beboerne får ikke automatisk besked — husk selv at fortælle dem
              det, hvis planen allerede er meldt ud.
            </Text>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuller
          </Button>
          <Button
            color="red"
            leftSection={<IconTrash size={16} />}
            disabled={showLoading || previewFailed || !preview || blocked}
            loading={resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            Ja, slet holdene
          </Button>
        </Group>
      </Stack>
    </Modal>
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

  const [prefilled, setPrefilled] = useState(false)

  // Fetch closed food days to disable them in the date picker

  const { data: closedDays } = useQuery({
    queryKey: ["food", "closed-days"],

    queryFn: () => foodApi.getClosedDays(dayjs().format("YYYY-MM-DD")),

    enabled: opened,
  })

  const closedDateSet = new Set(closedDays?.map((d) => d.date) ?? [])

  // Suggested defaults for the next period (live eligible count → number of
  // cooking days, dates skipping closed days, name, deadline). Prefilled once
  // per open so we never clobber the admin's manual edits.

  const { data: suggestion } = useQuery({
    queryKey: ["food", "cycles", "suggested"],

    queryFn: foodApi.getSuggestedCyclePlan,

    enabled: opened,
  })

  useEffect(() => {
    if (opened && suggestion && !prefilled) {
      setName(suggestion.name)

      setCookingDates(suggestion.cooking_dates.map((d) => dayjs(d).toDate()))

      setWishDeadline(dayjs(suggestion.wish_deadline).toDate())

      setPrefilled(true)
    }
  }, [opened, suggestion, prefilled])

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

    setPrefilled(false)

    onClose()
  }

  const isValid = name && cookingDates.length > 0 && wishDeadline

  // Exclude weekends and closed food days (Mantine types say string but runtime passes Date)

  const excludeDate = (d: Date | string) => {
    const date = d instanceof Date ? d : new Date(d)

    const day = date.getDay()

    if (day === 0 || day === 5 || day === 6) return true

    return closedDateSet.has(dayjs(date).format("YYYY-MM-DD"))
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Opret madholdsperiode"
      centered
      size="lg"
    >
      <Stack gap="md">
        {suggestion && (
          <Alert color="blue" variant="light" icon={<IconCalendar size={16} />}>
            Forslag: {suggestion.eligible_count} berettigede kokke →{" "}
            {suggestion.suggested_day_count} maddage. Datoer, navn og deadline
            er udfyldt nedenfor (lukkede maddage er udeladt) — ret dem efter
            behov.
          </Alert>
        )}

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
          excludeDate={excludeDate}
          required
          description={`${cookingDates.length} dato${
            cookingDates.length !== 1 ? "er" : ""
          } valgt. Klik på datoer for at tilføje/fjerne dem.`}
          valueFormat="ddd, D. MMM"
          clearable
        />

        {cookingDates.length > 0 && (
          <Paper withBorder p="sm" bg="var(--mantine-color-default-hover)">
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

  const [
    broadcastModalOpened,
    { open: openBroadcastModal, close: closeBroadcastModal },
  ] = useDisclosure(false)

  const [selectedTargetTeamId, setSelectedTargetTeamId] =
    useState<number | null>(null)

  const [selectedTargetMemberId, setSelectedTargetMemberId] =
    useState<number | null>(null)

  const [swapMessage, setSwapMessage] = useState("")

  const [broadcastDates, setBroadcastDates] = useState<string[]>([])

  const [broadcastMessage, setBroadcastMessage] = useState("")

  const navigate = useNavigate()

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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette bytteanmodning.")
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

  // Candidate dates to offer instead = all cooking dates except my own dates

  const candidateDateOptions = Array.from(new Set(allTeams.map((t) => t.date)))
    .filter((d) => !myTeamDates.has(d))
    .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())
    .map((d) => ({
      value: d,

      label: dayjs(d).format("dddd, D. MMMM"),
    }))

  const createBroadcastMutation = useMutation({
    mutationFn: foodApi.createSwapBroadcast,

    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-broadcasts"] })

      if (result.candidate_count > 0) {
        notifications.show({
          title: "Bytteanmodning sendt",

          message: `Sendt til ${result.candidate_count} mulige byttere.`,

          color: "green",
        })

        closeBroadcastModal()

        setBroadcastDates([])

        setBroadcastMessage("")
      } else {
        notifications.show({
          title: "Ingen mulige byttere fundet",

          message:
            "Der blev ikke fundet nogen, der kan bytte. Prøv at dele din anmodning i Fælles-forummet i stedet.",

          color: "orange",

          autoClose: 8000,
        })
      }
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke sende bytteanmodning.")
    },
  })

  const handleCreateBroadcast = () => {
    if (!myMembership || broadcastDates.length === 0) return

    createBroadcastMutation.mutate({
      requester_membership_id: myMembership.id,

      available_dates: broadcastDates,

      message: broadcastMessage,
    })
  }

  // Best-effort prefill: stash title + body as encrypted drafts the
  // CreateThreadModal reads, then navigate to the Fælles subgroup.

  const shareToForumMutation = useMutation({
    mutationFn: async () => {
      const subgroups = await forumApi.getSubgroups()

      const faelles =
        subgroups.find((s) => s.is_main) ??
        subgroups.find((s) => s.slug === "faelles") ??
        subgroups.find((s) => s.name === "Fælles")

      const slug = faelles?.slug ?? "faelles"

      const dateStr = dayjs(team.date).format("dddd D. MMMM")

      const title = `Bytte af maddag ${dateStr}`

      const altText =
        broadcastDates.length > 0
          ? ` Jeg kan i stedet tage en af disse dage: ${broadcastDates
              .map((d) => dayjs(d).format("dddd D. MMMM"))
              .join(", ")}.`
          : ""

      const extra = broadcastMessage ? ` ${broadcastMessage}` : ""

      const body = `<p>Hej alle! Jeg vil gerne bytte min maddag <strong>${dateStr}</strong>.${altText}${extra} Skriv til mig hvis du kan bytte. Tak!</p>`

      await saveDraft("new-thread-title-" + slug, title)

      await saveDraft("new-thread-" + slug, body)

      return slug
    },

    onSuccess: (slug) => {
      closeBroadcastModal()

      navigate(`/forum/${slug}`)

      notifications.show({
        title: "Klar i Fælles-forummet",

        message:
          "Klik på 'Ny tråd' — titel og tekst er udfyldt for dig. Tjek den igennem og opret tråden.",

        color: "blue",

        autoClose: 8000,
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke åbne Fælles-forummet.")
    },
  })

  const isPast = dayjs(team.date).isBefore(dayjs(), "day")

  // Bold = my own house. Nobody has to tell us who that is: my own membership
  // carries my house number, and a housemate's is the same one.
  const myHouseNumber = team.members.find((m) => m.is_own)?.house_number ?? ""

  const teamNames = team.members.map((member) => ({
    key: String(member.id),

    name: member.user.first_name,

    houseNumber: member.house_number,

    isHousehold: !!myHouseNumber && member.house_number === myHouseNumber,
  }))

  return (
    <>
      <Card
        withBorder
        p="md"
        radius="md"
        bg={isPast ? "var(--mantine-color-default-hover)" : undefined}
      >
        <Group justify="space-between" mb="xs">
          <Group>
            <div>
              <Text fw={600} size="lg">
                {team.day_name}, {dayjs(team.date).format("D. MMMM YYYY")}
              </Text>
              <TeamNamesLine members={teamNames} />
            </div>
          </Group>
          <Group gap="xs">
            {isPast ? (
              <Badge color="gray">Overstået</Badge>
            ) : (
              <>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconArrowsExchange size={14} />}
                  onClick={openSwapModal}
                >
                  Anmod specifik person om bytte
                </Button>
                <Button
                  variant="light"
                  color="grape"
                  size="xs"
                  leftSection={<IconBroadcast size={14} />}
                  onClick={openBroadcastModal}
                >
                  Anmod fællesskabet om bytte
                </Button>
              </>
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

        <Collapse expanded={expanded}>
          <Stack gap="xs">
            {team.members.map((member) => (
              <TeamMemberRow
                key={member.id}
                member={member}
                isHousehold={
                  !!myHouseNumber && member.house_number === myHouseNumber
                }
              />
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
                    bg={
                      selectedTargetTeamId === t.id
                        ? "var(--mantine-color-blue-light)"
                        : undefined
                    }
                    onClick={() => {
                      setSelectedTargetTeamId(t.id)

                      setSelectedTargetMemberId(null)
                    }}
                  >
                    <Group justify="space-between">
                      <div>
                        <Text fw={500}>
                          {t.day_name}, {dayjs(t.date).format("D. MMMM")}
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
                        ? "var(--mantine-color-green-light)"
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

      {/* Broadcast Swap Modal */}
      <Modal
        opened={broadcastModalOpened}
        onClose={closeBroadcastModal}
        title="Send bytteanmodning til alle mulige byttere"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Send en bredt udsendt anmodning om at bytte din maddag{" "}
            <Text span fw={600}>
              {team.day_name}, {dayjs(team.date).format("D. MMMM YYYY")}
            </Text>
            . Alle, der har en maddag på en af de datoer du vælger nedenfor, får
            besked og kan acceptere byttet.
          </Text>

          <MultiSelect
            label="Datoer jeg i stedet kan tage"
            placeholder="Vælg en eller flere datoer"
            data={candidateDateOptions}
            value={broadcastDates}
            onChange={setBroadcastDates}
            searchable
            description="Du tilbyder at tage en af disse maddage i bytte."
          />

          <Textarea
            label="Besked (valgfri)"
            placeholder="Tilføj en besked til din bytteanmodning..."
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
          />

          <Divider label="eller" labelPosition="center" />

          <Group justify="space-between">
            <Button
              variant="light"
              color="blue"
              leftSection={<IconExternalLink size={16} />}
              onClick={() => shareToForumMutation.mutate()}
              loading={shareToForumMutation.isPending}
            >
              Del i Fælles-forum
            </Button>
            <Group>
              <Button
                variant="light"
                color="gray"
                onClick={closeBroadcastModal}
              >
                Annuller
              </Button>
              <Button
                color="grape"
                leftSection={<IconBroadcast size={16} />}
                onClick={handleCreateBroadcast}
                disabled={broadcastDates.length === 0}
                loading={createBroadcastMutation.isPending}
              >
                Send bytteanmodning
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// All Teams Card (compact view)

interface AllTeamCardProps {
  team: FoodTeamListItem

  /**
   * The members one by one, instead of the flat `members_display` line. Set for
   * a household day under Mine hold, where the resident from your own house is
   * printed in bold — folded and open alike, since that name is the whole
   * reason the day is on your list.
   */
  membersPreview?: TeamMemberPreview[]
}

function AllTeamCard({ team, membersPreview }: AllTeamCardProps) {
  const [expanded, setExpanded] = useState(false)

  const housemateIds = new Set(
    (membersPreview ?? [])
      .filter((member) => member.is_housemate)
      .map((member) => member.user_id),
  )

  const isPast = dayjs(team.date).isBefore(dayjs(), "day")

  // Load full team details (with membership ids) only when expanded

  const { data: teamDetails, isLoading: teamDetailsLoading } = useQuery({
    queryKey: ["food", "teams", team.id],

    queryFn: () => foodApi.getTeam(team.id),

    enabled: expanded,
  })

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      bg={
        team.is_my_team
          ? "var(--mantine-color-blue-light)"
          : isPast
            ? "var(--mantine-color-default-hover)"
            : undefined
      }
    >
      <Group
        justify="space-between"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <Group gap="xs">
            <Text fw={500}>
              {team.day_name}, {dayjs(team.date).format("D. MMM")}
            </Text>
            {team.is_my_team && (
              <Badge size="sm" color="blue" variant="filled">
                Mit hold
              </Badge>
            )}
          </Group>
          {membersPreview ? (
            <TeamNamesLine
              members={membersPreview.map((member) => ({
                key: String(member.user_id),

                name: member.first_name,

                houseNumber: member.house_number,

                isHousehold: member.is_housemate,
              }))}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {team.members_display}
            </Text>
          )}
        </div>
        <Group gap="xs">
          <Badge variant="light">{team.member_count} medlemmer</Badge>
          <ActionIcon variant="subtle" size="sm">
            {expanded ? (
              <IconChevronUp size={16} />
            ) : (
              <IconChevronDown size={16} />
            )}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse expanded={expanded}>
        <Divider my="sm" />
        {teamDetailsLoading || !teamDetails ? (
          <Center h={60}>
            <Loader size="sm" />
          </Center>
        ) : (
          <Stack gap="xs">
            {teamDetails.members.map((member) => (
              <Group key={member.id} justify="space-between">
                <Group gap="sm">
                  <Avatar
                    src={member.user.profile_picture}
                    radius="xl"
                    size="sm"
                  >
                    {member.user.first_name[0]}
                  </Avatar>
                  <div>
                    <Text
                      size="sm"
                      fw={
                        member.is_own || housemateIds.has(member.user.id)
                          ? 600
                          : 400
                      }
                    >
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
              </Group>
            ))}
          </Stack>
        )}
      </Collapse>
    </Paper>
  )
}

// Takeover button + confirm modal ("they owe you one")

interface RepayFavourButtonProps {
  favour: TeamFavour
}

/**
 * Work off a favour by cooking one of the creditor's upcoming days.
 *
 * Without this the ledger only grows: every takeover created a new debt in the
 * taker's favour, so "Jeg skylder" could be cleared only by the other person
 * marking it settled by hand.
 */
function RepayFavourButton({ favour }: RepayFavourButtonProps) {
  const [opened, { open, close }] = useDisclosure(false)

  const creditorName = favour.creditor.first_name

  const { data: options, isLoading } = useQuery({
    queryKey: ["food", "favours", favour.id, "repay-options"],

    queryFn: () => foodApi.getFavourRepayOptions(favour.id),

    // Only worth asking once the picker is actually open.
    enabled: opened,
  })

  return (
    <>
      <Button size="xs" variant="light" onClick={open}>
        Indfri med en maddag
      </Button>

      <Modal
        opened={opened}
        onClose={close}
        title={`Tag en af ${creditorName}s maddage`}
        centered
        size="md"
      >
        {isLoading ? (
          <Center h={80}>
            <Loader size="sm" />
          </Center>
        ) : !options || options.length === 0 ? (
          <Text c="dimmed" size="sm">
            {creditorName} har ingen kommende maddage, du kan tage lige nu. Prøv
            igen når næste periode er lagt.
          </Text>
        ) : (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Vælg den dag du vil lave mad i stedet for {creditorName}. Så er I
              kvit.
            </Text>
            {options.map((option) => (
              <Group key={option.membership_id} justify="space-between">
                <Text size="sm">
                  {option.day_name}, {dayjs(option.date).format("D. MMMM YYYY")}
                </Text>
                <TakeoverShiftButton
                  membershipId={option.membership_id}
                  ownerName={creditorName}
                  date={option.date}
                  settleFavourId={favour.id}
                  label="Tag denne dag"
                  color="green"
                />
              </Group>
            ))}
          </Stack>
        )}
      </Modal>
    </>
  )
}

interface TakeoverShiftButtonProps {
  /** The shift being taken over. */
  membershipId: number

  /** Whose shift it is, for the confirmation copy. */
  ownerName: string

  date: string

  /**
   * Pass a favour you owe this person to work it off: the shift still moves,
   * but that debt is cleared instead of a new one being created in your name.
   */
  settleFavourId?: number

  label: string

  variant?: string

  color?: string
}

/**
 * Take over someone else's cooking day.
 *
 * Deliberately not offered next to every name on every team: taking a shift is
 * unilateral -- the other person finds out afterwards -- so it belongs where
 * someone has actually asked to be relieved (a bytteanmodning), or where it
 * settles a debt you already owe.
 */
function TakeoverShiftButton({
  membershipId,
  ownerName,
  date,
  settleFavourId,
  label,
  variant = "light",
  color,
}: TakeoverShiftButtonProps) {
  const queryClient = useQueryClient()

  const [opened, { open, close }] = useDisclosure(false)

  const isRepayment = settleFavourId !== undefined

  const takeoverMutation = useMutation({
    mutationFn: () =>
      foodApi.takeover({
        target_membership_id: membershipId,
        ...(isRepayment ? { settle_favour_id: settleFavourId } : {}),
      }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "teams"] })

      queryClient.invalidateQueries({ queryKey: ["food", "favours"] })

      queryClient.invalidateQueries({ queryKey: ["food", "swap-broadcasts"] })

      notifications.show({
        title: "Maddag overtaget",

        message: isRepayment
          ? `Du har taget ${ownerName}s maddag. Tjenesten er nu udlignet.`
          : `Du har overtaget ${ownerName}s maddag. ${ownerName} skylder dig nu en tjeneste.`,

        color: "green",
      })

      close()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke overtage maddagen.")
    },
  })

  return (
    <>
      <Button
        variant={variant}
        color={color}
        size="xs"
        leftSection={<IconHeartHandshake size={14} />}
        onClick={open}
      >
        {label}
      </Button>

      <Modal
        opened={opened}
        onClose={close}
        title="Overtag maddag"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text>
            Du overtager {ownerName}s maddag d.{" "}
            {dayjs(date).format("D. MMMM YYYY")}.
          </Text>
          <Text>
            {isRepayment
              ? `Så er I kvit — tjenesten, du skylder ${ownerName}, bliver markeret som indfriet.`
              : `${ownerName} skylder dig så en tjeneste næste periode. Det noteres i jeres tjeneste-regnskab.`}
          </Text>
          <Group justify="flex-end">
            <Button variant="light" onClick={close}>
              Annuller
            </Button>
            <Button
              color="green"
              leftSection={<IconHeartHandshake size={16} />}
              onClick={() => takeoverMutation.mutate()}
              loading={takeoverMutation.isPending}
            >
              Overtag maddagen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// Team Member Row

interface TeamMemberRowProps {
  member: FoodTeamMember

  /** From your own house — bold here as well as on the folded card. */
  isHousehold?: boolean
}

function TeamMemberRow({ member, isHousehold }: TeamMemberRowProps) {
  return (
    <Group gap="sm">
      <Avatar src={member.user.profile_picture} radius="xl" size="sm">
        {member.user.first_name[0]}
      </Avatar>
      <div>
        <Text size="sm" fw={member.is_own || isHousehold ? 600 : 400}>
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke svare på bytteanmodning.")
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke annullere bytteanmodning.")
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
            {{
              pending: "Afventer",

              accepted: "Accepteret",

              declined: "Afvist",

              cancelled: "Annulleret",
            }[request.status] || request.status}
          </Badge>
        </Group>

        {/* requester_membership/target_membership are fixed roles on the
            request, but "Din"/"Deres" depend on who is viewing. For an incoming
            request the viewer is the target; for an outgoing one the viewer is
            the requester, so the two memberships swap sides. */}
        {(() => {
          const mine = request.is_incoming
            ? request.target_membership
            : request.requester_membership
          const theirs = request.is_incoming
            ? request.requester_membership
            : request.target_membership
          return (
            <Group gap="xl">
              <div>
                <Text size="xs" c="dimmed">
                  Din dato
                </Text>
                <Text size="sm" fw={500}>
                  {mine.team_day_name}, {dayjs(mine.team_date).format("D. MMM")}
                </Text>
              </div>
              <IconArrowsExchange size={16} />
              <div>
                <Text size="xs" c="dimmed">
                  Deres dato
                </Text>
                <Text size="sm" fw={500}>
                  {theirs.team_day_name},{" "}
                  {dayjs(theirs.team_date).format("D. MMM")}
                </Text>
              </div>
            </Group>
          )
        })()}

        {request.message && (
          <Paper p="xs" bg="var(--mantine-color-default-hover)" radius="sm">
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

// Favours ledger ("they owe you one" / "you owe them one")

interface FavoursSectionProps {
  favours: TeamFavour[]
}

function FavoursSection({ favours }: FavoursSectionProps) {
  const queryClient = useQueryClient()

  const settleMutation = useMutation({
    mutationFn: (id: number) => foodApi.settleFavour(id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "favours"] })

      notifications.show({
        title: "Tjeneste indfriet",

        message: "Tjenesten er markeret som indfriet.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke markere tjeneste som indfriet.")
    },
  })

  const owedToMe = favours.filter((f) => f.direction === "owed_to_me")

  const iOwe = favours.filter((f) => f.direction === "i_owe")

  return (
    <div>
      <Group gap="xs" mb="sm">
        <IconHeartHandshake size={20} />
        <Title order={4}>Tjeneste-regnskab</Title>
      </Group>

      <Stack gap="lg">
        <div>
          <Text fw={500} mb="xs">
            Nogen skylder mig
          </Text>
          {owedToMe.length === 0 ? (
            <Text c="dimmed" size="sm">
              Ingen skylder dig en tjeneste lige nu.
            </Text>
          ) : (
            <Stack gap="xs">
              {owedToMe.map((favour) => (
                <Paper key={favour.id} withBorder p="sm" radius="md">
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={500}>
                        {favour.debtor.first_name} {favour.debtor.last_name}{" "}
                        skylder dig en tjeneste
                      </Text>
                      <Text size="xs" c="dimmed">
                        Fra maddag d.{" "}
                        {dayjs(favour.origin_date).format("D. MMMM YYYY")}
                        {favour.note ? ` · ${favour.note}` : ""}
                      </Text>
                    </div>
                    {favour.settled ? (
                      <Badge color="green" variant="light">
                        Indfriet
                      </Badge>
                    ) : (
                      <Button
                        size="xs"
                        variant="light"
                        color="green"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => settleMutation.mutate(favour.id)}
                        loading={settleMutation.isPending}
                      >
                        Markér som indfriet
                      </Button>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </div>

        <div>
          <Text fw={500} mb="xs">
            Jeg skylder
          </Text>
          {iOwe.length === 0 ? (
            <Text c="dimmed" size="sm">
              Du skylder ikke nogen en tjeneste lige nu.
            </Text>
          ) : (
            <Stack gap="xs">
              {iOwe.map((favour) => (
                <Paper key={favour.id} withBorder p="sm" radius="md">
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={500}>
                        Du skylder {favour.creditor.first_name}{" "}
                        {favour.creditor.last_name} en tjeneste
                      </Text>
                      <Text size="xs" c="dimmed">
                        Fra maddag d.{" "}
                        {dayjs(favour.origin_date).format("D. MMMM YYYY")}
                        {favour.note ? ` · ${favour.note}` : ""}
                      </Text>
                    </div>
                    {favour.settled ? (
                      <Badge color="green" variant="light">
                        Indfriet
                      </Badge>
                    ) : (
                      <RepayFavourButton favour={favour} />
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </div>
      </Stack>
    </div>
  )
}

// Broadcasts section: incoming (others want to swap) + outgoing (mine)

interface BroadcastsSectionProps {
  broadcasts: SwapBroadcast[]

  myTeams: FoodTeam[]
}

function BroadcastsSection({ broadcasts, myTeams }: BroadcastsSectionProps) {
  // Show every non-mine broadcast the backend returned. The backend already
  // limits to broadcasts where I was a candidate or have a date overlap, so
  // even closed ones are relevant here — that's how a candidate sees
  // "already accepted by X" after the fact when they click their notification.
  const incoming = broadcasts.filter((b) => !b.is_mine)

  const outgoing = broadcasts.filter((b) => b.is_mine)

  return (
    <div>
      <Group gap="xs" mb="sm">
        <IconBroadcast size={20} />
        <Title order={4}>Bytteanmodninger (bredt udsendt)</Title>
      </Group>

      <Stack gap="lg">
        <div>
          <Text fw={500} mb="xs">
            Bytteanmodninger til dig
          </Text>
          {incoming.length === 0 ? (
            <Text c="dimmed" size="sm">
              Ingen aktuelle bytteanmodninger til dig.
            </Text>
          ) : (
            <Stack gap="sm">
              {incoming.map((broadcast) => (
                <IncomingBroadcastCard
                  key={broadcast.id}
                  broadcast={broadcast}
                  myTeams={myTeams}
                />
              ))}
            </Stack>
          )}
        </div>

        <div>
          <Text fw={500} mb="xs">
            Mine udsendte anmodninger
          </Text>
          {outgoing.length === 0 ? (
            <Text c="dimmed" size="sm">
              Du har ingen udsendte bytteanmodninger.
            </Text>
          ) : (
            <Stack gap="sm">
              {outgoing.map((broadcast) => (
                <OutgoingBroadcastCard
                  key={broadcast.id}
                  broadcast={broadcast}
                />
              ))}
            </Stack>
          )}
        </div>
      </Stack>
    </div>
  )
}

// Incoming broadcast: pick one of my memberships on the broadcast's available dates

interface IncomingBroadcastCardProps {
  broadcast: SwapBroadcast

  myTeams: FoodTeam[]
}

interface BroadcastReturnOption {
  membershipId: number

  date: string

  dayName: string
}

function IncomingBroadcastCard({
  broadcast,
  myTeams,
}: IncomingBroadcastCardProps) {
  const queryClient = useQueryClient()

  const [selectedMembershipId, setSelectedMembershipId] =
    useState<string | null>(null)

  // My memberships on one of the broadcast's available dates

  const availableSet = new Set(broadcast.available_dates)

  const returnOptions: BroadcastReturnOption[] = myTeams
    .filter((t) => availableSet.has(t.date))
    .map((t) => {
      const ownMembership = t.members.find((m) => m.is_own)

      return ownMembership
        ? {
            membershipId: ownMembership.id,

            date: t.date,

            dayName: t.day_name,
          }
        : null
    })
    .filter((o): o is BroadcastReturnOption => o !== null)

  const acceptMutation = useMutation({
    mutationFn: (membershipId: number) =>
      foodApi.acceptSwapBroadcast(broadcast.id, membershipId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-broadcasts"] })

      queryClient.invalidateQueries({ queryKey: ["food", "teams"] })

      notifications.show({
        title: "Byt accepteret",

        message: "Holdbyttet er gennemført.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke acceptere byt.")
    },
  })

  return (
    <Card withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group gap="xs">
          <Avatar
            src={broadcast.requester.profile_picture}
            radius="xl"
            size="sm"
          >
            {broadcast.requester.first_name[0]}
          </Avatar>
          <Text size="sm">
            <Text span fw={600}>
              {broadcast.requester.first_name}
            </Text>{" "}
            vil bytte sin maddag {broadcast.requester_membership.day_name}{" "}
            {dayjs(broadcast.requester_membership.date).format("D. MMM")}
          </Text>
        </Group>

        {broadcast.message && (
          <Paper p="xs" bg="var(--mantine-color-default-hover)" radius="sm">
            <Text size="sm" c="dimmed">
              "{broadcast.message}"
            </Text>
          </Paper>
        )}

        <Text size="xs" c="dimmed">
          {broadcast.requester.first_name} kan i stedet tage:{" "}
          {broadcast.available_dates
            .map((d) => dayjs(d).format("ddd D. MMM"))
            .join(", ")}
        </Text>

        {broadcast.status === "accepted" ? (
          <Alert color="gray" variant="light" p="xs">
            Allerede accepteret
            {broadcast.accepted_by
              ? ` af ${broadcast.accepted_by.first_name}`
              : ""}
            . Du behøver ikke gøre noget.
          </Alert>
        ) : broadcast.status === "cancelled" ? (
          <Alert color="gray" variant="light" p="xs">
            Anmodningen er trukket tilbage.
          </Alert>
        ) : returnOptions.length === 0 ? (
          <>
            <Alert color="yellow" variant="light" p="xs">
              Du har ingen af dine egne maddage på de datoer, så du kan ikke
              bytte her. Du kan stadig tage dagen, hvis du vil.
            </Alert>
            <Group justify="flex-end">
              <TakeoverShiftButton
                membershipId={broadcast.requester_membership.id}
                ownerName={broadcast.requester.first_name}
                date={broadcast.requester_membership.date}
                label="Jeg tager den (de skylder dig en)"
              />
            </Group>
          </>
        ) : (
          <>
            <Select
              label="Vælg hvilken af dine maddage du giver i bytte"
              placeholder="Vælg en maddag"
              data={returnOptions.map((o) => ({
                value: String(o.membershipId),

                label: `${o.dayName}, ${dayjs(o.date).format("D. MMMM")}`,
              }))}
              value={selectedMembershipId}
              onChange={setSelectedMembershipId}
            />
            <Group justify="flex-end">
              <Button
                color="green"
                leftSection={<IconArrowsExchange size={16} />}
                disabled={!selectedMembershipId}
                loading={acceptMutation.isPending}
                onClick={() =>
                  selectedMembershipId &&
                  acceptMutation.mutate(Number(selectedMembershipId))
                }
              >
                Accepter byt
              </Button>
            </Group>
            <Group justify="flex-end">
              <TakeoverShiftButton
                membershipId={broadcast.requester_membership.id}
                ownerName={broadcast.requester.first_name}
                date={broadcast.requester_membership.date}
                label="Eller tag den uden at bytte (de skylder dig en)"
                variant="subtle"
              />
            </Group>
          </>
        )}
      </Stack>
    </Card>
  )
}

// Outgoing broadcast (mine): show status + cancel if open

interface OutgoingBroadcastCardProps {
  broadcast: SwapBroadcast
}

function OutgoingBroadcastCard({ broadcast }: OutgoingBroadcastCardProps) {
  const queryClient = useQueryClient()

  const cancelMutation = useMutation({
    mutationFn: () => foodApi.cancelSwapBroadcast(broadcast.id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "swap-broadcasts"] })

      notifications.show({
        title: "Anmodning annulleret",

        message: "Din bytteanmodning er blevet annulleret.",

        color: "blue",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke annullere bytteanmodning.")
    },
  })

  const statusLabel: Record<string, string> = {
    open: "Åben",

    accepted: "Accepteret",

    cancelled: "Annulleret",
  }

  const statusColor: Record<string, string> = {
    open: "yellow",

    accepted: "green",

    cancelled: "gray",
  }

  return (
    <Card withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm">
            Din maddag {broadcast.requester_membership.day_name}{" "}
            {dayjs(broadcast.requester_membership.date).format("D. MMM")}
          </Text>
          <Badge color={statusColor[broadcast.status] || "gray"}>
            {statusLabel[broadcast.status] || broadcast.status}
          </Badge>
        </Group>

        <Text size="xs" c="dimmed">
          Du kan i stedet tage:{" "}
          {broadcast.available_dates
            .map((d) => dayjs(d).format("ddd D. MMM"))
            .join(", ")}
        </Text>

        {broadcast.status === "accepted" && broadcast.accepted_by && (
          <Text size="sm" c="dimmed">
            Accepteret af {broadcast.accepted_by.first_name}{" "}
            {broadcast.accepted_by.last_name}
          </Text>
        )}

        {broadcast.status === "open" && (
          <Group justify="flex-end">
            <Button
              variant="light"
              color="gray"
              size="sm"
              onClick={() => cancelMutation.mutate()}
              loading={cancelMutation.isPending}
            >
              Annullér
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  )
}

// Min profil (self-service food profile)

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Mandag" },

  { value: "1", label: "Tirsdag" },

  { value: "2", label: "Onsdag" },

  { value: "3", label: "Torsdag" },
]

function FoodProfilePanel() {
  const queryClient = useQueryClient()

  const { data: profile, isLoading } = useQuery({
    queryKey: ["food", "profile"],

    queryFn: foodApi.getMyFoodProfile,
  })

  const [comment, setComment] = useState("")

  const [commentLoaded, setCommentLoaded] = useState(false)

  useEffect(() => {
    if (profile && !commentLoaded) {
      setComment(profile.food_team_pause_reason)

      setCommentLoaded(true)
    }
  }, [profile, commentLoaded])

  const updateMutation = useMutation({
    mutationFn: (data: Partial<MyFoodProfile>) =>
      foodApi.updateMyFoodProfile(data),

    onSuccess: (updated) => {
      queryClient.setQueryData(["food", "profile"], updated)

      queryClient.invalidateQueries({ queryKey: ["food", "profile"] })

      notifications.show({
        title: "Profil gemt",

        message: "Din madhold-profil er blevet opdateret.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme profil. Prøv igen.")
    },
  })

  if (isLoading || !profile) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  const housemateSuffix = profile.housemate_name
    ? ` (med ${profile.housemate_name})`
    : ""

  const selectedDays = profile.default_cooking_days.map((d) => String(d))

  return (
    <Stack gap="lg">
      <Card withBorder p="lg" radius="md">
        <Stack gap="lg">
          <div>
            <Title order={3}>Min madhold-profil</Title>
            <Text c="dimmed" size="sm">
              Disse oplysninger hjælper den madhold-ansvarlige med at
              sammensætte holdene.
            </Text>
          </div>

          <Switch
            checked={profile.can_be_head_chef}
            onChange={(e) =>
              updateMutation.mutate({
                can_be_head_chef: e.currentTarget.checked,
              })
            }
            label="Jeg kan være chefkok"
            description="Markér hvis du er tryg ved at have hovedansvaret for et måltid."
          />

          <Switch
            checked={profile.prefers_cooking_with_housemate}
            onChange={(e) =>
              updateMutation.mutate({
                prefers_cooking_with_housemate: e.currentTarget.checked,
              })
            }
            label="Jeg vil lave mad sammen med min medbeboer"
            description={`Sættes du på hold sammen med din medbeboer, hvis muligt.${housemateSuffix}`}
          />

          {/* Over 50 only feeds the holdbalancering, and a birthdate answers it
              on its own — so we only ask the residents we can't work it out for. */}
          {!profile.has_birthdate && (
            <Switch
              checked={profile.is_over_50}
              onChange={(e) =>
                updateMutation.mutate({ is_over_50: e.currentTarget.checked })
              }
              label="Jeg er over 50"
              description="Bruges kun til holdbalancering. Udfylder du din fødselsdato under Min profil, regner vi det selv ud."
            />
          )}

          <Divider />

          <Switch
            checked={profile.is_exempt_from_food_teams}
            onChange={(e) =>
              updateMutation.mutate({
                is_exempt_from_food_teams: e.currentTarget.checked,
              })
            }
            label="Jeg holder pause fra madhold"
            description="Du bliver ikke sat på madhold, så længe dette er slået til. Slå det fra igen, når du er klar."
            color="red"
          />

          {profile.is_exempt_from_food_teams && (
            <>
              <Textarea
                label="Hvorfor holder du pause?"
                description="Vises for madhold-ansvarlig, så de ved hvad de kan regne med. Kort er fint — og du kan lade den stå tom."
                placeholder="F.eks. væk til foråret, sygdom, nyfødt i huset..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                minRows={2}
                autosize
              />
              <Group justify="flex-end">
                <Button
                  onClick={() =>
                    updateMutation.mutate({ food_team_pause_reason: comment })
                  }
                  loading={updateMutation.isPending}
                  disabled={comment === profile.food_team_pause_reason}
                >
                  Gem begrundelse
                </Button>
              </Group>
            </>
          )}

          <Divider />

          <div>
            <Text fw={500} mb={4}>
              Ugedage jeg typisk kan lave mad
            </Text>
            <Text size="sm" c="dimmed" mb="sm">
              Bruges som standard, når du indsender ønsker.
            </Text>
            <Chip.Group
              multiple
              value={selectedDays}
              onChange={(value) =>
                updateMutation.mutate({
                  default_cooking_days: (value as string[]).map((v) =>
                    Number(v),
                  ),
                })
              }
            >
              <Group gap="xs">
                {WEEKDAY_OPTIONS.map((opt) => (
                  <Chip key={opt.value} value={opt.value}>
                    {opt.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </div>
        </Stack>
      </Card>
    </Stack>
  )
}
