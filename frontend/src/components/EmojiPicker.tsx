import { useState } from "react"

import { Popover, ActionIcon, Text, type MantineSize } from "@mantine/core"

import { IconMoodSmile } from "@tabler/icons-react"

import EmojiMartPicker, { type PickedEmoji } from "./EmojiMartPicker"

interface EmojiPickerProps {
  onSelect: (emoji: string) => void

  size?: MantineSize

  iconSize?: number

  disabled?: boolean

  icon?: string
}

export default function EmojiPicker({
  onSelect,

  size = "lg",

  iconSize = 20,

  disabled = false,

  icon,
}: EmojiPickerProps) {
  const [opened, setOpened] = useState(false)

  const handleOpen = () => {
    setOpened((o) => !o)
  }

  const handleEmojiSelect = (emoji: PickedEmoji) => {
    onSelect(emoji.native)

    setOpened(false)
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="top-end"
      width="auto"
      shadow="md"
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={size}
          onClick={handleOpen}
          title="Emoji"
          disabled={disabled}
        >
          {icon ? (
            <Text size="xl" lh={1}>
              {icon}
            </Text>
          ) : (
            <IconMoodSmile size={iconSize} />
          )}
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ border: "none", background: "none" }}>
        {opened && <EmojiMartPicker onEmojiSelect={handleEmojiSelect} />}
      </Popover.Dropdown>
    </Popover>
  )
}
