import { useState } from "react"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Stack,
  Typography,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import { IconEdit, IconLink } from "@tabler/icons-react"

import { linksApi } from "../api/links"

import { useAuthStore } from "../store/authStore"

import RichTextEditor from "../components/RichTextEditor"
import { RichTextContent } from "../components/RichTextContent"

export default function LinksPage() {
  const queryClient = useQueryClient()

  const { user } = useAuthStore()

  const [editing, setEditing] = useState(false)

  const [content, setContent] = useState("")

  const {
    data: links,

    isLoading,

    error,
  } = useQuery({
    queryKey: ["links"],

    queryFn: linksApi.getLinks,
  })

  const updateMutation = useMutation({
    mutationFn: linksApi.updateLinks,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["links"] })

      setEditing(false)

      notifications.show({
        title: "Gemt",

        message: "Links er blevet opdateret.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke gemme. Prøv igen.")
    },
  })

  const handleEdit = () => {
    setContent(links?.content ?? "")

    setEditing(true)
  }

  const handleSave = () => {
    updateMutation.mutate(content)
  }

  const handleCancel = () => {
    setEditing(false)
  }

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Kunne ikke indlæse links. Prøv igen.</Text>
      </Center>
    )
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={1}>Nyttige links</Title>
        {user?.is_staff && !editing && (
          <Button
            leftSection={<IconEdit size={16} />}
            variant="light"
            onClick={handleEdit}
          >
            Rediger
          </Button>
        )}
      </Group>

      {editing ? (
        <Stack gap="md">
          <RichTextEditor
            content={content}
            onChange={setContent}
            placeholder="Skriv nyttige links her..."
            minHeight={300}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={handleCancel}>
              Annuller
            </Button>
            <Button onClick={handleSave} loading={updateMutation.isPending}>
              Gem
            </Button>
          </Group>
        </Stack>
      ) : links?.content && links.content !== "<p></p>" ? (
        <Paper withBorder p="lg" radius="md">
          <Typography>
            <RichTextContent html={links.content} />
          </Typography>
        </Paper>
      ) : (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="xs">
              <IconLink size={48} color="gray" />
              <Text c="dimmed">Ingen links tilføjet endnu.</Text>
              {user?.is_staff && (
                <Button onClick={handleEdit} mt="sm">
                  Tilføj links
                </Button>
              )}
            </Stack>
          </Center>
        </Paper>
      )}
    </>
  )
}
