import { useState, useEffect } from "react"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Loader,
  Center,
  Stack,
  SimpleGrid,
  SegmentedControl,
} from "@mantine/core"

import { useDebouncedCallback } from "@mantine/hooks"

import { showErrorNotification } from "../utils/errorNotification"

import { foodApi } from "../api/food"

import { BackButton } from "../components/BackButton"

import { MealFormFields } from "../components/MealFormFields"

import { useAuthStore } from "../store/authStore"

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
  const queryClient = useQueryClient()

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
      <BackButton to="/mad" label="Tilbage til mad" />

      <Title order={1} mb="xs">
        Standardindstillinger
      </Title>
      <Text c="dimmed" mb="xl">
        Angiv dine standardindstillinger for hver dag. Disse vises automatisk
        for uger du endnu ikke har ændret.
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {DAYS.map((day) => (
          <PreferenceCard
            key={prefsByDay.get(day.value)?.id ?? `new-${day.value}`}
            dayOfWeek={day.value}
            dayName={day.label}
            preference={prefsByDay.get(day.value)}
            isWednesday={day.value === 2}
            onSaved={() =>
              queryClient.invalidateQueries({
                queryKey: ["food", "registrations"],
              })
            }
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

  onSaved: () => void
}

function PreferenceCard({
  dayOfWeek,

  dayName,

  preference,

  isWednesday,

  onSaved,
}: PreferenceCardProps) {
  const queryClient = useQueryClient()

  const { user } = useAuthStore()

  const houseCount = user?.house_inhabitant_count || 1

  const isAllZero =
    (preference?.adults_meat ?? 0) === 0 &&
    (preference?.adults_veg ?? 0) === 0 &&
    (preference?.children_count ?? 0) === 0 &&
    preference !== undefined

  const [adultsMeat, setAdultsMeat] = useState(preference?.adults_meat ?? 0)

  const [adultsVeg, setAdultsVeg] = useState(
    preference?.adults_veg ?? houseCount,
  )

  const [children, setChildren] = useState(preference?.children_count ?? 0)

  const [diningOption, setDiningOption] = useState<DiningOption>(
    preference?.dining_option ?? "eat_in",
  )

  const [seatingTime, setSeatingTime] = useState<SeatingTime>(
    preference?.seating_time ?? "17:30",
  )

  const [isEating, setIsEating] = useState(!isAllZero)

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

      onSaved()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme præferencer.")

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

      onSaved()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere præferencer.")

      setIsSaving(false)
    },
  })

  const debouncedSave = useDebouncedCallback(
    (data: CreateMealPreferenceData, prefId: number | undefined) => {
      setIsSaving(true)

      if (prefId) {
        updateMutation.mutate(data)
      } else {
        createMutation.mutate(data)
      }
    },

    500,
  )

  const handleEatingChange = (val: string) => {
    const eating = val === "yes"

    setIsEating(eating)

    if (!eating) {
      setAdultsMeat(0)

      setAdultsVeg(0)

      setChildren(0)
    } else {
      // Restore sensible defaults

      setAdultsMeat(isWednesday ? houseCount : 0)

      setAdultsVeg(isWednesday ? 0 : houseCount)

      setChildren(0)
    }
  }

  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true)

      return
    }

    debouncedSave(
      {
        day_of_week: dayOfWeek,

        adults_meat: adultsMeat,

        adults_veg: adultsVeg,

        children_count: children,

        dining_option: diningOption,

        seating_time: seatingTime,
      },

      preference?.id,
    )
  }, [adultsMeat, adultsVeg, children, diningOption, seatingTime])

  return (
    <Paper withBorder p="md" radius="md">
      <Text fw={500} mb="md">
        {dayName}
      </Text>

      <Stack gap="sm">
        <SegmentedControl
          value={isEating ? "yes" : "no"}
          onChange={handleEatingChange}
          data={[
            { label: "Spiser", value: "yes" },

            { label: "Spiser ikke", value: "no" },
          ]}
          fullWidth
        />

        {isEating && (
          <MealFormFields
            adultsMeat={adultsMeat}
            adultsVeg={adultsVeg}
            children={children}
            diningOption={diningOption}
            seatingTime={seatingTime}
            isWednesday={isWednesday}
            onAdultsMeatChange={setAdultsMeat}
            onAdultsVegChange={setAdultsVeg}
            onChildrenChange={setChildren}
            onDiningOptionChange={setDiningOption}
            onSeatingTimeChange={setSeatingTime}
          />
        )}

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
