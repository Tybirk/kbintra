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
  SimpleGrid,
} from "@mantine/core"
import { useDebouncedCallback } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import { IconArrowLeft } from "@tabler/icons-react"

import { foodApi } from "../api/food"
import { MealFormFields } from "../components/MealFormFields"
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
            key={prefsByDay.get(day.value)?.id ?? `new-${day.value}`}
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
  const [mealType, setMealType] = useState<"meat" | "vegetarian">(
    preference?.prefers_meat !== false ? "meat" : "vegetarian",
  )
  const [diningOption, setDiningOption] = useState<DiningOption>(
    preference?.dining_option ?? "eat_in",
  )
  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    preference?.seating_time ?? "17:30",
  )

  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)

  const createMutation = useMutation({
    mutationFn: (data: CreateMealPreferenceData) =>
      foodApi.createPreference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "preferences"] })
      setLastSaved(new Date())
      setIsSaving(false)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke gemme præferencer.",
        color: "red",
      })
      setIsSaving(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateMealPreferenceData>) =>
      foodApi.updatePreference(preference!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "preferences"] })
      setLastSaved(new Date())
      setIsSaving(false)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere præferencer.",
        color: "red",
      })
      setIsSaving(false)
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

  const debouncedSave = useDebouncedCallback(
    (
      data: CreateMealPreferenceData,
      prefId: number | undefined,
    ) => {
      setIsSaving(true)
      if (prefId) {
        updateMutation.mutate(data)
      } else {
        createMutation.mutate(data)
      }
    },
    500,
  )

  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true)
      return
    }

    debouncedSave(
      {
        day_of_week: dayOfWeek,
        adults_count: adults,
        children_count: children,
        prefers_meat: mealType === "meat",
        dining_option: diningOption,
        seating_time: seatingTime,
      },
      preference?.id,
    )
  }, [adults, children, mealType, diningOption, seatingTime])

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Text fw={500}>{dayName}</Text>
        {preference && (
          <Button
            variant="subtle"
            color="red"
            size="compact-sm"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Fjern
          </Button>
        )}
      </Group>

      <Stack gap="sm">
        <MealFormFields
          adults={adults}
          children={children}
          mealType={mealType}
          diningOption={diningOption}
          seatingTime={seatingTime}
          isWednesday={isWednesday}
          onAdultsChange={setAdults}
          onChildrenChange={setChildren}
          onMealTypeChange={setMealType}
          onDiningOptionChange={setDiningOption}
          onSeatingTimeChange={setSeatingTime}
        />

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
      </Stack>
    </Paper>
  )
}
