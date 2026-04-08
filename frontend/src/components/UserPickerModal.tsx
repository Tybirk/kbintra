import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Modal,
  Stack,
  Group,
  Badge,
  Avatar,
  Box,
  TextInput,
  ScrollArea,
  Paper,
  Text,
  Button,
} from "@mantine/core"
import { IconSearch } from "@tabler/icons-react"
import { apiClient } from "../api/client"
import type { User } from "../types"

interface UserPickerModalProps {
  opened: boolean
  onClose: () => void
  onConfirm: (userIds: number[]) => void
  title: string
  confirmLabel: string
  excludeUserIds?: number[]
  loading?: boolean
}

export default function UserPickerModal({
  opened,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  excludeUserIds,
  loading,
}: UserPickerModalProps) {
  const [search, setSearch] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])

  const excludedIds = new Set(excludeUserIds ?? [])

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await apiClient.get("/users/")
      return (response.data.results ?? response.data) as User[]
    },
    enabled: opened,
  })

  const searchTerm = search.trim().toLowerCase()
  const filteredUsers = users?.filter((u) => {
    if (excludedIds.has(u.id)) return false
    if (selectedUsers.some((s) => s.id === u.id)) return false
    if (!searchTerm) return true
    const firstName = (u.first_name || "").toLowerCase()
    const lastName = (u.last_name || "").toLowerCase()
    const fullName = `${firstName} ${lastName}`
    return (
      firstName.includes(searchTerm) ||
      lastName.includes(searchTerm) ||
      fullName.includes(searchTerm)
    )
  })

  const handleSelectUser = (user: User) => {
    setSelectedUsers((prev) => [...prev, user])
    setSearch("")
  }

  const handleRemoveUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  const handleConfirm = () => {
    if (selectedUsers.length === 0) return
    onConfirm(selectedUsers.map((u) => u.id))
  }

  const handleClose = () => {
    setSearch("")
    setSelectedUsers([])
    onClose()
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="md">
      <Stack gap="md">
        {selectedUsers.length > 0 && (
          <Group gap="xs">
            {selectedUsers.map((u) => (
              <Badge
                key={u.id}
                size="lg"
                variant="light"
                leftSection={
                  <Avatar src={u.profile_picture} size={20} radius="xl">
                    {u.first_name?.[0]}
                  </Avatar>
                }
                rightSection={
                  <Box
                    component="span"
                    style={{ cursor: "pointer", marginLeft: 4 }}
                    onClick={() => handleRemoveUser(u.id)}
                  >
                    x
                  </Box>
                }
                styles={{
                  root: { paddingLeft: 4, paddingRight: 8 },
                  section: { marginRight: 4 },
                }}
              >
                {u.first_name} {u.last_name}
              </Badge>
            ))}
          </Group>
        )}

        <TextInput
          placeholder="Søg brugere..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <ScrollArea h={200}>
          <Stack gap="xs">
            {filteredUsers?.map((u) => (
              <Paper
                key={u.id}
                p="sm"
                withBorder
                style={{ cursor: "pointer" }}
                onClick={() => handleSelectUser(u)}
              >
                <Group gap="sm">
                  <Avatar src={u.profile_picture} radius="xl" size="md">
                    {u.first_name?.[0]}
                    {u.last_name?.[0]}
                  </Avatar>
                  <div>
                    <Text fw={500}>
                      {u.first_name} {u.last_name}
                    </Text>
                    {u.house_name && (
                      <Text size="xs" c="dimmed">
                        {u.house_name}
                      </Text>
                    )}
                  </div>
                </Group>
              </Paper>
            ))}
            {filteredUsers?.length === 0 && (
              <Text c="dimmed" ta="center" py="md">
                Ingen brugere fundet
              </Text>
            )}
          </Stack>
        </ScrollArea>

        <Group justify="flex-end">
          <Button variant="light" onClick={handleClose}>
            Annuller
          </Button>
          <Button
            onClick={handleConfirm}
            loading={loading}
            disabled={selectedUsers.length === 0}
          >
            {confirmLabel}
            {selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ""}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
