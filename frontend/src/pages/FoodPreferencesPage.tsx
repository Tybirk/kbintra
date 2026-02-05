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
  NumberInput,
  Switch,
  SimpleGrid,
  SegmentedControl,
  Divider,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { IconArrowLeft } from "@tabler/icons-react"

import { foodApi } from "../api/food"
import type {
  MealPreference,
  CreateMealPreferenceData,
  DiningOption,
  SeatingTime,
} from "../types"

const DAYS = [
  { value: 0, label: "Mandag" },
  { value: 1, label: "Tirsdag" },
  { value: 2, label: "Onsdag" },
  { value: 3, label: "Torsdag" },
]

export default function FoodPreferencesPage() {
  const navigate = useNavigate()

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["food", "preferences"],
    queryFn: foodApi.getPreferences,
  })

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  // Create a map of preferences by day
  const prefsByDay = new Map<number, MealPreference>()
  preferences?.forEach((pref) => {
    prefsByDay.set(pref.day_of_week, pref)
  })

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/mad")}
        mb="md"
      >
        Tilbage til mad
      </Button>

      <Title order={1} mb="xs">
        Standardindstillinger
      </Title>
      <Text c="dimmed" mb="xl">
        Angiv dine standardindstillinger for hver dag. Disse bruges når du
        anvender standarder på en uge.
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {DAYS.map((day) => (
          <PreferenceCard
            key={day.value}
            dayOfWeek={day.value}
            dayName={day.label}
            preference={prefsByDay.get(day.value)}
            isWednesday={day.value === 2}
          />
        ))}
      </SimpleGrid>
    </>
  )
}

interface PreferenceCardProps {
  dayOfWeek: number
  dayName: string
  preference?: MealPreference
  isWednesday: boolean
}

function PreferenceCard({
  dayOfWeek,
  dayName,
  preference,
  isWednesday,
}: PreferenceCardProps) {
  const queryClient = useQueryClient()
  const [adults, setAdults] = useState(preference?.adults_count ?? 1)
  const [children, setChildren] = useState(preference?.children_count ?? 0)
  const [prefersMeat, setPrefersMeat] = useState(
    preference?.prefers_meat ?? true,
  )
  const [diningOption, setDiningOption] = useState<DiningOption>(
    preference?.dining_option ?? "eat_in",
  )
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    preference?.seating_time ?? "17:30",
  )

  // Update local state when preference data changes
  useEffect(() => {
    if (preference) {
      setAdults(preference.adults_count)
      setChildren(preference.children_count)
      setPrefersMeat(preference.prefers_meat)
      setDiningOption(preference.dining_option)
      setSeatingTime(preference.seating_time)
    }
  }, [preference])

  const createMutation = useMutation({
    mutationFn: (data: CreateMealPreferenceData) =>
      foodApi.createPreference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "preferences"] })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme præferencer.",
        color: "red",
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateMealPreferenceData>) =>
      foodApi.updatePreference(preference!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "preferences"] })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere præferencer.",
        color: "red",
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => foodApi.deletePreference(preference!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "preferences"] })
      notifications.show({
        title: "Slettet",
        message: `Præferencer fjernet for ${dayName}`,
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette præferencer.",
        color: "red",
      })
    },
  })

  const handleSave = () => {
    const data: CreateMealPreferenceData = {
      day_of_week: dayOfWeek,
      adults_count: adults,
      children_count: children,
      prefers_meat: prefersMeat,
      dining_option: diningOption,
      seating_time: seatingTime,
    }

    if (preference) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const hasChanges =
    !preference ||
    preference.adults_count !== adults ||
    preference.children_count !== children ||
    preference.prefers_meat !== prefersMeat ||
    preference.dining_option !== diningOption ||
    preference.seating_time !== seatingTime

  return (
    <Paper withBorder p="md" radius="md">
      <Text fw={500} mb="md">
        {dayName}
      </Text>

      <Stack gap="sm">
        <Group grow>
          <NumberInput
            label="Voksne"
            value={adults}
            onChange={(val) => setAdults(Number(val) || 0)}
            min={0}
            max={10}
          />
          <NumberInput
            label="Børn"
            value={children}
            onChange={(val) => setChildren(Number(val) || 0)}
            min={0}
            max={10}
          />
        </Group>

        {isWednesday && (
          <Switch
            label="Foretrækker kød"
            checked={prefersMeat}
            onChange={(e) => setPrefersMeat(e.currentTarget.checked)}
          />
        )}

        <Divider />

        <div>
          <Text size="sm" fw={500} mb={4}>
            Spisemulighed
          </Text>
          <SegmentedControl
            value={diningOption}
            onChange={(val) => setDiningOption(val as DiningOption)}
            data={[
              { label: "Spis i fælleshuset", value: "eat_in" },
              { label: "Tag med", value: "take_away" },
            ]}
            fullWidth
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
            />
          </div>
        )}

        <Divider />

        <Group>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            loading={createMutation.isPending || updateMutation.isPending}
            style={{ flex: 1 }}
          >
            {preference ? "Opdater" : "Gem"}
          </Button>
          {preference && (
            <Button
              variant="light"
              color="red"
              onClick={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
            >
              Fjern
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  )
}
