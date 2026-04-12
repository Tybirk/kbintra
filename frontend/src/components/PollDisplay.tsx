import { useState } from "react"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Paper,
  Text,
  Group,
  Badge,
  UnstyledButton,
  Avatar,
  Tooltip,
  ActionIcon,
  Stack,
  Box,
  Modal,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import { IconTrash, IconCheck } from "@tabler/icons-react"

import { forumApi } from "../api/forum"

import type { Poll, PollOption } from "../types"

interface PollDisplayProps {
  poll: Poll

  threadQueryKey: (string | number)[]
}

function RadioIndicator({ checked }: { checked: boolean }) {
  return (
    <Box
      style={{
        width: 20,

        height: 20,

        borderRadius: "50%",

        border: `2px solid ${
          checked
            ? "var(--mantine-color-blue-6)"
            : "var(--mantine-color-gray-4)"
        }`,

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        flexShrink: 0,

        transition: "border-color 150ms ease",
      }}
    >
      {checked && (
        <Box
          style={{
            width: 10,

            height: 10,

            borderRadius: "50%",

            backgroundColor: "var(--mantine-color-blue-6)",
          }}
        />
      )}
    </Box>
  )
}

function CheckboxIndicator({ checked }: { checked: boolean }) {
  return (
    <Box
      style={{
        width: 20,

        height: 20,

        borderRadius: 4,

        border: `2px solid ${
          checked
            ? "var(--mantine-color-blue-6)"
            : "var(--mantine-color-gray-4)"
        }`,

        backgroundColor: checked
          ? "var(--mantine-color-blue-6)"
          : "transparent",

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        flexShrink: 0,

        transition: "all 150ms ease",
      }}
    >
      {checked && <IconCheck size={14} color="white" stroke={3} />}
    </Box>
  )
}

function OptionBar({
  option,

  poll,

  onVote,

  onShowVoters,
}: {
  option: PollOption

  poll: Poll

  onVote: () => void

  onShowVoters: () => void
}) {
  const percentage =
    poll.total_voters > 0
      ? Math.round((option.vote_count / poll.total_voters) * 100)
      : 0

  const Indicator = poll.allow_multiple_votes
    ? CheckboxIndicator
    : RadioIndicator

  const showVoters = !poll.is_anonymous && option.voters.length > 0

  return (
    <Box
      style={{
        position: "relative",

        border: `1.5px solid ${
          option.has_voted
            ? "var(--mantine-color-blue-5)"
            : "var(--mantine-color-gray-3)"
        }`,

        borderRadius: "var(--mantine-radius-md)",

        overflow: "hidden",

        transition: "border-color 150ms ease",
      }}
    >
      {/* Progress bar background */}
      <Box
        style={{
          position: "absolute",

          top: 0,

          left: 0,

          height: "100%",

          width: `${percentage}%`,

          backgroundColor: option.has_voted
            ? "var(--mantine-color-blue-light)"
            : "var(--mantine-color-default-hover)",

          transition: "width 400ms ease",

          zIndex: 0,
        }}
      />

      {/* Row 1: vote trigger (left) + percentage (right) */}
      <Box
        style={{
          display: "flex",

          alignItems: "stretch",

          position: "relative",

          zIndex: 1,
        }}
      >
        <UnstyledButton onClick={onVote} style={{ flex: 1, minWidth: 0 }}>
          <Group wrap="nowrap" gap="sm" px="sm" py={10}>
            <Indicator checked={option.has_voted} />
            <Text
              size="sm"
              fw={option.has_voted ? 600 : 400}
              style={{ flex: 1, minWidth: 0 }}
            >
              {option.text}
            </Text>
          </Group>
        </UnstyledButton>

        {showVoters ? (
          <UnstyledButton
            onClick={onShowVoters}
            style={{ display: "flex", alignItems: "center" }}
          >
            <Text size="sm" fw={500} c="dimmed" px="sm">
              {percentage}%
            </Text>
          </UnstyledButton>
        ) : (
          <Box style={{ display: "flex", alignItems: "center" }}>
            <Text size="sm" fw={500} c="dimmed" px="sm">
              {percentage}%
            </Text>
          </Box>
        )}
      </Box>

      {/* Row 2: Voters — separate button, no nesting */}
      {showVoters && (
        <Tooltip label="Klik for at se navne" withArrow>
          <UnstyledButton
            onClick={onShowVoters}
            style={{ width: "100%", display: "block" }}
          >
            <Group
              gap={6}
              px="sm"
              pb={8}
              justify="flex-end"
              style={{ position: "relative", zIndex: 1 }}
            >
              <Text size="xs" c="dimmed">
                {option.voters.length === 1
                  ? "1 stemme"
                  : `${option.voters.length} stemmer`}
              </Text>
              <Avatar.Group spacing="xs">
                {option.voters.slice(0, 5).map((voter) => (
                  <Avatar
                    key={voter.id}
                    src={voter.profile_picture}
                    size="xs"
                    radius="xl"
                  >
                    {voter.first_name?.[0]}
                  </Avatar>
                ))}
                {option.voters.length > 5 && (
                  <Avatar size="xs" radius="xl">
                    +{option.voters.length - 5}
                  </Avatar>
                )}
              </Avatar.Group>
            </Group>
          </UnstyledButton>
        </Tooltip>
      )}
    </Box>
  )
}

