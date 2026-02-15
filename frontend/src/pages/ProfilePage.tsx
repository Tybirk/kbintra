import { useQuery } from "@tanstack/react-query"
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
  useMantineColorScheme,
} from "@mantine/core"
import {
  IconPhone,
  IconMail,
  IconCake,
  IconHome,
  IconEdit,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { usersApi } from "../api/users"
import { useAuthStore } from "../store/authStore"

function ThemeSettings() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()

  return (
    <Paper withBorder p="xl" radius="md" mt="xl">
      <Title order={4} mb="md">
        Indstillinger
      </Title>
      <Text size="sm" mb="xs">
        Udseende
      </Text>
      <SegmentedControl
        value={colorScheme}
        onChange={(value) => setColorScheme(value as "light" | "dark" | "auto")}
        data={[
          { label: "Lys", value: "light" },
          { label: "Mørk", value: "dark" },
          { label: "Auto", value: "auto" },
        ]}
      />
    </Paper>
  )
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()

  // If no userId, show current user's profile
  const isOwnProfile = !userId || Number(userId) === currentUser?.id

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
          <Text c="red">Failed to load profile.</Text>
          <Button variant="light" onClick={() => navigate("/")}>
            Go to Dashboard
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

          {isOwnProfile && (
            <Button
              variant="light"
              leftSection={<IconEdit size={16} />}
              onClick={() => navigate("/profil/rediger")}
            >
              Edit Profile
            </Button>
          )}
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Title order={4} mb="md">
          About
        </Title>
        {user.bio ? (
          <Text>{user.bio}</Text>
        ) : (
          <Text c="dimmed" fs="italic">
            No bio added yet.
          </Text>
        )}
      </Paper>

      <Paper withBorder p="xl" radius="md">
        <Title order={4} mb="md">
          Contact Information
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
              <Text>{dayjs(user.birthdate).format("MMMM D")}</Text>
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
