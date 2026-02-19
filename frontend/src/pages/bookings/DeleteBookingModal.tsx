import { Text, Group, Button, Stack, Modal, Paper, Box } from "@mantine/core"

interface DeleteBookingModalProps {
  opened: boolean
  onClose: () => void
  isRecurring: boolean
  deleteMode: "all" | "single"
  onDeleteModeChange: (mode: "all" | "single") => void
  onConfirm: () => void
  isPending: boolean
}

export function DeleteBookingModal({
  opened,
  onClose,
  isRecurring,
  deleteMode,
  onDeleteModeChange,
  onConfirm,
  isPending,
}: DeleteBookingModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={() => {
        onClose()
        onDeleteModeChange("all")
      }}
      title="Slet booking"
      centered
    >
      <Stack gap="md">
        <Text>Er du sikker på, at du vil slette denne booking?</Text>

        {isRecurring && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Vælg hvad der skal slettes:
            </Text>
            <Paper
              withBorder
              p="sm"
              style={{
                cursor: "pointer",
                borderColor:
                  deleteMode === "single"
                    ? "var(--mantine-color-blue-6)"
                    : undefined,
                backgroundColor:
                  deleteMode === "single"
                    ? "var(--mantine-color-blue-0)"
                    : undefined,
              }}
              onClick={() => onDeleteModeChange("single")}
            >
              <Group gap="sm">
                <Box
                  w={16}
                  h={16}
                  style={{
                    borderRadius: "50%",
                    border: "2px solid var(--mantine-color-blue-6)",
                    backgroundColor:
                      deleteMode === "single"
                        ? "var(--mantine-color-blue-6)"
                        : "transparent",
                  }}
                />
                <div>
                  <Text size="sm" fw={500}>
                    Kun denne forekomst
                  </Text>
                  <Text size="xs" c="dimmed">
                    Slet kun bookingen for denne specifikke dag
                  </Text>
                </div>
              </Group>
            </Paper>
            <Paper
              withBorder
              p="sm"
              style={{
                cursor: "pointer",
                borderColor:
                  deleteMode === "all"
                    ? "var(--mantine-color-red-6)"
                    : undefined,
                backgroundColor:
                  deleteMode === "all"
                    ? "var(--mantine-color-red-0)"
                    : undefined,
              }}
              onClick={() => onDeleteModeChange("all")}
            >
              <Group gap="sm">
                <Box
                  w={16}
                  h={16}
                  style={{
                    borderRadius: "50%",
                    border: "2px solid var(--mantine-color-red-6)",
                    backgroundColor:
                      deleteMode === "all"
                        ? "var(--mantine-color-red-6)"
                        : "transparent",
                  }}
                />
                <div>
                  <Text size="sm" fw={500}>
                    Alle forekomster
                  </Text>
                  <Text size="xs" c="dimmed">
                    Slet hele den tilbagevendende booking
                  </Text>
                </div>
              </Group>
            </Paper>
          </Stack>
        )}

        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={() => {
              onClose()
              onDeleteModeChange("all")
            }}
          >
            Annuller
          </Button>
          <Button color="red" onClick={onConfirm} loading={isPending}>
            {isRecurring && deleteMode === "single"
              ? "Slet denne forekomst"
              : "Slet"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