export default function PollDisplay({
  poll,

  threadQueryKey,
}: PollDisplayProps) {
  const queryClient = useQueryClient()

  const [votersOption, setVotersOption] = useState<PollOption | null>(null)

  const voteMutation = useMutation({
    mutationFn: (optionId: number) => forumApi.votePoll(poll.id, optionId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke stemme. Prøv igen.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => forumApi.deletePoll(poll.id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      notifications.show({
        title: "Afstemning slettet",

        message: "Afstemningen er blevet fjernet.",

        color: "blue",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke slette afstemningen. Prøv igen.")
    },
  })

  const handleVote = (optionId: number) => {
    if (!voteMutation.isPending) {
      voteMutation.mutate(optionId)
    }
  }

  const handleDelete = () => {
    if (window.confirm("Er du sikker på, at du vil slette denne afstemning?")) {
      deleteMutation.mutate()
    }
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      bg="var(--mantine-color-default-hover)"
      mt="sm"
    >
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          {poll.question}
        </Text>
        <Group gap="xs">
          {poll.allow_multiple_votes && (
            <Badge size="xs" variant="light" color="blue">
              Multiple choice
            </Badge>
          )}
          {poll.is_anonymous && (
            <Badge size="xs" variant="light" color="gray">
              Anonym
            </Badge>
          )}
          {poll.is_own && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
              title="Slet afstemning"
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      <Stack gap={8}>
        {poll.options.map((option) => (
          <OptionBar
            key={option.id}
            option={option}
            poll={poll}
            onVote={() => handleVote(option.id)}
            onShowVoters={() => setVotersOption(option)}
          />
        ))}
      </Stack>

      <Text size="xs" c="dimmed" mt="xs">
        {poll.total_voters} {poll.total_voters === 1 ? "person" : "personer"}{" "}
        har stemt
      </Text>

      <Modal
        opened={votersOption !== null}
        onClose={() => setVotersOption(null)}
        title={
          votersOption ? (
            <Text fw={600} size="sm">
              Stemte på: {votersOption.text}
            </Text>
          ) : null
        }
        size="sm"
        centered
      >
        {votersOption && (
          <Stack gap="xs">
            {votersOption.voters.map((voter) => (
              <Group key={voter.id} gap="sm">
                <Avatar src={voter.profile_picture} size="sm" radius="xl">
                  {voter.first_name?.[0]}
                </Avatar>
                <Text size="sm">
                  {voter.first_name} {voter.last_name}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Modal>
    </Paper>
  )
}
