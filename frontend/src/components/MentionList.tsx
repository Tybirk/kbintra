import { forwardRef, useImperativeHandle, useState, useEffect } from "react"
import {
  Paper,
  Stack,
  UnstyledButton,
  Group,
  Avatar,
  Text,
} from "@mantine/core"
import type { MentionUser } from "../types"

export interface MentionCommandItem {
  id: string
  label: string
}

interface MentionListProps {
  items: MentionUser[]
  command: (item: MentionCommandItem) => void
}

export interface MentionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) {
        command({
          id: String(item.id),
          label: `${item.first_name} ${item.last_name}`,
        })
      }
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) return null

    return (
      <Paper
        shadow="md"
        withBorder
        style={{ maxWidth: 300, overflow: "hidden" }}
      >
        <Stack gap={0} py={4}>
          {items.map((item, index) => (
            <UnstyledButton
              key={item.id}
              onClick={() => selectItem(index)}
              py={6}
              px={12}
              style={{
                backgroundColor:
                  index === selectedIndex
                    ? "var(--mantine-color-blue-light)"
                    : undefined,
              }}
            >
              <Group gap={8}>
                <Avatar src={item.profile_picture} size={28} radius="xl">
                  {item.first_name[0]}
                </Avatar>
                <Text size="sm">
                  {item.first_name} {item.last_name}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      </Paper>
    )
  },
)

MentionList.displayName = "MentionList"

export default MentionList
