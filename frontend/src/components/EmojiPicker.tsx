import { useState } from "react"
import { Popover, ActionIcon } from "@mantine/core"
import { IconMoodSmile } from "@tabler/icons-react"
import Picker from "@emoji-mart/react"
import data from "@emoji-mart/data"

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
}

interface EmojiData {
  native: string
  id: string
  name: string
  unified: string
  shortcodes: string
}

export default function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [opened, setOpened] = useState(false)

  const handleEmojiSelect = (emoji: EmojiData) => {
    onSelect(emoji.native)
    setOpened(false)
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width="auto"
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
