import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Title,
  Text,
  SimpleGrid,
  Paper,
  Group,
  Avatar,
  Badge,
  TextInput,
  Loader,
  Center,
  Stack,
} from "@mantine/core"
import { IconSearch, IconHome } from "@tabler/icons-react"
import { useNavigate } from "react-router-dom"

import { housesApi } from "../api/houses"
import type { Child, House, UserSummary } from "../types"

export default function DirectoryPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["houses"],
    queryFn: housesApi.getHouses,
  })

  const filteredHouses = data?.filter((house) => {
    const searchLower = search.toLowerCase()
    // Search by house name
    if (house.name.toLowerCase().includes(searchLower)) return true
    // Search by inhabitant names
    if (
      house.inhabitants?.some((i) =>
        `${i.first_name} ${i.last_name}`.toLowerCase().includes(searchLower),
      )
    )
      return true
    // Search by children names
    if (house.children?.some((c) => c.name.toLowerCase().includes(searchLower)))
      return true
    return false
  })

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Failed to load houses. Please try again.</Text>
      </Center>
    )
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Beboeroversigt</Title>
          <Text c="dimmed">Huse og beboere</Text>
        </div>
        {data && (
          <Text size="sm" c="dimmed">
            {data.reduce((sum, h) => sum + (h.inhabitants?.length || 0), 0)}{" "}
            voksne,{" "}
            {data.reduce((sum, h) => sum + (h.children?.length || 0), 0)} børn
          </Text>
        )}
      </Group>

      <TextInput
        placeholder="Søg efter hus eller beboer..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        mb="lg"
        style={{ maxWidth: 400 }}
      />

      {filteredHouses?.length === 0 ? (
        <Text c="dimmed">No houses found.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {filteredHouses?.map((house) => (
            <HouseCard
              key={house.id}
              house={house}
              onClick={() => navigate(`/beboere/hus/${house.id}`)}
            />
          ))}
        </SimpleGrid>
      )}
    </>
  )
}

interface HouseCardProps {
  house: House
  onClick: () => void
}

function HouseCard({ house, onClick }: HouseCardProps) {
  const totalResidents =
    (house.inhabitants?.length || 0) + (house.children?.length || 0)

  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="sm">
          <Avatar
            src={house.profile_picture}
            radius="md"
            size="md"
            color="blue"
          >
            <IconHome size={20} />
          </Avatar>
          <Text fw={500}>Hus {house.name}</Text>
        </Group>
        <Badge variant="light">{totalResidents} beboere</Badge>
      </Group>

      {house.description && (
        <Text size="sm" c="dimmed" mb="md" lineClamp={2}>
          {house.description}
        </Text>
      )}

      <Stack gap={4}>
        {house.inhabitants?.map((inhabitant) => (
          <ResidentRow key={`user-${inhabitant.id}`} inhabitant={inhabitant} />
        ))}
        {house.children?.map((child) => (
          <ChildRow key={`child-${child.id}`} child={child} />
        ))}
        {totalResidents === 0 && (
          <Text size="sm" c="dimmed" fs="italic">
            Ingen beboere registreret
          </Text>
        )}
      </Stack>
    </Paper>
  )
}

interface ResidentRowProps {
  inhabitant: UserSummary
}

function ResidentRow({ inhabitant }: ResidentRowProps) {
  return (
    <Group gap="xs">
      <Avatar src={inhabitant.profile_picture} radius="xl" size="sm">
        {inhabitant.first_name?.[0]}
        {inhabitant.last_name?.[0]}
      </Avatar>
      <Text size="sm">
        {inhabitant.first_name} {inhabitant.last_name}
      </Text>
    </Group>
  )
}

interface ChildRowProps {
  child: Child
}

function ChildRow({ child }: ChildRowProps) {
  return (
    <Group gap="xs">
      <Avatar radius="xl" size="sm" color="grape">
        {child.name?.[0]}
      </Avatar>
      <Group gap={4}>
        <Text size="sm">{child.name}</Text>
        <Badge size="xs" variant="light" color="grape">
          Barn
        </Badge>
      </Group>
    </Group>
  )
}
