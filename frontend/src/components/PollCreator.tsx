import {
  Paper,
  Text,
  TextInput,
  Switch,
  Button,
  Group,
  ActionIcon,
  Stack,
  CloseButton,
} from "@mantine/core"
import { IconPlus, IconChartBar } from "@tabler/icons-react"

import type { CreatePollData } from "../types"

interface PollCreatorProps {
  pollData: CreatePollData | null
  onChange: (data: CreatePollData | null) => void
}

const defaultPollData: CreatePollData = {
  question: "",
  allow_multiple_votes: false,
  is_anonymous: false,
  options: [{ text: "" }, { text: "" }],
}

export default function PollCreator({ pollData, onChange }: PollCreatorProps) {
  if (!pollData) {
    return (
      <Button
        variant="light"
        leftSection={<IconChartBar size={16} />}
        onClick={() =>
          onChange({
            ...defaultPollData,
            options: [{ text: "" }, { text: "" }],
          })
        }
        size="sm"
      >
        Add Poll
      </Button>
    )
  }

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
          Poll
        </Text>
        <CloseButton
          size="sm"
          onClick={() => onChange(null)}
          title="Remove poll"
        />
      </Group>

      <Stack gap="sm">
        <TextInput
          placeholder="Ask a question..."
          value={pollData.question}
          onChange={(e) => updateField("question", e.currentTarget.value)}
          size="sm"
        />

        {pollData.options.map((option, index) => (
          <Group key={index} gap="xs">
            <TextInput
              placeholder={`Option ${index + 1}`}
              value={option.text}
              onChange={(e) => updateOption(index, e.currentTarget.value)}
              size="sm"
              style={{ flex: 1 }}
            />
            {pollData.options.length > 2 && (
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                onClick={() => removeOption(index)}
              >
                <CloseButton size="sm" />
              </ActionIcon>
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
            Add option
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
            label="Anonymous voting"
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
