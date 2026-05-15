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
  Popover,
} from "@mantine/core"

import { IconSearch, IconHome } from "@tabler/icons-react"

import { Link } from "react-router-dom"

import { housesApi } from "../api/houses"

import UserLink from "../components/UserLink"

import type { Child, House, UserSummary } from "../types"

export default function DirectoryPage() {
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
        <Text c="red">Kunne ikke indlæse huse. Prøv igen.</Text>
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
        {data && <StatsSummary houses={data} />}
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
        <Text c="dimmed">Ingen huse fundet.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {filteredHouses?.map((house) => (
            <HouseCard
              key={house.id}
              house={house}
              to={`/beboere/hus/${house.slug}`}
            />
          ))}
        </SimpleGrid>
      )}
    </>
  )
}

interface StatsSummaryProps {
  houses: House[]
}

interface AgeBand {
  label: string
  min: number
  max: number
}

function StatsSummary({ houses }: StatsSummaryProps) {
  const [opened, setOpened] = useState(false)

  const now = Date.now()
  const yearMs = 365.25 * 24 * 60 * 60 * 1000
  const ageYears = (birthdate: string | null): number | null => {
    if (!birthdate) return null
    const t = Date.parse(birthdate)
    return Number.isNaN(t) ? null : (now - t) / yearMs
  }
  // In Denmark you're legally an adult at 18. Some "children" records may
  // be 18+ (older kids tracked alongside the household), so we reclassify
  // them as voksne for the headline counts.
  const inhabitants = houses.reduce(
    (sum, h) => sum + (h.inhabitants?.length || 0),
    0,
  )
  const adultChildren = houses.reduce(
    (sum, h) =>
      sum +
      (h.children?.filter((c) => {
        const age = ageYears(c.birthdate)
        return age !== null && age >= 18
      }).length || 0),
    0,
  )
  const totalChildren = houses.reduce(
    (sum, h) => sum + (h.children?.length || 0),
    0,
  )
  const adults = inhabitants + adultChildren
  const kids = totalChildren - adultChildren
  const people = adults + kids
  const cars = houses.reduce((sum, h) => sum + (h.cars?.length || 0), 0)
  const electricCars = houses.reduce(
    (sum, h) => sum + (h.cars?.filter((c) => c.is_electric).length || 0),
    0,
  )

  const ageBands: AgeBand[] = [
    { label: "0–1 år", min: 0, max: 2 },
    { label: "2–5 år", min: 2, max: 6 },
    { label: "6–12 år", min: 6, max: 13 },
    { label: "13–17 år", min: 13, max: 18 },
  ]
  const bandCounts = ageBands.map((b) => ({
    label: b.label,
    count: houses.reduce(
      (sum, h) =>
        sum +
        (h.children?.filter((c) => {
          const age = ageYears(c.birthdate)
          return age !== null && age >= b.min && age < b.max
        }).length || 0),
      0,
    ),
  }))
  // Whatever's left after the age bands: children with no birthdate, with an
  // unparseable date string, or with an out-of-range age. Defined as a
  // remainder so the breakdown always sums to `kids`.
  const kidsUncategorized =
    kids - bandCounts.reduce((sum, b) => sum + b.count, 0)

  const pct = (n: number, total: number) =>
    total > 0 ? Math.round((n / total) * 100) : 0

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Text
          size="sm"
          c="dimmed"
          onClick={() => setOpened((o) => !o)}
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          style={{
            cursor: "pointer",
            userSelect: "none",
            textDecoration: "underline dashed",
            textUnderlineOffset: "3px",
          }}
        >
          {adults} voksne, {kids} børn
        </Text>
      </Popover.Target>
      <Popover.Dropdown
        onMouseEnter={() => setOpened(true)}
        onMouseLeave={() => setOpened(false)}
      >
        <Stack gap={6}>
          <Text size="md" fw={500}>
            Statistik
          </Text>
          <Text size="sm" c="dimmed">
            {people} beboere
          </Text>
          <Text size="sm" c="dimmed">
            {adults} voksne ({pct(adults, people)}%)
          </Text>
          <Text size="sm" c="dimmed">
            {kids} børn ({pct(kids, people)}%)
          </Text>
          {bandCounts
            .filter((b) => b.count > 0)
            .map((b) => (
              <Group key={b.label} gap="xs" justify="space-between" pl="md">
                <Text size="sm" c="dimmed">
                  {b.label}
                </Text>
                <Text size="sm" c="dimmed">
                  {b.count}
                </Text>
              </Group>
            ))}
          {kidsUncategorized > 0 && (
            <Group gap="xs" justify="space-between" pl="md">
              <Text size="sm" c="dimmed" fs="italic">
                uden fødselsdag
              </Text>
              <Text size="sm" c="dimmed">
                {kidsUncategorized}
              </Text>
            </Group>
          )}
          {cars > 0 && (
            <>
              <Text size="sm" c="dimmed" mt={4}>
                {cars} {cars === 1 ? "bil" : "biler"}
              </Text>
              {electricCars > 0 && (
                <Text size="sm" c="dimmed" pl="md">
                  {electricCars} {electricCars === 1 ? "elbil" : "elbiler"} (
                  {pct(electricCars, cars)}%)
                </Text>
              )}
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

interface HouseCardProps {
  house: House

  to: string
}

function HouseCard({ house, to }: HouseCardProps) {
  const totalResidents =
    (house.inhabitants?.length || 0) + (house.children?.length || 0)

  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: "pointer", position: "relative" }}
    >
      <Link
        to={to}
        aria-label={house.name}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          borderRadius: "inherit",
        }}
      />
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
          <Text fw={500}>{house.name}</Text>
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
      <UserLink
        id={inhabitant.id}
        firstName={inhabitant.first_name}
        lastName={inhabitant.last_name}
        size="sm"
        style={{ position: "relative", zIndex: 2 }}
      />
    </Group>
  )
}

interface ChildRowProps {
  child: Child
}

function ChildRow({ child }: ChildRowProps) {
  return (
    <Group gap="xs">
      <Avatar src={child.profile_picture} radius="xl" size="sm" color="grape">
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
