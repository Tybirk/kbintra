import { useQuery } from "@tanstack/react-query"

import { useParams, useNavigate } from "react-router-dom"

import {
  Title,
  Text,
  Paper,
  Box,
  Group,
  Avatar,
  Button,
  ActionIcon,
  Tooltip,
  Loader,
  Center,
  Stack,
  SimpleGrid,
  Breadcrumbs,
  Anchor,
  Badge,
} from "@mantine/core"

import {
  IconHome,
  IconCar,
  IconPhone,
  IconMail,
  IconPencil,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { housesApi } from "../api/houses"

import { BackButton } from "../components/BackButton"

import { useAuthStore } from "../store/authStore"

import type { Car, Child, UserSummary } from "../types"

import { formatLicensePlate } from "../utils/licensePlate"

export default function HouseDetailPage() {
  const { slug } = useParams<{ slug: string }>()

  const navigate = useNavigate()

  const currentUser = useAuthStore((s) => s.user)

  const {
    data: house,

    isLoading,

    error,
  } = useQuery({
    queryKey: ["house", slug],

    queryFn: () => housesApi.getHouse(slug!),

    enabled: !!slug,
  })

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !house) {
    return (
      <Center h={200}>
        <Stack align="center">
          <Text c="red">Failed to load house details.</Text>
          <Button variant="light" onClick={() => navigate("/beboere")}>
            Tilbage til beboeroversigt
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor onClick={() => navigate("/beboere")}>Beboeroversigt</Anchor>
        <Text>{house.name}</Text>
      </Breadcrumbs>

      <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <BackButton to="/beboere" label="Tilbage til beboeroversigt" />
        </Box>
        {currentUser?.house === house.id && (
          <Tooltip label="Rediger hus">
            <ActionIcon
              variant="light"
              size="lg"
              onClick={() => navigate("/hus/rediger")}
              aria-label="Rediger hus"
              style={{ flexShrink: 0 }}
            >
              <IconPencil size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Group gap="md" mb="md">
          <Avatar
            src={house.profile_picture}
            size={80}
            radius="md"
            color="blue"
          >
            <IconHome size={40} />
          </Avatar>
          <div>
            <Title order={2}>{house.name}</Title>
            {house.address && (
              <Text c="dimmed" size="sm">
                {house.address}
              </Text>
            )}
          </div>
        </Group>

        {house.description && (
          <Text mb="md" style={{ whiteSpace: "pre-wrap" }}>
            {house.description}
          </Text>
        )}
      </Paper>

      <Title order={3} mb="md">
        Beboere ({house.inhabitants?.length || 0})
      </Title>

      {house.inhabitants && house.inhabitants.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {house.inhabitants.map((inhabitant) => (
            <InhabitantCard
              key={inhabitant.id}
              inhabitant={inhabitant}
              onClick={() => navigate(`/profil/${inhabitant.id}`)}
            />
          ))}
        </SimpleGrid>
      ) : (
        <Text c="dimmed">Ingen beboere registreret for dette hus.</Text>
      )}

      {house.children && house.children.length > 0 && (
        <>
          <Title order={3} mt="xl" mb="md">
            Børn ({house.children.length})
          </Title>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {house.children.map((child) => (
              <ChildCard key={child.id} child={child} />
            ))}
          </SimpleGrid>
        </>
      )}

      {house.cars && house.cars.length > 0 && (
        <>
          <Title order={3} mt="xl" mb="md">
            Biler ({house.cars.length})
          </Title>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {house.cars.map((car) => (
              <CarCard key={car.id} car={car} />
            ))}
          </SimpleGrid>
        </>
      )}
    </>
  )
}

interface InhabitantCardProps {
  inhabitant: UserSummary

  onClick: () => void
}

function InhabitantCard({ inhabitant, onClick }: InhabitantCardProps) {
  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <Group>
        <Avatar src={inhabitant.profile_picture} size="lg" radius="xl">
          {inhabitant.first_name?.[0]}
          {inhabitant.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1 }}>
          <Text fw={500}>
            {inhabitant.first_name} {inhabitant.last_name}
          </Text>
          {inhabitant.phone_number && (
            <Group gap={4}>
              <IconPhone
                size={14}
                style={{ color: "var(--mantine-color-dimmed)" }}
              />
              <Text size="sm" c="dimmed">
                {inhabitant.phone_number}
              </Text>
            </Group>
          )}
          {inhabitant.email && (
            <Group gap={4}>
              <IconMail
                size={14}
                style={{ color: "var(--mantine-color-dimmed)" }}
              />
              <Text size="sm" c="dimmed">
                {inhabitant.email}
              </Text>
            </Group>
          )}
        </div>
      </Group>
    </Paper>
  )
}

interface ChildCardProps {
  child: Child
}

function ChildCard({ child }: ChildCardProps) {
  const getAge = (birthdate: string | null) => {
    if (!birthdate) return null

    const years = dayjs().diff(dayjs(birthdate), "year")

    return years
  }

  const age = getAge(child.birthdate)

  return (
    <Paper withBorder p="lg" radius="md">
      <Group>
        <Avatar src={child.profile_picture} size="lg" radius="xl" color="grape">
          {child.name?.[0]}
        </Avatar>
        <div style={{ flex: 1 }}>
          <Group gap="xs">
            <Text fw={500}>{child.name}</Text>
            <Badge size="sm" variant="light" color="grape">
              Barn
            </Badge>
          </Group>
          {age !== null && (
            <Text size="sm" c="dimmed">
              {age} {age === 1 ? "år" : "år"}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  )
}

interface CarCardProps {
  car: Car
}

function CarCard({ car }: CarCardProps) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Group>
        <Avatar size="lg" radius="xl" color="blue">
          <IconCar size={24} />
        </Avatar>
        <div style={{ flex: 1 }}>
          <Group gap="xs">
            {car.license_plate ? (
              <Text fw={500}>{formatLicensePlate(car.license_plate)}</Text>
            ) : (
              <Text fw={500} c="dimmed" fs="italic">
                (ingen nummerplade)
              </Text>
            )}
            {car.is_electric && (
              <Badge size="sm" variant="light" color="green">
                Elbil
              </Badge>
            )}
          </Group>
        </div>
      </Group>
    </Paper>
  )
}
