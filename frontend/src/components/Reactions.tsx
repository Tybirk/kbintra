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
  Loader,
  TextInput,
} from "@mantine/core"

import { useMediaQuery } from "@mantine/hooks"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { IconMoodSmile, IconDots } from "@tabler/icons-react"

import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { forumApi } from "../api/forum"

import type { ReactionSummary, ReactionType } from "../types"

import UserLink from "./UserLink"

const LazyPicker = lazy(() => import("@emoji-mart/react"))

const emojiDataPromise = () => import("@emoji-mart/data").then((m) => m.default)

// Default quick-reaction emojis (first 6)

const DEFAULT_EMOJIS: string[] = [
  "\u{1F44D}",

  "\u2764\uFE0F",

  "\u{1F602}",

  "\u{1F62E}",

  "\u{1F622}",

  "\u{1F389}",
]

interface EmojiData {
  native: string
}

interface ReactionsProps {
  postId: number

  threadQueryKey: (string | number)[]

  reactions: ReactionSummary[]
}

// Extracts the first emoji grapheme from a string (handles ZWJ sequences and skin tones).
function extractFirstEmoji(value: string): string | null {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

    for (const { segment } of segmenter.segment(value)) {
      if (/\p{Extended_Pictographic}/u.test(segment)) {
        return segment
      }
    }

    return null
  }

  const match = value.match(/\p{Extended_Pictographic}/u)

  return match ? match[0] : null
}

export default function Reactions({
  postId,

  threadQueryKey,

  reactions,
}: ReactionsProps) {
  const queryClient = useQueryClient()

  const isMobile = useMediaQuery("(max-width: 48em)")

  const [pickerOpened, setPickerOpened] = useState(false)

  const [fullPickerOpened, setFullPickerOpened] = useState(false)

  const [nativeInputOpened, setNativeInputOpened] = useState(false)

  const [nativeInputValue, setNativeInputValue] = useState("")

  const nativeInputRef = useRef<HTMLInputElement>(null)

  const [emojiData, setEmojiData] = useState<object | null>(null)

  const [openReactionType, setOpenReactionType] = useState<ReactionType | null>(
    null,
  )

  useEffect(() => {
    if (nativeInputOpened) {
      // Defer focus so the popover is mounted before we trigger the keyboard.
      const id = window.setTimeout(() => nativeInputRef.current?.focus(), 50)

      return () => window.clearTimeout(id)
    }
  }, [nativeInputOpened])

  const toggleMutation = useMutation({
    mutationFn: (reactionType: ReactionType) =>
      forumApi.toggleReaction(postId, reactionType),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey })

      setPickerOpened(false)

      setFullPickerOpened(false)

      setNativeInputOpened(false)

      setNativeInputValue("")

      setOpenReactionType(null)
    },
  })

  const handleReaction = (reactionType: ReactionType) => {
    toggleMutation.mutate(reactionType)
  }

  const handleOpenFullPicker = () => {
    setPickerOpened(false)

    if (isMobile) {
      setNativeInputValue("")

      setNativeInputOpened((o) => !o)

      return
    }

    if (!emojiData) {
      emojiDataPromise().then(setEmojiData)
    }

    setFullPickerOpened((o) => !o)
  }

  const handleFullPickerSelect = (emoji: EmojiData) => {
    handleReaction(emoji.native)
  }

  const handleNativeInputChange = (value: string) => {
    setNativeInputValue(value)

    const emoji = extractFirstEmoji(value)

    if (emoji) {
      handleReaction(emoji)
    }
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
                    : "Tilf\u00f8j din reaktion"}
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

      {/* Full emoji picker (desktop) */}
      <Popover
        opened={fullPickerOpened}
        onChange={setFullPickerOpened}
        position="top"
        width="auto"
        shadow="md"
      >
        <Popover.Target>
          <Box style={{ width: 0, height: 0 }} />
        </Popover.Target>
        <Popover.Dropdown p={0} style={{ border: "none", background: "none" }}>
          {fullPickerOpened && (
            <Suspense fallback={<Loader size="sm" m="md" />}>
              <LazyPicker
                data={emojiData}
                onEmojiSelect={handleFullPickerSelect}
                locale="da"
                theme="light"
                previewPosition="none"
                skinTonePosition="search"
                searchPosition="sticky"
                navPosition="top"
                perLine={9}
                emojiSize={22}
                emojiButtonSize={32}
                maxFrequentRows={2}
              />
            </Suspense>
          )}
        </Popover.Dropdown>
      </Popover>

      {/* Native emoji input (mobile) */}
      <Popover
        opened={nativeInputOpened}
        onChange={setNativeInputOpened}
        position="top"
        width={240}
        shadow="md"
      >
        <Popover.Target>
          <Box style={{ width: 0, height: 0 }} />
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <Stack gap={6}>
            <TextInput
              ref={nativeInputRef}
              value={nativeInputValue}
              onChange={(e) => handleNativeInputChange(e.currentTarget.value)}
              placeholder="😀"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={toggleMutation.isPending}
            />
            <Text size="xs" c="dimmed">
              Skift til emoji på dit tastatur og vælg en
            </Text>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  )
}
