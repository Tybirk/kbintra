import {
  Paper,
  Text,
  TextInput,
  Switch,
  Button,
  Group,
  Stack,
  CloseButton,
  ActionIcon,
} from "@mantine/core"

import { IconPlus, IconChevronUp, IconChevronDown } from "@tabler/icons-react"

import type { CreatePollData } from "../types"

interface PollCreatorProps {
  pollData: CreatePollData

  onChange: (data: CreatePollData) => void

  onClose?: () => void
}

export default function PollCreator({
  pollData,

  onChange,

  onClose,
}: PollCreatorProps) {
  const updateField = <K extends keyof CreatePollData,>(
    key: K,

    value: CreatePollData[K],
  ) => {
    onChange({ ...pollData, [key]: value })
  }

  const updateOption = (index: number, text: string) => {
    const newOptions = [...pollData.options]

    newOptions[index] = { ...newOptions[index], text }

    onChange({ ...pollData, options: newOptions })
  }

  const addOption = () => {
    if (pollData.options.length < 20) {
      onChange({ ...pollData, options: [...pollData.options, { text: "" }] })
    }
  }

  const removeOption = (index: number) => {
    if (pollData.options.length > 2) {
      const newOptions = pollData.options.filter((_, i) => i !== index)

      onChange({ ...pollData, options: newOptions })
    }
  }

  const moveOption = (index: number, direction: -1 | 1) => {
    const newOptions = [...pollData.options]

    const target = index + direction

    const temp = newOptions[index]

    newOptions[index] = newOptions[target]

    newOptions[target] = temp

    onChange({ ...pollData, options: newOptions })
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      bg="var(--mantine-color-default-hover)"
    >
      <Group justify="space-between" mb="sm">
        <Text size="sm" fw={600}>
          Afstemning
        </Text>
        {onClose && (
          <CloseButton size="sm" onClick={onClose} title="Fjern afstemning" />
        )}
      </Group>

      <Stack gap="sm">
        <TextInput
          placeholder="Stil et spørgsmål..."
          value={pollData.question}
          onChange={(e) => updateField("question", e.currentTarget.value)}
          size="sm"
        />

        {pollData.options.map((option, index) => (
          <Group key={option.id ?? index} gap="xs" wrap="nowrap">
            <Stack gap={0}>
              <ActionIcon
                variant="subtle"
                size="xs"
                disabled={index === 0}
                onClick={() => moveOption(index, -1)}
                aria-label="Flyt op"
              >
                <IconChevronUp size={12} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="xs"
                disabled={index === pollData.options.length - 1}
                onClick={() => moveOption(index, 1)}
                aria-label="Flyt ned"
              >
                <IconChevronDown size={12} />
              </ActionIcon>
            </Stack>
            <TextInput
              placeholder={`Valgmulighed ${index + 1}`}
              value={option.text}
              onChange={(e) => updateOption(index, e.currentTarget.value)}
              size="sm"
              style={{ flex: 1 }}
            />
            {pollData.options.length > 2 && (
              <CloseButton
                variant="subtle"
                color="red"
                size="sm"
                onClick={() => removeOption(index)}
              />
            )}
          </Group>
        ))}

        {pollData.options.length < 20 && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={addOption}
            style={{ alignSelf: "flex-start" }}
          >
            Tilføj valgmulighed
          </Button>
        )}

        <Group gap="lg">
          <Switch
            label="Multiple choice"
            size="xs"
            checked={pollData.allow_multiple_votes}
            onChange={(e) =>
              updateField("allow_multiple_votes", e.currentTarget.checked)
            }
            styles={{
              track: { border: "1.5px solid var(--mantine-color-gray-5)" },
            }}
          />
          <Switch
            label="Anonym afstemning"
            size="xs"
            checked={pollData.is_anonymous}
            onChange={(e) =>
              updateField("is_anonymous", e.currentTarget.checked)
            }
            styles={{
              track: { border: "1.5px solid var(--mantine-color-gray-5)" },
            }}
          />
          <Switch
            label="Andre kan tilføje valgmuligheder"
            size="xs"
            checked={pollData.allow_others_to_add_options}
            onChange={(e) =>
              updateField(
                "allow_others_to_add_options",
                e.currentTarget.checked,
              )
            }
            styles={{
              track: { border: "1.5px solid var(--mantine-color-gray-5)" },
            }}
          />
        </Group>
      </Stack>
    </Paper>
  )
}
