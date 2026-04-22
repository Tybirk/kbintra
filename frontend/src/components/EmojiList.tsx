import { forwardRef, useImperativeHandle, useState, useEffect } from "react"

import { Paper, Stack, UnstyledButton, Text } from "@mantine/core"

import type { EmojiItem } from "./emojiData"

export type { EmojiItem }

interface EmojiListProps {
  items: EmojiItem[]

  command: (item: EmojiItem) => void
}

export interface EmojiListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const EmojiList = forwardRef<EmojiListRef, EmojiListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]

      if (item) command(item)
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

        if (event.key === "Enter" || event.key === "Tab") {
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
        style={{ maxWidth: 280, overflow: "hidden" }}
      >
        <Stack gap={0} py={4}>
          {items.map((item, index) => (
            <UnstyledButton
              key={item.id}
              onClick={() => selectItem(index)}
              py={4}
              px={12}
              style={{
                backgroundColor:
                  index === selectedIndex
                    ? "var(--mantine-color-blue-light)"
                    : undefined,
              }}
            >
              <Text size="sm">
                {item.native} :{item.id}:
              </Text>
            </UnstyledButton>
          ))}
        </Stack>
      </Paper>
    )
  },
)

EmojiList.displayName = "EmojiList"

export default EmojiList
