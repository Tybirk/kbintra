import {
  Group,
  ActionIcon,
  Text,
  Popover,
  SimpleGrid,
  Tooltip,
  UnstyledButton,
  Box,
  Stack,
  Avatar,
} from "@mantine/core"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconMoodSmile } from "@tabler/icons-react"
import { useState } from "react"

import { forumApi } from "../api/forum"
import type { ReactionSummary, ReactionType } from "../types"
import UserLink from "./UserLink"

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
  threadQueryKey: (string | number)[]
  reactions: ReactionSummary[]
}

export default function Reactions({
  postId,
  threadQueryKey,
  reactions,
}: ReactionsProps) {
  const queryClient = useQueryClient()
  const [pickerOpened, setPickerOpened] = useState(false)
  const [openReactionType, setOpenReactionType] = useState<ReactionType | null>(
    null,
  )

  const toggleMutation = useMutation({
    mutationFn: (reactionType: ReactionType) =>
      forumApi.toggleReaction(postId, reactionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })
      setPickerOpened(false)
      setOpenReactionType(null)
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
        <Popover
          key={reaction.reaction_type}
          opened={openReactionType === reaction.reaction_type}
          onChange={(opened) =>
            setOpenReactionType(opened ? reaction.reaction_type : null)
          }
          position="top"
          withArrow
          shadow="md"
        >
          <Popover.Target>
            <UnstyledButton
              onClick={() =>
                setOpenReactionType(
                  openReactionType === reaction.reaction_type
                    ? null
                    : reaction.reaction_type,
                )
              }
              disabled={toggleMutation.isPending}
            >
              <Box
                px="xs"
                py={4}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--mantine-spacing-xs)",
                  borderRadius: "var(--mantine-radius-md)",
                  backgroundColor: reaction.has_reacted
                    ? "var(--mantine-color-blue-light)"
                    : "var(--mantine-color-default-hover)",
                  border: `1px solid ${
                    reaction.has_reacted
                      ? "var(--mantine-color-blue-light-color)"
                      : "var(--mantine-color-default-border)"
                  }`,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
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
          </Popover.Target>
          <Popover.Dropdown p="sm">
            <Stack gap="xs">
              <Text size="xs" fw={600} c="dimmed">
                {REACTION_LABELS[reaction.reaction_type]}
              </Text>
              {reaction.users.map((user) => (
                <Group key={user.id} gap="xs">
                  <Avatar src={user.profile_picture} size="sm" radius="xl">
                    {user.first_name?.[0]}
                    {user.last_name?.[0]}
                  </Avatar>
                  <UserLink
                    id={user.id}
                    firstName={user.first_name}
                    lastName={user.last_name}
                    size="sm"
                  />
                </Group>
              ))}
              <UnstyledButton
                mt={4}
                onClick={() => handleReaction(reaction.reaction_type)}
                style={{ alignSelf: "flex-start" }}
              >
                <Text
                  size="xs"
                  c={reaction.has_reacted ? "red.6" : "blue.6"}
                  style={{ textDecoration: "underline", cursor: "pointer" }}
                >
                  {reaction.has_reacted
                    ? "Fjern din reaktion"
                    : "Tilføj din reaktion"}
                </Text>
              </UnstyledButton>
            </Stack>
          </Popover.Dropdown>
        </Popover>
      ))}

      {/* Add reaction button */}
      <Popover
        opened={pickerOpened}
        onChange={setPickerOpened}
        position="top"
        withArrow
      >
        <Popover.Target>
          <Tooltip label="Tilføj reaktion">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              onClick={() => setPickerOpened((o) => !o)}
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
