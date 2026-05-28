/**
 * "Rester er klar" landing page — where notification recipients land when
 * they tap the leftovers push/in-app notification.
 */

import { useQuery } from "@tanstack/react-query"

import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Group,
  Image,
  Alert,
  Loader,
  Center,
} from "@mantine/core"

import { IconBowl } from "@tabler/icons-react"

import dayjs from "dayjs"

import { foodApi } from "../api/food"

import { BackButton } from "../components/BackButton"

export default function LeftoversPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["food", "leftovers-today"],
    queryFn: foodApi.getTodayLeftovers,
  })

  return (
    <Container size="sm" py="md">
      <BackButton to="/" label="Tilbage" />

      <Group gap="xs" mt="md" mb="lg">
        <IconBowl size={26} />
        <Title order={2}>Dagens rester</Title>
      </Group>

      {isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : isError ? (
        <Alert color="red" variant="light">
          Kunne ikke hente dagens rester.
        </Alert>
      ) : !data?.has_leftovers ? (
        <Alert color="gray" variant="light">
          Der er ikke meldt rester ud i dag.
        </Alert>
      ) : (
        <Paper withBorder p="lg" radius="md">
          <Stack gap="md">
            <div>
              <Text size="sm" c="dimmed">
                {data.day_name} {dayjs(data.date).format("D. MMMM")}
              </Text>
              <Text size="lg" fw={600}>
                Der er rester i fælleshuset
              </Text>
              {data.members && data.members.length > 0 && (
                <Text size="sm" c="dimmed">
                  Fra dagens madhold: {data.members.join(", ")}
                </Text>
              )}
              {data.announced_at && (
                <Text size="xs" c="dimmed" mt={4}>
                  Meldt ud {dayjs(data.announced_at).format("HH:mm")}
                </Text>
              )}
            </div>

            {data.message && (
              <Text style={{ whiteSpace: "pre-wrap" }}>{data.message}</Text>
            )}

            {data.image_url && (
              <Image
                src={data.image_url}
                alt="Rester"
                radius="md"
                fit="contain"
              />
            )}
          </Stack>
        </Paper>
      )}
    </Container>
  )
}
