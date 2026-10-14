import {
  Group,
  ActionIcon,
  Text,
  Popover,
  Tooltip,
  UnstyledButton,
  Box,
  Stack,
  Avatar,
} from "@mantine/core"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { IconMoodSmile, IconDots } from "@tabler/icons-react"

import { useState } from "react"

import { forumApi } from "../api/forum"

import type { ReactionSummary, ReactionType } from "../types"

import EmojiMartPicker, { type PickedEmoji } from "./EmojiMartPicker"

import UserLink from "./UserLink"

// Default quick-reaction emojis (first 6)

const DEFAULT_EMOJIS: string[] = [
  "\u{1F44D}",

  "❤️",

  "\u{1F602}",

  "\u{1F62E}",

  "\u{1F622}",

  "\u{1F389}",
]

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

  const [fullPickerOpened, setFullPickerOpened] = useState(false)

  const [openReactionType, setOpenReactionType] = useState<ReactionType | null>(
    null,
  )

  const toggleMutation = useMutation({
    mutationFn: (reactionType: ReactionType) =>
      forumApi.toggleReaction(postId, reactionType),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      setPickerOpened(false)

      setFullPickerOpened(false)

      setOpenReactionType(null)
    },
  })

  const handleReaction = (reactionType: ReactionType) => {
    toggleMutation.mutate(reactionType)
  }

  const handleOpenFullPicker = () => {
    setPickerOpened(false)

    setFullPickerOpened((o) => !o)
  }

  const handleFullPickerSelect = (emoji: PickedEmoji) => {
    handleReaction(emoji.native)
  }

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
                  c={reaction.has_reacted ? "blue" : "dimmed"}
                >
                  {reaction.count}
                </Text>
              </Box>
            </UnstyledButton>
          </Popover.Target>
          <Popover.Dropdown p="sm">
            <Stack gap="xs">
              <Text size="xs" fw={600} c="dimmed">
                {reaction.emoji}
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

      {/* Quick reaction picker */}
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
              onClick={() => {
                setFullPickerOpened(false)

                setPickerOpened((o) => !o)
              }}
            >
              <IconMoodSmile size={18} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <Group gap={4}>
            {DEFAULT_EMOJIS.map((emoji) => {
              const existingReaction = reactions.find(
                (r) => r.reaction_type === emoji,
              )

              return (
                <ActionIcon
                  key={emoji}
                  variant={existingReaction?.has_reacted ? "filled" : "subtle"}
                  color={existingReaction?.has_reacted ? "blue" : "gray"}
                  size="md"
                  onClick={() => handleReaction(emoji)}
                  loading={
                    toggleMutation.isPending &&
                    toggleMutation.variables === emoji
                  }
                >
                  <Text size="md">{emoji}</Text>
                </ActionIcon>
              )
            })}
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={handleOpenFullPicker}
            >
              <IconDots size={18} />
            </ActionIcon>
          </Group>
        </Popover.Dropdown>
      </Popover>

      {/* Full emoji picker — a Popover on every screen, as in the chat, so a
          tap outside closes it. The phone Drawer it replaced filled the
          screen (Mantine 9.5 has no size "auto") and had no way to close. */}
      <Popover
        opened={fullPickerOpened}
        onChange={setFullPickerOpened}
        position="top"
        width="auto"
        shadow="md"
        // Slide it back on screen when neither above nor below has room for
        // its 435 px — a post mid-screen on a phone — rather than cutting off
        // the search field and the categories.
        middlewares={{ flip: true, shift: { crossAxis: true } }}
      >
        <Popover.Target>
          <Box style={{ width: 0, height: 0 }} />
        </Popover.Target>
        <Popover.Dropdown p={0} style={{ border: "none", background: "none" }}>
          {fullPickerOpened && (
            <EmojiMartPicker onEmojiSelect={handleFullPickerSelect} />
          )}
        </Popover.Dropdown>
      </Popover>
    </Group>
  )
}
