import { useState } from "react"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Paper,
  Group,
  Stack,
  Title,
  Text,
  Textarea,
  Avatar,
  Button,
  ThemeIcon,
  Collapse,
  FileButton,
  Divider,
  SimpleGrid,
  Skeleton,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import {
  IconChefHat,
  IconExternalLink,
  IconToolsKitchen2,
  IconToolsKitchen,
  IconBowl,
  IconPhoto,
  IconBook2,
  IconFileText,
  IconCheck,
} from "@tabler/icons-react"

import { foodApi } from "../api/food"

import { showErrorNotification } from "../utils/errorNotification"

import { RecipeDrawer, FrontPageDrawer } from "./RecipeView"

import type { RegistrationCount, RecipeSheet } from "../types"

interface ServingBucket {
  label: string
  count: RegistrationCount
}

// Weighted headcount: children count as half a person.
function weightedCount(count: RegistrationCount): number {
  return count.adults + 0.5 * count.children
}

export default function TodayFoodTeamActionBox() {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["today-food-team"],
    queryFn: foodApi.getTodayActionBox,
  })

  // The backend is the source of truth for "already announced today" — refetch
  // after every attempt (sent or rejected) so the buttons settle on it.
  const refreshActionBox = () =>
    queryClient.invalidateQueries({
      queryKey: ["today-food-team"],
      exact: true,
    })

  // Recipes are loaded separately — they require a Drive API round-trip on
  // cache miss, so we don't want them blocking the box's first paint.
  const { data: recipesData, isLoading: recipesLoading } = useQuery({
    queryKey: ["today-food-team", "recipes"],
    queryFn: foodApi.getTodayRecipes,
    enabled: !!data?.on_team,
  })

  const [leftoversOpen, setLeftoversOpen] = useState(false)

  const [leftoverImage, setLeftoverImage] = useState<File | null>(null)

  const [leftoverMessage, setLeftoverMessage] = useState("")

  const [activeRecipe, setActiveRecipe] = useState<RecipeSheet | null>(null)

  const [frontPageOpen, setFrontPageOpen] = useState(false)

  const teamId = data?.team_id

  const { data: stats } = useQuery({
    queryKey: ["food", "daily-stats", data?.date],
    queryFn: () => foodApi.getDailyStats(data!.date as string),
    enabled: !!data?.on_team && !!data?.date,
  })

  const takeawayMutation = useMutation({
    mutationFn: () => foodApi.notifyTakeaway(teamId as number),

    onSuccess: (res) => {
      refreshActionBox()

      if (res.sent) {
        notifications.show({
          title: "Takeaway-besked sendt",
          message: "Beboerne er blevet notificeret om, at takeaway er klar.",
          color: "green",
        })
      } else {
        notifications.show({
          title: "Allerede sendt",
          message: "Der er allerede sendt en takeaway-besked i dag.",
          color: "blue",
        })
      }
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke sende takeaway-besked.")
    },
  })

  const leftoversMutation = useMutation({
    mutationFn: () =>
      foodApi.notifyLeftovers(teamId as number, leftoverMessage, leftoverImage),

    onSuccess: (res) => {
      setLeftoversOpen(false)

      setLeftoverImage(null)

      setLeftoverMessage("")

      refreshActionBox()

      if (res.sent) {
        notifications.show({
          title: "Rester-besked sendt",
          message: "Beboerne er blevet notificeret om, at der er rester.",
          color: "green",
        })
      } else {
        notifications.show({
          title: "Allerede sendt",
          message: "Der er allerede sendt en rester-besked i dag.",
          color: "blue",
        })
      }
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke sende rester-besked.")
    },
  })

  // Self-hide when the user is not on today's team.
  if (!data?.on_team) return null

  const members = data.members ?? []

  const takeawaySent = data.takeaway_sent === true
  const leftoversSent = data.leftovers_sent === true

  const recipes = [...(recipesData?.recipes ?? [])].sort(
    (a, b) => a.index - b.index,
  )
  const recipeFolderUrl = recipesData?.recipe_folder_url ?? ""
  const frontPage = recipesData?.front_page ?? null

  // Build serving buckets defensively — stats may be missing or closed.
  const buckets: ServingBucket[] = stats
    ? [
        { label: "Takeaway", count: stats.takeaway },
        { label: "Fælles 17:30", count: stats.eat_in_1730 },
        { label: "Fælles 18:30", count: stats.eat_in_1830 },
      ]
    : []

  const totalWeighted = buckets.reduce(
    (sum, b) => sum + weightedCount(b.count),
    0,
  )

  return (
    <Paper
      withBorder
      shadow="md"
      p="lg"
      radius="md"
      mb="xl"
      bg="var(--mantine-color-green-light)"
    >
      <Group gap="xs" mb="md">
        <ThemeIcon size="md" color="green" radius="xl">
          <IconChefHat size={18} />
        </ThemeIcon>
        <Title order={3}>Du har madhold i dag 🍳</Title>
      </Group>

      <Stack gap="md">
        {/* Team members */}
        {members.length > 0 && (
          <Group gap="sm">
            {members.map((m) => (
              <Group key={m.id} gap={6} wrap="nowrap">
                <Avatar src={m.user.profile_picture} radius="xl" size="sm">
                  {m.user.first_name?.[0]}
                  {m.user.last_name?.[0]}
                </Avatar>
                <Text size="sm">
                  {m.user.first_name} {m.user.last_name}
                  {m.house_number ? ` (nr. ${m.house_number})` : ""}
                </Text>
              </Group>
            ))}
          </Group>
        )}

        {/* Recipe folder + file links. Show skeletons while the Drive-backed
            recipes query is in flight so the rest of the box still renders. */}
        {recipesLoading ? (
          <Stack gap={6}>
            <Skeleton height={32} width={220} radius="sm" />
            <Skeleton height={16} width="40%" radius="sm" />
            <Group gap="xs">
              <Skeleton height={20} width={140} radius="sm" />
              <Skeleton height={20} width={120} radius="sm" />
              <Skeleton height={20} width={100} radius="sm" />
            </Group>
          </Stack>
        ) : (
          <>
            {(recipeFolderUrl || frontPage) && (
              <Group gap="xs">
                {frontPage && (
                  <Button
                    variant="light"
                    color="blue"
                    size="sm"
                    leftSection={<IconFileText size={16} />}
                    onClick={() => setFrontPageOpen(true)}
                  >
                    Dagens forside
                  </Button>
                )}
                {recipeFolderUrl && (
                  <Button
                    component="a"
                    href={recipeFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="light"
                    color="green"
                    size="sm"
                    leftSection={<IconExternalLink size={16} />}
                  >
                    Åbn dagens opskriftsmappe
                  </Button>
                )}
              </Group>
            )}

            {/* Per-dish: open the parsed recipe in-app (ingredients +
                Fremgangsmåde) so cooks don't need an Excel viewer. */}
            {recipes.length > 0 && (
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Dagens opskrifter
                </Text>
                <Group gap="xs">
                  {recipes.map((r) => (
                    <Button
                      key={`${r.code}-${r.index}`}
                      variant="white"
                      color="green"
                      size="xs"
                      leftSection={<IconBook2 size={14} />}
                      onClick={() => setActiveRecipe(r)}
                    >
                      {r.name}
                    </Button>
                  ))}
                </Group>
              </Stack>
            )}
          </>
        )}

        <Divider />

        {/* Notify actions. Each announcement goes out once per day, so a button
            whose broadcast already fired renders as sent and disabled. */}
        <Group gap="sm">
          <Button
            color="orange"
            size="sm"
            leftSection={
              takeawaySent ? (
                <IconCheck size={16} />
              ) : (
                <IconToolsKitchen2 size={16} />
              )
            }
            loading={takeawayMutation.isPending}
            disabled={takeawayMutation.isPending || !teamId || takeawaySent}
            onClick={() => takeawayMutation.mutate()}
          >
            {takeawaySent ? "Takeaway-besked sendt" : "Takeaway er klar"}
          </Button>

          <Button
            color="green"
            variant="light"
            size="sm"
            leftSection={
              leftoversSent ? <IconCheck size={16} /> : <IconBowl size={16} />
            }
            onClick={() => setLeftoversOpen((o) => !o)}
            disabled={!teamId || leftoversSent}
          >
            {leftoversSent ? "Rester-besked sendt" : "Rester er klar"}
          </Button>
        </Group>

        <Collapse expanded={leftoversOpen && !leftoversSent}>
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Beskriv evt. resterne og tilføj et billede. Begge dele er valgfri.
            </Text>
            <Textarea
              placeholder="Hvad er der til rest? (valgfri)"
              value={leftoverMessage}
              onChange={(e) => setLeftoverMessage(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={4}
            />
            <Group gap="sm">
              <FileButton onChange={setLeftoverImage} accept="image/*">
                {(props) => (
                  <Button
                    {...props}
                    variant="default"
                    size="sm"
                    leftSection={<IconPhoto size={16} />}
                  >
                    {leftoverImage ? "Skift billede" : "Vælg billede"}
                  </Button>
                )}
              </FileButton>
              {leftoverImage && (
                <Text size="xs" c="dimmed">
                  {leftoverImage.name}
                </Text>
              )}
            </Group>
            <Group gap="sm">
              <Button
                color="green"
                size="sm"
                leftSection={<IconToolsKitchen size={16} />}
                loading={leftoversMutation.isPending}
                disabled={leftoversMutation.isPending}
                onClick={() => leftoversMutation.mutate()}
              >
                Send rester-besked
              </Button>
              <Button
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => {
                  setLeftoversOpen(false)
                  setLeftoverImage(null)
                  setLeftoverMessage("")
                }}
              >
                Annuller
              </Button>
            </Group>
          </Stack>
        </Collapse>

        {/* Eating-count summary */}
        {buckets.length > 0 && totalWeighted > 0 && (
          <>
            <Divider />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Tilmeldinger i dag
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                {buckets.map((b) => {
                  const people = b.count.adults + b.count.children
                  const pct = Math.round(
                    (weightedCount(b.count) / totalWeighted) * 100,
                  )

                  return (
                    <Paper
                      key={b.label}
                      withBorder
                      p="xs"
                      radius="sm"
                      bg="var(--mantine-color-body)"
                    >
                      <Text size="xs" c="dimmed" fw={500}>
                        {b.label}
                      </Text>
                      <Text size="sm">
                        {people} personer ({pct}%)
                      </Text>
                      {b.count.children > 0 && (
                        <Text size="xs" c="dimmed">
                          heraf {b.count.children} børn
                        </Text>
                      )}
                    </Paper>
                  )
                })}
              </SimpleGrid>
            </Stack>
          </>
        )}
      </Stack>

      <RecipeDrawer
        recipe={activeRecipe}
        opened={!!activeRecipe}
        onClose={() => setActiveRecipe(null)}
      />

      <FrontPageDrawer
        frontPage={frontPage}
        opened={frontPageOpen}
        onClose={() => setFrontPageOpen(false)}
      />
    </Paper>
  )
}
