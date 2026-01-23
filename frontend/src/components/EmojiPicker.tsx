import { useState } from "react"
import { Popover, ActionIcon, type MantineSize } from "@mantine/core"
import { IconMoodSmile } from "@tabler/icons-react"
import Picker from "@emoji-mart/react"
import data from "@emoji-mart/data"

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  size?: MantineSize
  iconSize?: number
  disabled?: boolean
}

interface EmojiData {
  native: string
  id: string
  name: string
  unified: string
  shortcodes: string
}

export default function EmojiPicker({
  onSelect,
  size = "lg",
  iconSize = 20,
  disabled = false,
}: EmojiPickerProps) {
  const [opened, setOpened] = useState(false)

  const handleEmojiSelect = (emoji: EmojiData) => {
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
          onClick={() => setOpened((o) => !o)}
          title="Emoji"
          disabled={disabled}
        >
          <IconMoodSmile size={iconSize} />
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ border: "none", background: "none" }}>
        <Picker
          data={data}
          onEmojiSelect={handleEmojiSelect}
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
      </Popover.Dropdown>
    </Popover>
  )
}
