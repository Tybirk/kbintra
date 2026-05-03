import { useState } from "react"

import {
  Container,
  Title,
  SimpleGrid,
  Card,
  Text,
  Button,
  Stack,
  Alert,
  Code,
  List,
} from "@mantine/core"

import { IconDatabase, IconPhoto, IconInfoCircle } from "@tabler/icons-react"

import { getAccessToken } from "../api/client"

function useFileDownload() {
  const [loading, setLoading] = useState<string | null>(null)

  const download = async (path: string, filename: string) => {
    setLoading(path)

    try {
      const token = getAccessToken()

      const response = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) throw new Error("Download fejlede")

      const blob = await response.blob()

      const url = URL.createObjectURL(blob)

      const link = document.createElement("a")

      link.href = url

      link.download = filename

      link.click()

      URL.revokeObjectURL(url)
    } finally {
      setLoading(null)
    }
  }

  return { download, loading }
}

export default function AdminPage() {
  const { download, loading } = useFileDownload()

  return (
    <Container size="sm">
      <Title order={2} mb="lg">
        Administration
      </Title>
      <SimpleGrid cols={2} mb="xl">
        <Card withBorder padding="lg">
          <Stack align="center" gap="md">
            <IconDatabase size={40} />
            <Text fw={500}>Database</Text>
            <Text size="sm" c="dimmed" ta="center">
              Download en kopi af databasen (SQLite)
            </Text>
            <Button
              onClick={() =>
                download("/api/auth/admin/download-db/", "db.sqlite3")
              }
              loading={loading === "/api/auth/admin/download-db/"}
              fullWidth
            >
              Download database
            </Button>
          </Stack>
        </Card>
        <Card withBorder padding="lg">
          <Stack align="center" gap="md">
            <IconPhoto size={40} />
            <Text fw={500}>Mediefiler</Text>
            <Text size="sm" c="dimmed" ta="center">
              Download midlertidigt deaktiveret
            </Text>
            <Button fullWidth disabled>
              Download mediefiler
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>

      <Alert
        icon={<IconInfoCircle size={20} />}
        title="Sådan bruger du filerne til lokal udvikling"
        variant="light"
      >
        <List size="sm" spacing="xs">
          <List.Item>
            Download begge filer og placer dem i projektets{" "}
            <Code>backend/</Code> mappe:
          </List.Item>
          <List.Item>
            <Code>db.sqlite3</Code> lægges direkte i <Code>backend/</Code>
          </List.Item>
          <List.Item>
            Udpak <Code>media.zip</Code> til <Code>backend/media/</Code>
          </List.Item>
          <List.Item>
            Start backend med <Code>uv run python manage.py runserver</Code>
          </List.Item>
          <List.Item>
            Nu har du en lokal kopi af produktionsdata at udvikle med
          </List.Item>
        </List>
      </Alert>
    </Container>
  )
}
