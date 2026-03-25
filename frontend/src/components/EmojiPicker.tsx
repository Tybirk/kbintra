import { lazy, Suspense, useState } from "react"
import {
  Popover,
  ActionIcon,
  Text,
  Loader,
  type MantineSize,
} from "@mantine/core"
import { IconMoodSmile } from "@tabler/icons-react"

const LazyPicker = lazy(() => import("@emoji-mart/react"))
const emojiDataPromise = () => import("@emoji-mart/data").then((m) => m.default)

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  size?: MantineSize
  iconSize?: number
  disabled?: boolean
  icon?: string
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
  icon,
}: EmojiPickerProps) {
  const [opened, setOpened] = useState(false)
  const [data, setData] = useState<object | null>(null)

  const handleOpen = () => {
    if (!data) {
      emojiDataPromise().then(setData)
    }
    setOpened((o) => !o)
  }

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
        {opened && (
          <Suspense fallback={<Loader size="sm" m="md" />}>
            <LazyPicker
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
          </Suspense>
        )}
      </Popover.Dropdown>
    </Popover>
  )
}
