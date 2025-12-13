import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
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
  SimpleGrid,
  Breadcrumbs,
  Anchor,
} from '@mantine/core';
import { IconArrowLeft, IconHome } from '@tabler/icons-react';

import { housesApi } from '../api/houses';
import type { UserSummary } from '../types';

export default function HouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: house, isLoading, error } = useQuery({
    queryKey: ['house', id],
    queryFn: () => housesApi.getHouse(Number(id)),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error || !house) {
    return (
      <Center h={200}>
        <Stack align="center">
          <Text c="red">Failed to load house details.</Text>
          <Button variant="light" onClick={() => navigate('/directory')}>
            Back to Directory
          </Button>
        </Stack>
      </Center>
    );
  }

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor onClick={() => navigate('/directory')}>Directory</Anchor>
        <Text>{house.name}</Text>
      </Breadcrumbs>

      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate('/directory')}
        mb="md"
      >
        Back to Directory
      </Button>

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
            <Title order={2}>House {house.name}</Title>
            {house.address && (
              <Text c="dimmed" size="sm">
                {house.address}
              </Text>
            )}
          </div>
        </Group>

        {house.description && (
          <Text mb="md">{house.description}</Text>
        )}
      </Paper>

      <Title order={3} mb="md">
        Residents ({house.inhabitants?.length || 0})
      </Title>

      {house.inhabitants && house.inhabitants.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {house.inhabitants.map((inhabitant) => (
            <InhabitantCard
              key={inhabitant.id}
              inhabitant={inhabitant}
              onClick={() => navigate(`/profile/${inhabitant.id}`)}
            />
          ))}
        </SimpleGrid>
      ) : (
        <Text c="dimmed">No residents registered for this house.</Text>
      )}
    </>
  );
}

interface InhabitantCardProps {
  inhabitant: UserSummary;
  onClick: () => void;
}

function InhabitantCard({ inhabitant, onClick }: InhabitantCardProps) {
  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Group>
        <Avatar
          src={inhabitant.profile_picture}
          size="lg"
          radius="xl"
        >
          {inhabitant.first_name?.[0]}
          {inhabitant.last_name?.[0]}
        </Avatar>
        <div style={{ flex: 1 }}>
          <Text fw={500}>
            {inhabitant.first_name} {inhabitant.last_name}
          </Text>
          {inhabitant.bio && (
            <Text size="sm" c="dimmed" lineClamp={2}>
              {inhabitant.bio}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}
