import { useState, useMemo } from "react"
import {
  Popover,
  ActionIcon,
  TextInput,
  SimpleGrid,
  ScrollArea,
  Text,
  Tabs,
  UnstyledButton,
  Tooltip,
  Divider,
} from "@mantine/core"
import { IconMoodSmile, IconSearch } from "@tabler/icons-react"
import { gitHubEmojis } from "@tiptap/extension-emoji"
import type { EmojiItem } from "@tiptap/extension-emoji"

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
}

// Only include emojis that have an actual emoji character (not just fallback images)
const unicodeEmojis = gitHubEmojis.filter((e) => e.emoji)
console.log(unicodeEmojis)
// Group emojis by their group property
const emojiGroups = unicodeEmojis.reduce(
  (acc, emoji) => {
    const group = emoji.group || "Other"
    if (!acc[group]) {
      acc[group] = []
    }
    if (!emoji.name.includes("regional")) {
      acc[group].push(emoji)
    }
    return acc
  },
  {} as Record<string, EmojiItem[]>,
)

// Define tab order and icons (keys must match the actual group names from gitHubEmojis)
const groupOrder = [
  { key: "Other", icon: "🙂", label: "Other" },
  { key: "people & body", icon: "👋", label: "People" },
  { key: "animals & nature", icon: "🐱", label: "Animals" },
  { key: "food & drink", icon: "🍕", label: "Food" },
  { key: "travel & places", icon: "✈️", label: "Travel" },
  { key: "activities", icon: "⚽", label: "Activities" },
  { key: "objects", icon: "💡", label: "Objects" },
  //{ key: 'symbols', icon: '❤️', label: 'Symbols' },
  { key: "flags", icon: "🏁", label: "Flags" },
]

// Get available groups (ones that actually have emojis)
const availableGroups = groupOrder.filter((g) => emojiGroups[g.key]?.length > 0)

export default function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [opened, setOpened] = useState(false)
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<string>(
    availableGroups[0]?.key || "Other",
  )

  const filteredEmojis = useMemo(() => {
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      return unicodeEmojis.filter(
        (emoji) =>
          emoji.name.toLowerCase().includes(searchLower) ||
          emoji.shortcodes.some((sc) =>
            sc.toLowerCase().includes(searchLower),
          ) ||
          emoji.tags.some((tag) => tag.toLowerCase().includes(searchLower)),
      )
    }

    // Show current tab's emojis
    return emojiGroups[activeTab] || []
  }, [search, activeTab])

  const handleSelect = (emoji: EmojiItem) => {
    if (emoji.emoji) {
      onSelect(emoji.emoji)
      setOpened(false)
      setSearch("")
    }
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={320}
      shadow="md"
    >
      <Popover.Target>
        <ActionIcon
          variant="default"
          size="sm"
          onClick={() => setOpened((o) => !o)}
          title="Emoji"
        >
          <IconMoodSmile size={16} />
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p="xs">
        <TextInput
          placeholder="Search emoji..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          mb="xs"
        />

        {!search && (
          <Tabs
            value={activeTab}
            onChange={(v) => v && setActiveTab(v)}
            variant="pills"
          >
            <Tabs.List style={{ flexWrap: "nowrap" }}>
              {availableGroups.map((group) => (
                <Tabs.Tab
                  key={group.key}
                  value={group.key}
                  p={4}
                  style={{ fontSize: "16px" }}
                >
                  {group.icon}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        )}
        <Divider mt={4} />
        <ScrollArea h={200} mt="xs">
          {filteredEmojis.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No emojis found
            </Text>
          ) : (
            <SimpleGrid cols={8} spacing={2}>
              {filteredEmojis.slice(0, 200).map((emoji) => (
                <Tooltip
                  key={emoji.name}
                  label={`:${emoji.shortcodes[0]}:`}
                  withArrow
                >
                  <UnstyledButton
                    onClick={() => handleSelect(emoji)}
                    style={{
                      fontSize: "20px",
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 4,
                    }}
                    className="emoji-button"
                  >
                    {emoji.emoji}
                  </UnstyledButton>
                </Tooltip>
              ))}
            </SimpleGrid>
          )}
        </ScrollArea>
      </Popover.Dropdown>
    </Popover>
  )
}
