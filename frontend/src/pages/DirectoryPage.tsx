import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
} from '@mantine/core';
import { IconSearch, IconHome } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import { housesApi } from '../api/houses';
import type { House } from '../types';

export default function DirectoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['houses'],
    queryFn: housesApi.getHouses,
  });

  const filteredHouses = data?.filter((house) =>
    house.name.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Failed to load houses. Please try again.</Text>
      </Center>
    );
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Directory</Title>
          <Text c="dimmed">Houses and their inhabitants</Text>
        </div>
      </Group>

      <TextInput
        placeholder="Search houses..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        mb="lg"
        style={{ maxWidth: 300 }}
      />

      {filteredHouses?.length === 0 ? (
        <Text c="dimmed">No houses found.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {filteredHouses?.map((house) => (
            <HouseCard
              key={house.id}
              house={house}
              onClick={() => navigate(`/directory/house/${house.id}`)}
            />
          ))}
        </SimpleGrid>
      )}
    </>
  );
}

interface HouseCardProps {
  house: House;
  onClick: () => void;
}

function HouseCard({ house, onClick }: HouseCardProps) {
  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: 'pointer' }}
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
          <Text fw={500}>House {house.name}</Text>
        </Group>
        <Badge variant="light">{house.inhabitant_count} residents</Badge>
      </Group>

      {house.description && (
        <Text size="sm" c="dimmed" mb="md" lineClamp={2}>
          {house.description}
        </Text>
      )}

      {house.inhabitants && house.inhabitants.length > 0 && (
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Residents:
          </Text>
          <Avatar.Group spacing="sm">
            {house.inhabitants.slice(0, 5).map((inhabitant) => (
              <Avatar
                key={inhabitant.id}
                src={inhabitant.profile_picture}
                radius="xl"
                size="md"
              >
                {inhabitant.first_name?.[0]}
                {inhabitant.last_name?.[0]}
              </Avatar>
            ))}
            {house.inhabitants.length > 5 && (
              <Avatar radius="xl" size="md">
                +{house.inhabitants.length - 5}
              </Avatar>
            )}
          </Avatar.Group>
        </Stack>
      )}
    </Paper>
  );
}
