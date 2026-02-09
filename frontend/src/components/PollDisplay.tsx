import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Paper,
  Text,
  Group,
  Badge,
  Progress,
  UnstyledButton,
  Avatar,
  Tooltip,
  ActionIcon,
  Stack,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { IconTrash, IconCheck } from "@tabler/icons-react"

import { forumApi } from "../api/forum"
import type { Poll } from "../types"

interface PollDisplayProps {
  poll: Poll
  threadId: number
}

export default function PollDisplay({ poll, threadId }: PollDisplayProps) {
  const queryClient = useQueryClient()

  const voteMutation = useMutation({
    mutationFn: (optionId: number) => forumApi.votePoll(poll.id, optionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to vote. Please try again.",
        color: "red",
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => forumApi.deletePoll(poll.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      notifications.show({
        title: "Poll deleted",
        message: "The poll has been removed.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to delete poll. Please try again.",
        color: "red",
      })
    },
  })

  const handleVote = (optionId: number) => {
    if (!voteMutation.isPending) {
      voteMutation.mutate(optionId)
    }
  }

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this poll?")) {
      deleteMutation.mutate()
    }
  }

  const hasVoted = poll.options.some((o) => o.has_voted)

  return (
    <Paper withBorder p="md" radius="md" bg="gray.0" mt="sm">
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
              Anonymous
            </Badge>
          )}
          {poll.is_own && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
              title="Delete poll"
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      <Stack gap="xs">
        {poll.options.map((option) => {
          const percentage =
            poll.total_votes > 0
              ? Math.round((option.vote_count / poll.total_votes) * 100)
              : 0

          return (
            <UnstyledButton
              key={option.id}
              onClick={() => handleVote(option.id)}
              style={{ width: "100%" }}
            >
              <Paper
                withBorder
                p="xs"
                radius="sm"
                style={{
                  borderColor: option.has_voted
                    ? "var(--mantine-color-blue-5)"
                    : undefined,
                  backgroundColor: option.has_voted
                    ? "var(--mantine-color-blue-0)"
                    : undefined,
                }}
              >
                <Group justify="space-between" mb={4}>
                  <Group gap="xs">
                    {option.has_voted && (
                      <IconCheck
                        size={14}
                        color="var(--mantine-color-blue-6)"
                      />
                    )}
                    <Text size="sm" fw={option.has_voted ? 600 : 400}>
                      {option.text}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {option.vote_count}{" "}
                    {option.vote_count === 1 ? "vote" : "votes"} ({percentage}%)
                  </Text>
                </Group>
                {hasVoted && (
                  <Progress value={percentage} size="sm" radius="xl" />
                )}
                {!poll.is_anonymous && option.voters.length > 0 && (
                  <Group gap={4} mt={4}>
                    <Avatar.Group spacing="xs">
                      {option.voters.slice(0, 5).map((voter) => (
                        <Tooltip
                          key={voter.id}
                          label={`${voter.first_name} ${voter.last_name}`}
                        >
                          <Avatar
                            src={voter.profile_picture}
                            size="xs"
                            radius="xl"
                          >
                            {voter.first_name?.[0]}
                          </Avatar>
                        </Tooltip>
                      ))}
                      {option.voters.length > 5 && (
                        <Avatar size="xs" radius="xl">
                          +{option.voters.length - 5}
                        </Avatar>
                      )}
                    </Avatar.Group>
                  </Group>
                )}
              </Paper>
            </UnstyledButton>
          )
        })}
      </Stack>

      <Text size="xs" c="dimmed" mt="xs">
        {poll.total_votes} {poll.total_votes === 1 ? "vote" : "votes"} total
      </Text>
    </Paper>
  )
}
