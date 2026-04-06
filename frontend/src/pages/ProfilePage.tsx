import { useQuery, useMutation } from "@tanstack/react-query"
import { useParams, useNavigate } from "react-router-dom"
import {
  Title,
  Text,
  Paper,
  Group,
  Avatar,
  Button,
  Loader,
  Center,
  Stack,
  Badge,
  SegmentedControl,
  Switch,
  useMantineColorScheme,
} from "@mantine/core"
import {
  IconPhone,
  IconMail,
  IconCake,
  IconHome,
  IconEdit,
  IconMessage,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { usersApi } from "../api/users"
import { messagingApi } from "../api/messaging"
import { useAuthStore } from "../store/authStore"
import { useAccessibilityMode } from "../hooks/useAccessibilityMode"
import { showErrorNotification } from "../utils/errorNotification"

function ThemeSettings() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const { isAccessibilityMode, setIsAccessibilityMode, isPending } =
    useAccessibilityMode()

  return (
    <Paper withBorder p="xl" radius="md" mt="xl">
      <Title order={4} mb="md">
        Indstillinger
      </Title>
      <Stack gap="md">
        <div>
          <Text size="sm" mb="xs">
            Udseende
          </Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(value) =>
              setColorScheme(value as "light" | "dark" | "auto")
            }
            data={[
              { label: "Lys", value: "light" },
              { label: "Mørk", value: "dark" },
              { label: "Auto", value: "auto" },
            ]}
          />
        </div>
        <Switch
          label="Stor skrift og høj kontrast"
          description="Øger skriftstørrelse og kontrast"
          checked={isAccessibilityMode}
          onChange={(e) => setIsAccessibilityMode(e.currentTarget.checked)}
          disabled={isPending}
        />
      </Stack>
    </Paper>
  )
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()

  // If no userId, show current user's profile
  const isOwnProfile = !userId || Number(userId) === currentUser?.id

  const sendMessageMutation = useMutation({
    mutationFn: (participantId: number) =>
      messagingApi.createConversation({ participant_ids: [participantId] }),
    onSuccess: (conversation) => {
      navigate(`/beskeder/${conversation.id}`)
    },
    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke oprette samtale. Prøv igen.")
    },
  })

  const {
    data: user,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["user", userId || "me"],
    queryFn: () =>
      userId ? usersApi.getUser(Number(userId)) : usersApi.getCurrentUser(),
  })

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !user) {
    return (
      <Center h={200}>
        <Stack align="center">
          <Text c="red">Kunne ikke indlæse profil.</Text>
          <Button variant="light" onClick={() => navigate("/")}>
            Gå til forsiden
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <>
      <Paper withBorder p="xl" radius="md" mb="xl">
        <Group justify="space-between" align="flex-start">
          <Group>
            <Avatar src={user.profile_picture} size={120} radius={120}>
              {user.first_name?.[0]}
              {user.last_name?.[0]}
            </Avatar>
            <div>
              <Title order={2}>
                {user.first_name} {user.last_name}
              </Title>
              {user.house_name && (
                <Badge
                  variant="light"
                  leftSection={<IconHome size={12} />}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    user.house && navigate(`/beboere/hus/${user.house}`)
                  }
                >
                  {user.house_name}
                </Badge>
              )}
            </div>
          </Group>

          {isOwnProfile ? (
            <Button
              variant="light"
              leftSection={<IconEdit size={16} />}
              onClick={() => navigate("/profil/rediger")}
            >
              Rediger profil
            </Button>
          ) : (
            <Button
              variant="light"
              leftSection={<IconMessage size={16} />}
              onClick={() => sendMessageMutation.mutate(user.id)}
              loading={sendMessageMutation.isPending}
            >
              Send besked
            </Button>
          )}
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Title order={4} mb="md">
          Om
        </Title>
        {user.bio ? (
          <Text>{user.bio}</Text>
        ) : (
          <Text c="dimmed" fs="italic">
            Ingen bio tilføjet endnu.
          </Text>
        )}
      </Paper>

      <Paper withBorder p="xl" radius="md">
        <Title order={4} mb="md">
          Kontaktoplysninger
        </Title>

        <Stack gap="sm">
          <Group gap="xs">
            <IconMail size={18} />
            <Text>{user.email}</Text>
          </Group>

          {user.phone_number && (
            <Group gap="xs">
              <IconPhone size={18} />
              <Text>{user.phone_number}</Text>
            </Group>
          )}

          {user.birthdate && (
            <Group gap="xs">
              <IconCake size={18} />
              <Text>{dayjs(user.birthdate).format("D. MMMM")}</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {isOwnProfile && <ThemeSettings />}

      {isOwnProfile && (
        <Text ta="center" size="xs" c="dimmed" mt="xl">
          Version:{" "}
          {new Date(__APP_VERSION__).toLocaleString("da-DK", {
            timeZone: "Europe/Copenhagen",
          })}
        </Text>
      )}
    </>
  )
}
