import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  SimpleGrid,
  Paper,
  Group,
  Button,
  TextInput,
  Loader,
  Center,
  ActionIcon,
  Stack,
  Box,
  ThemeIcon,
  Modal,
  Typography,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconSearch,
  IconBell,
  IconBellOff,
  IconUsers,
  IconChecks,
  IconPlus,
  IconMessageCircle,
} from "@tabler/icons-react"
import { useNavigate } from "react-router-dom"
import dayjs from "dayjs"

import { forumApi } from "../api/forum"
import RichTextEditor from "../components/RichTextEditor"
import type { Subgroup } from "../types"

export default function ForumPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  const {
    data: subgroups,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["subgroups"],
    queryFn: forumApi.getSubgroups,
  })

  const subscribeMutation = useMutation({
    mutationFn: forumApi.subscribe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      notifications.show({
        title: "Tilmeldt",
        message: "Du modtager nu opdateringer fra denne gruppe.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke tilmelde. Prøv venligst igen.",
        color: "red",
      })
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: forumApi.unsubscribe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      notifications.show({
        title: "Afmeldt",
        message: "Du modtager ikke længere opdateringer fra denne gruppe.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke afmelde. Prøv venligst igen.",
        color: "red",
      })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: forumApi.markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      queryClient.invalidateQueries({ queryKey: ["forum", "unread-count"] })
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      })
    },
  })

  const createSubgroupMutation = useMutation({
    mutationFn: forumApi.createSubgroup,
    onSuccess: (subgroup) => {
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      notifications.show({
        title: "Gruppe oprettet",
        message: `"${subgroup.name}" er nu oprettet.`,
        color: "green",
      })
      setNewName("")
      setNewDescription("")
      closeCreate()
      navigate(`/forum/${subgroup.slug}`)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette gruppen. Prøv venligst igen.",
        color: "red",
      })
    },
  })

  const totalUnread = useMemo(
    () => subgroups?.reduce((sum, s) => sum + s.unread_thread_count, 0) ?? 0,
    [subgroups],
  )

  // Split subgroups: subscribed groups first, then remaining committees and regular groups
  const { subscribedGroups, committees, regularGroups } = useMemo(() => {
    const filtered =
      subgroups?.filter((subgroup) =>
        subgroup.name.toLowerCase().includes(search.toLowerCase()),
      ) || []

    const byActivity = (a: Subgroup, b: Subgroup) => {
      const aTime = a.last_activity_at
        ? new Date(a.last_activity_at).getTime()
        : 0
      const bTime = b.last_activity_at
        ? new Date(b.last_activity_at).getTime()
        : 0
      return bTime - aTime
    }

    const subscribed = filtered.filter((s) => s.is_subscribed).sort(byActivity)
    const subscribedIds = new Set(subscribed.map((s) => s.id))

    return {
      subscribedGroups: subscribed,
      committees: filtered.filter(
        (s) => s.is_committee && !subscribedIds.has(s.id),
      ),
      regularGroups: filtered.filter(
        (s) => !s.is_committee && !subscribedIds.has(s.id),
      ),
    }
  }, [subgroups, search])

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
        <Text c="red">Kunne ikke indlæse forum. Prøv venligst igen.</Text>
      </Center>
    )
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
  )

  return (
    <>
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Opret ny gruppe"
      >
        <Stack>
          <TextInput
            label="Navn"
            placeholder="Gruppenavn"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            required
          />
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Beskrivelse
            </Text>
            <RichTextEditor
              content={newDescription}
              onChange={setNewDescription}
              placeholder="Kort beskrivelse af gruppen (valgfrit)"
              minHeight={100}
            />
          </Box>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeCreate}>
              Annuller
            </Button>
            <Button
              onClick={() =>
                createSubgroupMutation.mutate({
                  name: newName,
                  description: newDescription,
                })
              }
              loading={createSubgroupMutation.isPending}
              disabled={!newName.trim()}
            >
              Opret gruppe
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Forum</Title>
          <Text c="dimmed">Gennemse og deltag i fællesskabets grupper</Text>
        </div>
        <Group>
          {totalUnread > 0 && (
            <Button
              variant="light"
              leftSection={<IconChecks size={16} />}
              onClick={() => markAllReadMutation.mutate()}
              loading={markAllReadMutation.isPending}
            >
              Markér alt som læst
            </Button>
          )}
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Opret gruppe
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Søg i grupper..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="lg"
        style={{ maxWidth: 300 }}
      />

      {subscribedGroups.length === 0 &&
      committees.length === 0 &&
      regularGroups.length === 0 ? (
        <Text c="dimmed">Ingen grupper fundet.</Text>
      ) : (
        <Stack gap="xl">
          {/* Subscribed Groups Section */}
          {subscribedGroups.length > 0 && (
            <Box>
              <Group gap="sm" mb="lg">
                <ThemeIcon size="lg" radius="md" variant="filled" color="blue">
                  <IconBell size={20} />
                </ThemeIcon>
                <div>
                  <Title order={3}>Mine grupper</Title>
                  <Text size="sm" c="dimmed">
                    Grupper du er tilmeldt
                  </Text>
                </div>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
                {subscribedGroups.map(renderSubgroupCard)}
              </SimpleGrid>
            </Box>
          )}

          {/* Committees Section */}
          {committees.length > 0 && (
            <Box p="lg">
              <Group gap="sm" mb="lg">
                <ThemeIcon size="lg" radius="md" variant="filled" color="teal">
                  <IconUsers size={20} />
                </ThemeIcon>
                <div>
                  <Title order={3}>Udvalg</Title>
                  <Text size="sm" c="dimmed">
                    Fællesskabets udvalg og arbejdsgrupper
                  </Text>
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
                  <Text size="sm" c="dimmed">
                    Øvrige fora og diskussionsgrupper
                  </Text>
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
  )
}

interface SubgroupCardProps {
  subgroup: Subgroup
  onClick: () => void
  onSubscribe: () => void
  onUnsubscribe: () => void
  isSubscribing: boolean
  isUnsubscribing: boolean
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
    e.stopPropagation()
    if (subgroup.is_subscribed) {
      onUnsubscribe()
    } else {
      onSubscribe()
    }
  }

  return (
    <Paper
      withBorder
      p="lg"
      radius="md"
      style={{ cursor: "pointer", position: "relative", overflow: "visible" }}
      onClick={onClick}
    >
      {subgroup.unread_thread_count > 0 && (
        <Box
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            background: "var(--mantine-color-red-filled)",
            color: "white",
            borderRadius: 10,
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            zIndex: 1,
          }}
        >
          {subgroup.unread_thread_count}
        </Box>
      )}
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            {subgroup.icon && (
              <Text size="lg" lh={1}>
                {subgroup.icon}
              </Text>
            )}
            <Text fw={500}>{subgroup.name}</Text>
          </Group>
          <Group gap="xs">
            <ActionIcon
              variant={subgroup.is_subscribed ? "filled" : "light"}
              color={subgroup.is_subscribed ? "blue" : "gray"}
              onClick={handleSubscriptionClick}
              loading={isSubscribing || isUnsubscribing}
              title={subgroup.is_subscribed ? "Afmeld" : "Tilmeld"}
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
          <Typography
            style={{
              fontSize: "var(--mantine-font-size-sm)",
              color: "var(--mantine-color-dimmed)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            <div
              className="description-content"
              dangerouslySetInnerHTML={{ __html: subgroup.description }}
            />
          </Typography>
        )}

        {subgroup.last_activity_at && (
          <Text
            size="xs"
            c="dimmed"
            truncate
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {subgroup.latest_thread_title
              ? `Seneste: ${subgroup.latest_thread_title} \u2014 ${dayjs(subgroup.last_activity_at).fromNow()}`
              : dayjs(subgroup.last_activity_at).fromNow()}
          </Text>
        )}
      </Stack>
    </Paper>
  )
}
