import { Popover, Text, UnstyledButton } from "@mantine/core"
import dayjs from "dayjs"
import { useState } from "react"

interface EditedByInfo {
  first_name: string
  last_name: string
}

interface PostDateProps {
  createdAt: string
  updatedAt?: string
  editedBy?: EditedByInfo | null
  shortFormat?: string
}

export default function PostDate({
  createdAt,
  updatedAt,
  editedBy,
  shortFormat = "D. MMM YYYY [kl.] HH:mm",
}: PostDateProps) {
  const [opened, setOpened] = useState(false)
  const wasEdited =
    updatedAt !== undefined &&
    Math.abs(dayjs(updatedAt).diff(dayjs(createdAt), "second")) > 1

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <UnstyledButton onClick={() => setOpened((o) => !o)}>
          <Text size="xs" c="dimmed" style={{ cursor: "pointer" }}>
            {dayjs(createdAt).format(shortFormat)}
            {wasEdited &&
              (editedBy
                ? ` (redigeret af ${editedBy.first_name} ${editedBy.last_name})`
                : " (redigeret)")}
          </Text>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Text size="xs">
          Oprettet: {dayjs(createdAt).format("DD.MM.YY HH:mm:ss")}
        </Text>
        {wasEdited && (
          <Text size="xs" mt={2}>
            Redigeret: {dayjs(updatedAt).format("DD.MM.YY HH:mm:ss")}
            {editedBy && ` af ${editedBy.first_name} ${editedBy.last_name}`}
          </Text>
        )}
      </Popover.Dropdown>
    </Popover>
  )
}
