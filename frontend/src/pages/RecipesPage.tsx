import { useState } from "react"

import { useNavigate } from "react-router-dom"

import { useQuery } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Stack,
  Badge,
  ActionIcon,
  Center,
  Loader,
  SimpleGrid,
  Anchor,
} from "@mantine/core"

import {
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconBook2,
  IconArrowLeft,
  IconFileText,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

import { foodApi } from "../api/food"

import { RecipeDrawer, FrontPageDrawer } from "../components/RecipeView"

import type { RecipeSheet, DayFrontPage } from "../types"

const DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag"]

function getWeekLabel(offset: number): string {
  if (offset === 0) return "Denne uge"
  if (offset === 1) return "Næste uge"
  if (offset === -1) return "Sidste uge"
  return `${offset > 0 ? "+" : ""}${offset} uger`
}

export default function RecipesPage() {
  const navigate = useNavigate()

  const currentWeekStart = dayjs().startOf("isoWeek")

  const [weekOffset, setWeekOffset] = useState(0)

  const weekStart = currentWeekStart.add(weekOffset, "week")

  const weekNumber = weekStart.isoWeek()

  const year = weekStart.isoWeekYear()

  const [activeRecipe, setActiveRecipe] = useState<RecipeSheet | null>(null)

  const [activeFrontPage, setActiveFrontPage] = useState<DayFrontPage | null>(
    null,
  )

  const { data, isLoading } = useQuery({
    queryKey: ["food", "week-recipes", weekNumber, year],
    queryFn: () => foodApi.getWeekRecipes(weekNumber, year),
  })

  const recipes = data?.recipes ?? []
  const frontPages = data?.front_pages ?? []

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Ugens opskrifter</Title>
          <Text c="dimmed">Opskrifter for ugens retter (mandag–torsdag)</Text>
        </div>
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate("/mad")}
        >
          Til Mad
        </Button>
      </Group>

      <Stack gap="md">
        {/* Week navigation */}
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between">
            <ActionIcon
              variant="light"
              size="lg"
              onClick={() => setWeekOffset(weekOffset - 1)}
            >
              <IconChevronLeft size={20} />
            </ActionIcon>

            <Stack gap={0} align="center">
              <Text fw={500}>
                Uge {weekNumber} · {weekStart.format("D. MMM")} –{" "}
                {weekStart.add(3, "day").format("D. MMM")}
              </Text>
              <Badge
                color={
                  weekOffset === 0 ? "blue" : weekOffset > 0 ? "green" : "gray"
                }
                variant="light"
                size="sm"
              >
                {getWeekLabel(weekOffset)}
              </Badge>
              {data?.recipe_folder_url && (
                <Anchor
                  href={data.recipe_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="xs"
                  c="dimmed"
                  mt={4}
                >
                  <Group gap={4}>
                    <IconExternalLink size={12} />
                    Se i Drive
                  </Group>
                </Anchor>
              )}
            </Stack>

            <ActionIcon
              variant="light"
              size="lg"
              onClick={() => setWeekOffset(weekOffset + 1)}
            >
              <IconChevronRight size={20} />
            </ActionIcon>
          </Group>
        </Paper>

        {isLoading ? (
          <Center h={200}>
            <Loader size="lg" />
          </Center>
        ) : recipes.length === 0 && frontPages.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Text c="dimmed" ta="center">
              Ingen opskrifter fundet for denne uge endnu.
            </Text>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {DAY_NAMES.map((dayName, dayIndex) => {
              const dayRecipes = recipes.filter((r) => r.day === dayIndex)
              const dayFront = frontPages.find((fp) => fp.day === dayIndex)
              if (dayRecipes.length === 0 && !dayFront) return null

              return (
                <Paper key={dayName} withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">
                    {dayName}
                  </Text>
                  <Stack gap="xs">
                    {dayFront && (
                      <Button
                        variant="light"
                        color="blue"
                        justify="flex-start"
                        leftSection={<IconFileText size={16} />}
                        onClick={() => setActiveFrontPage(dayFront)}
                      >
                        Forside
                      </Button>
                    )}
                    {dayRecipes.map((r) => (
                      <Button
                        key={`${r.code}-${r.index}`}
                        variant="light"
                        color="green"
                        justify="flex-start"
                        leftSection={<IconBook2 size={16} />}
                        onClick={() => setActiveRecipe(r)}
                      >
                        {r.name}
                      </Button>
                    ))}
                  </Stack>
                </Paper>
              )
            })}
          </SimpleGrid>
        )}
      </Stack>

      <RecipeDrawer
        recipe={activeRecipe}
        opened={!!activeRecipe}
        onClose={() => setActiveRecipe(null)}
      />

      <FrontPageDrawer
        frontPage={activeFrontPage}
        opened={!!activeFrontPage}
        onClose={() => setActiveFrontPage(null)}
      />
    </>
  )
}
