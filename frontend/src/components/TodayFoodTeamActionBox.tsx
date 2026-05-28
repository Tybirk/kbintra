import { useState } from "react"

import { useQuery, useMutation } from "@tanstack/react-query"

import {
  Paper,
  Group,
  Stack,
  Title,
  Text,
  Textarea,
  Avatar,
  Button,
  Anchor,
  ThemeIcon,
  Collapse,
  FileButton,
  Divider,
  SimpleGrid,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import {
  IconChefHat,
  IconExternalLink,
  IconToolsKitchen2,
  IconToolsKitchen,
  IconBowl,
  IconPhoto,
} from "@tabler/icons-react"

import { foodApi } from "../api/food"

import { showErrorNotification } from "../utils/errorNotification"

import type { RegistrationCount } from "../types"

interface ServingBucket {
  label: string
  count: RegistrationCount
}

// Weighted headcount: children count as half a person.
function weightedCount(count: RegistrationCount): number {
  return count.adults + 0.5 * count.children
}

export default function TodayFoodTeamActionBox() {
  const { data } = useQuery({
    queryKey: ["today-food-team"],
    queryFn: foodApi.getTodayActionBox,
  })

  const [leftoversOpen, setLeftoversOpen] = useState(false)

  const [leftoverImage, setLeftoverImage] = useState<File | null>(null)

  const [leftoverMessage, setLeftoverMessage] = useState("")

  const teamId = data?.team_id

  const { data: stats } = useQuery({
    queryKey: ["food", "daily-stats", data?.date],
    queryFn: () => foodApi.getDailyStats(data!.date as string),
    enabled: !!data?.on_team && !!data?.date,
  })

  const takeawayMutation = useMutation({
    mutationFn: () => foodApi.notifyTakeaway(teamId as number),

    onSuccess: (res) => {
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

  const recipes = [...(data.recipes ?? [])].sort((a, b) => a.index - b.index)

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

        {/* Recipe folder link */}
        {data.recipe_folder_url && (
          <div>
            <Button
              component="a"
              href={data.recipe_folder_url}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              color="green"
              size="sm"
              leftSection={<IconExternalLink size={16} />}
            >
              Åbn dagens opskriftsmappe
            </Button>
          </div>
        )}

        {/* Individual recipe links */}
        {recipes.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Dagens opskrifter
            </Text>
            <Group gap="xs">
              {recipes.map((r) => (
                <Anchor
                  key={`${r.code}-${r.index}`}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  <Group gap={4} wrap="nowrap">
                    <IconExternalLink size={14} />
                    {r.name}
                  </Group>
                </Anchor>
              ))}
            </Group>
          </Stack>
        )}

        <Divider />

        {/* Notify actions */}
        <Group gap="sm">
          <Button
            color="orange"
            size="sm"
            leftSection={<IconToolsKitchen2 size={16} />}
            loading={takeawayMutation.isPending}
            disabled={takeawayMutation.isPending || !teamId}
            onClick={() => takeawayMutation.mutate()}
          >
            Takeaway er klar
          </Button>

          <Button
            color="green"
            variant="light"
            size="sm"
            leftSection={<IconBowl size={16} />}
            onClick={() => setLeftoversOpen((o) => !o)}
            disabled={!teamId}
          >
            Rester er klar
          </Button>
        </Group>

        <Collapse expanded={leftoversOpen}>
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
    </Paper>
  )
}
