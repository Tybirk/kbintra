import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title,
  Text,
  SimpleGrid,
  Paper,
  Group,
  Badge,
  TextInput,
  Loader,
  Center,
  ActionIcon,
  Stack,
  Box,
  ThemeIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSearch,
  IconMessageCircle,
  IconBell,
  IconBellOff,
  IconUsers,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import { forumApi } from '../api/forum';
import type { Subgroup } from '../types';

export default function ForumPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: subgroups, isLoading, error } = useQuery({
    queryKey: ['subgroups'],
    queryFn: forumApi.getSubgroups,
  });

  const subscribeMutation = useMutation({
    mutationFn: forumApi.subscribe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subgroups'] });
      notifications.show({
        title: 'Tilmeldt',
        message: 'Du modtager nu opdateringer fra denne gruppe.',
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke tilmelde. Prøv venligst igen.',
        color: 'red',
      });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: forumApi.unsubscribe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subgroups'] });
      notifications.show({
        title: 'Afmeldt',
        message: 'Du modtager ikke længere opdateringer fra denne gruppe.',
        color: 'blue',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Fejl',
        message: 'Kunne ikke afmelde. Prøv venligst igen.',
        color: 'red',
      });
    },
  });

  // Split subgroups into committees and regular groups
  const { committees, regularGroups } = useMemo(() => {
    const filtered = subgroups?.filter((subgroup) =>
      subgroup.name.toLowerCase().includes(search.toLowerCase())
    ) || [];

    return {
      committees: filtered.filter((s) => s.is_committee),
      regularGroups: filtered.filter((s) => !s.is_committee),
    };
  }, [subgroups, search]);

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
        <Text c="red">Kunne ikke indlæse forum. Prøv venligst igen.</Text>
      </Center>
    );
  }

  const renderSubgroupCard = (subgroup: Subgroup) => (
    <SubgroupCard
      key={subgroup.id}
      subgroup={subgroup}
      onClick={() => navigate(`/forum/${subgroup.slug}`)}
      onSubscribe={() => subscribeMutation.mutate(subgroup.slug)}
      onUnsubscribe={() => unsubscribeMutation.mutate(subgroup.slug)}
      isSubscribing={subscribeMutation.isPending}
      isUnsubscribing={unsubscribeMutation.isPending}
    />
  );

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Forum</Title>
          <Text c="dimmed">Gennemse og deltag i fællesskabets grupper</Text>
        </div>
      </Group>

      <TextInput
        placeholder="Søg i grupper..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="lg"
        style={{ maxWidth: 300 }}
      />

      {committees.length === 0 && regularGroups.length === 0 ? (
        <Text c="dimmed">Ingen grupper fundet.</Text>
      ) : (
        <Stack gap="xl">
          {/* Committees Section */}
          {committees.length > 0 && (
            <Box
              p="lg"
              style={(theme) => ({
                backgroundColor: theme.colors.teal[0],
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.colors.teal[2]}`,
              })}
            >
              <Group gap="sm" mb="lg">
                <ThemeIcon size="lg" radius="md" variant="filled" color="teal">
                  <IconUsers size={20} />
                </ThemeIcon>
                <div>
                  <Title order={3}>Udvalg</Title>
                  <Text size="sm" c="dimmed">Fællesskabets udvalg og arbejdsgrupper</Text>
                </div>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
                {committees.map(renderSubgroupCard)}
              </SimpleGrid>
            </Box>
          )}

          {/* Regular Groups Section */}
          {regularGroups.length > 0 && (
            <Box>
              <Group gap="sm" mb="lg">
                <ThemeIcon size="lg" radius="md" variant="light" color="blue">
                  <IconMessageCircle size={20} />
                </ThemeIcon>
                <div>
                  <Title order={3}>Grupper</Title>
                  <Text size="sm" c="dimmed">Øvrige fora og diskussionsgrupper</Text>
                </div>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
                {regularGroups.map(renderSubgroupCard)}
              </SimpleGrid>
            </Box>
          )}
        </Stack>
      )}
    </>
  );
}

interface SubgroupCardProps {
  subgroup: Subgroup;
  onClick: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  isSubscribing: boolean;
  isUnsubscribing: boolean;
}

function SubgroupCard({
  subgroup,
  onClick,
  onSubscribe,
  onUnsubscribe,
  isSubscribing,
  isUnsubscribing,
}: SubgroupCardProps) {
  const handleSubscriptionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (subgroup.is_subscribed) {
      onUnsubscribe();
    } else {
      onSubscribe();
    }
  };

  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <IconMessageCircle size={20} />
            <Text fw={500}>{subgroup.name}</Text>
          </Group>
          <Group gap="xs">
            {subgroup.is_committee && (
              <Badge size="xs" variant="filled" color="teal">
                Udvalg
              </Badge>
            )}
            {subgroup.is_default && !subgroup.is_committee && (
              <Badge size="xs" variant="light" color="gray">
                Standard
              </Badge>
            )}
            <ActionIcon
              variant={subgroup.is_subscribed ? 'filled' : 'light'}
              color={subgroup.is_subscribed ? 'blue' : 'gray'}
              onClick={handleSubscriptionClick}
              loading={isSubscribing || isUnsubscribing}
              title={subgroup.is_subscribed ? 'Afmeld' : 'Tilmeld'}
            >
              {subgroup.is_subscribed ? (
                <IconBell size={16} />
              ) : (
                <IconBellOff size={16} />
              )}
            </ActionIcon>
          </Group>
        </Group>

        {subgroup.description && (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {subgroup.description}
          </Text>
        )}

        <Group gap="xs">
          <Badge variant="light" color="blue">
            {subgroup.thread_count} tråde
          </Badge>
          {subgroup.is_subscribed && (
            <Badge variant="outline" color="green">
              Tilmeldt
            </Badge>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
