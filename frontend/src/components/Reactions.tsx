import {
  Group,
  ActionIcon,
  Text,
  Popover,
  SimpleGrid,
  Tooltip,
  UnstyledButton,
  Box,
} from "@mantine/core"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconMoodSmile } from "@tabler/icons-react"
import { useState } from "react"

import { forumApi } from "../api/forum"
import type { ReactionSummary, ReactionType } from "../types"

// Emoji map for reactions
const REACTION_EMOJIS: Record<ReactionType, string> = {
  like: "\u{1F44D}",
  heart: "\u2764\uFE0F",
  laugh: "\u{1F602}",
  surprised: "\u{1F62E}",
  sad: "\u{1F622}",
  celebrate: "\u{1F389}",
}

const REACTION_LABELS: Record<ReactionType, string> = {
  like: "Synes godt om",
  heart: "Elsker",
  laugh: "Sjovt",
  surprised: "Overrasket",
  sad: "Ked af det",
  celebrate: "Fejrer",
}

interface ReactionsProps {
  postId: number
  threadId: number
  reactions: ReactionSummary[]
}

export default function Reactions({
  postId,
  threadId,
  reactions,
}: ReactionsProps) {
  const queryClient = useQueryClient()
  const [popoverOpened, setPopoverOpened] = useState(false)

  const toggleMutation = useMutation({
    mutationFn: (reactionType: ReactionType) =>
      forumApi.toggleReaction(postId, reactionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
      setPopoverOpened(false)
    },
  })

  const handleReaction = (reactionType: ReactionType) => {
    toggleMutation.mutate(reactionType)
  }

  // Get all reaction types for the picker
  const allReactionTypes: ReactionType[] = [
    "like",
    "heart",
    "laugh",
    "surprised",
    "sad",
    "celebrate",
  ]

  return (
    <Group gap="sm">
      {/* Display existing reactions */}
      {reactions.map((reaction) => (
        <Tooltip
          key={reaction.reaction_type}
          label={REACTION_LABELS[reaction.reaction_type]}
        >
          <UnstyledButton
            onClick={() => handleReaction(reaction.reaction_type)}
            disabled={
              toggleMutation.isPending &&
              toggleMutation.variables === reaction.reaction_type
            }
          >
            <Box
              px="xs"
              py={4}
              style={(theme) => ({
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.xs,
                borderRadius: theme.radius.md,
                backgroundColor: reaction.has_reacted
                  ? theme.colors.blue[1]
                  : theme.colors.gray[1],
                border: `1px solid ${
                  reaction.has_reacted
                    ? theme.colors.blue[3]
                    : theme.colors.gray[3]
                }`,
                cursor: "pointer",
                transition: "all 0.15s ease",
                "&:hover": {
                  backgroundColor: reaction.has_reacted
                    ? theme.colors.blue[2]
                    : theme.colors.gray[2],
                },
              })}
            >
              <Text size="sm" lh={1}>
                {reaction.emoji}
              </Text>
              <Text
                size="sm"
                fw={600}
                c={reaction.has_reacted ? "blue.7" : "gray.7"}
              >
                {reaction.count}
              </Text>
            </Box>
          </UnstyledButton>
        </Tooltip>
      ))}

      {/* Add reaction button */}
      <Popover
        opened={popoverOpened}
        onChange={setPopoverOpened}
        position="top"
        withArrow
      >
        <Popover.Target>
          <Tooltip label="Tilføj reaktion">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              onClick={() => setPopoverOpened((o) => !o)}
            >
              <IconMoodSmile size={18} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <SimpleGrid cols={6} spacing="xs">
            {allReactionTypes.map((type) => {
              const existingReaction = reactions.find(
                (r) => r.reaction_type === type,
              )
              return (
                <Tooltip key={type} label={REACTION_LABELS[type]}>
                  <ActionIcon
                    variant={
                      existingReaction?.has_reacted ? "filled" : "subtle"
                    }
                    color={existingReaction?.has_reacted ? "blue" : "gray"}
                    size="xl"
                    onClick={() => handleReaction(type)}
                    loading={
                      toggleMutation.isPending &&
                      toggleMutation.variables === type
                    }
                  >
                    <Text size="xl">{REACTION_EMOJIS[type]}</Text>
                  </ActionIcon>
                </Tooltip>
              )
            })}
          </SimpleGrid>
        </Popover.Dropdown>
      </Popover>
    </Group>
  )
}
