import {
  Paper,
  Text,
  TextInput,
  Switch,
  Button,
  Group,
  Stack,
  CloseButton,
} from "@mantine/core"
import { IconPlus } from "@tabler/icons-react"

import type { CreatePollData } from "../types"

interface PollCreatorProps {
  pollData: CreatePollData
  onChange: (data: CreatePollData | null) => void
}

export default function PollCreator({ pollData, onChange }: PollCreatorProps) {
  const updateField = <K extends keyof CreatePollData,>(
    key: K,
    value: CreatePollData[K],
  ) => {
    onChange({ ...pollData, [key]: value })
  }

  const updateOption = (index: number, text: string) => {
    const newOptions = [...pollData.options]
    newOptions[index] = { text }
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

  return (
    <Paper withBorder p="md" radius="md" bg="gray.0">
      <Group justify="space-between" mb="sm">
        <Text size="sm" fw={600}>
          Afstemning
        </Text>
        <CloseButton
          size="sm"
          onClick={() => onChange(null)}
          title="Fjern afstemning"
        />
      </Group>

      <Stack gap="sm">
        <TextInput
          placeholder="Stil et spørgsmål..."
          value={pollData.question}
          onChange={(e) => updateField("question", e.currentTarget.value)}
          size="sm"
        />

        {pollData.options.map((option, index) => (
          <Group key={index} gap="xs">
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
          />
          <Switch
            label="Anonym afstemning"
            size="xs"
            checked={pollData.is_anonymous}
            onChange={(e) =>
              updateField("is_anonymous", e.currentTarget.checked)
            }
          />
        </Group>
      </Stack>
    </Paper>
  )
}
