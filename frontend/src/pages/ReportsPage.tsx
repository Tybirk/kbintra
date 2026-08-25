import { Container, Text, Title } from "@mantine/core"

import { ReportQueue } from "./reports/ReportQueue"

export default function ReportsPage() {
  return (
    <Container size="md" py="md">
      <Title order={2} mb="xs">
        Indrapportering
      </Title>
      {/* Kept to one line: on a 375px phone the two-sentence version wrapped to
          four lines, and at 320px to five, spending the top of the screen on
          prose a resident reads once. */}
      <Text size="sm" c="dimmed" mb="md">
        Meld noget i stykker, noget der ikke virker, eller noget vi mangler — så
        kan alle følge sagen.
      </Text>
      <ReportQueue />
    </Container>
  )
}
