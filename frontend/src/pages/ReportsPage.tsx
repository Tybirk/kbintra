import { Container, Text, Title } from "@mantine/core"

import { ReportQueue } from "./reports/ReportQueue"

export default function ReportsPage() {
  return (
    <Container size="md" py="md">
      <Title order={2} mb="xs">
        Indrapportering
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Er noget i fællesarealerne gået i stykker, virker det ikke som det skal,
        eller mangler vi noget? Meld det ind her, så kan alle følge sagen.
      </Text>
      <ReportQueue />
    </Container>
  )
}
