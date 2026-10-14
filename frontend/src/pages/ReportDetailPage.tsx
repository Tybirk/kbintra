import { useState } from "react"

import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Container,
  Divider,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { IconTrash } from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import dayjs from "dayjs"

import { useNavigate, useParams } from "react-router-dom"

import { reportsApi } from "../api/reports"

import { BackButton } from "../components/BackButton"

import UserLink from "../components/UserLink"

import {
  LocationLine,
  PhotoStrip,
  STATUS_META,
  STATUS_ORDER,
  StatusBadge,
} from "./reports/shared"

import type { Report, ReportEvent, ReportStatus } from "../types"

export default function ReportDetailPage() {
  const { subgroupSlug = "", number = "" } = useParams()
  const caseNumber = Number(number)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: report, isLoading } = useQuery({
    queryKey: ["reports", "detail", subgroupSlug, caseNumber],
    queryFn: () => reportsApi.get(subgroupSlug, caseNumber),
    enabled: Boolean(subgroupSlug) && Number.isFinite(caseNumber),
  })

  const removeMutation = useMutation({
    mutationFn: () => reportsApi.remove(subgroupSlug, caseNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] })
      notifications.show({ message: "Sagen er slettet.", color: "green" })
      navigate("/indrapportering")
    },
  })

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  if (!report) {
    return (
      <Container size="md" py="md">
        <BackButton to="/indrapportering" label="Indrapportering" />
        <Alert color="red" mt="md">
          Sagen findes ikke.
        </Alert>
      </Container>
    )
  }

  return (
    <Container size="md" py="md">
      <BackButton to="/indrapportering" label="Indrapportering" />

      {/* The heading identifies the CASE. It used to be the committee name,
          which was identical on every case and the largest text on the page,
          while the case number was the smallest grey badge on it. */}
      <Title order={3} mt="md" mb={6}>
        #{report.number} · {report.kind_display}
      </Title>

      <Group gap="xs" mb="xs" wrap="wrap">
        <StatusBadge status={report.status} />
        <Text size="sm" c="dimmed">
          {report.subgroup.name}
        </Text>
      </Group>

      <Card withBorder radius="md" padding="md" mb="md">
        <Stack gap="sm">
          <Text style={{ whiteSpace: "pre-wrap" }}>{report.description}</Text>

          <LocationLine location={report.location} size="sm" />

          {report.photos.length > 0 && <PhotoStrip photos={report.photos} />}

          <Divider />

          <Group justify="space-between" wrap="wrap">
            <Text size="sm" c="dimmed">
              Indrapporteret af{" "}
              {report.submitted_by ? (
                <UserLink
                  id={report.submitted_by.id}
                  firstName={report.submitted_by.first_name}
                  lastName={report.submitted_by.last_name}
                  size="sm"
                />
              ) : (
                report.reporter_name
              )}{" "}
              den {dayjs(report.created_at).format("D. MMMM YYYY [kl.] HH:mm")}
            </Text>
            {report.can_edit && (
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                leftSection={<IconTrash size={14} />}
                loading={removeMutation.isPending}
                onClick={() => removeMutation.mutate()}
              >
                Slet
              </Button>
            )}
          </Group>

          {report.legacy_url && (
            <Text size="xs" c="dimmed">
              Oprindeligt indmeldt i Driftsudvalgets tidligere system.{" "}
              <Anchor href={report.legacy_url} target="_blank" size="xs">
                Se den gamle sag
              </Anchor>
            </Text>
          )}
        </Stack>
      </Card>

      <ReportLog report={report} />
      <UpdateForm report={report} />
    </Container>
  )
}

// --- Log ---------------------------------------------------------------------

function eventHeading(event: ReportEvent): string {
  const who = event.author
    ? `${event.author.first_name} ${event.author.last_name}`.trim()
    : "Systemet"
  if (event.kind === "created") return `${who} oprettede sagen`
  if (event.kind === "status") {
    const from = event.old_status_display || "—"
    return `${who}: ${from} → ${event.new_status_display}`
  }
  return who
}

function ReportLog({ report }: { report: Report }) {
  const events = report.events ?? []
  if (events.length === 0) return null

  return (
    <Stack gap="xs" mb="md">
      <Title order={5}>Log</Title>
      {events.map((event) => (
        <Card key={event.id} withBorder radius="md" padding="sm">
          <Group justify="space-between" wrap="wrap" gap={4}>
            <Text size="sm" fw={500}>
              {eventHeading(event)}
            </Text>
            <Text size="xs" c="dimmed">
              {dayjs(event.created_at).format("D. MMM YYYY [kl.] HH:mm")}
            </Text>
          </Group>
          {event.message && (
            <Text size="sm" mt={4} style={{ whiteSpace: "pre-wrap" }}>
              {event.message}
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  )
}

// --- Update form -------------------------------------------------------------

/**
 * One form for both a status change and a comment.
 *
 * Any resident can write; the status dropdown only appears for the udvalg's own
 * members. That is the whole permission model, visible in one place.
 */
function UpdateForm({ report }: { report: Report }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ReportStatus>(report.status)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      reportsApi.addEvent(report.subgroup.slug, report.number, {
        status:
          report.can_manage && status !== report.status ? status : undefined,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] })
      setMessage("")
      setError("")
    },
    onError: () => setError("Kunne ikke gemme opdateringen. Prøv igen."),
  })

  const statusChanged = report.can_manage && status !== report.status

  function submit() {
    if (!message.trim() && !statusChanged) {
      // A resident has no status control, so telling them to pick one points at
      // nothing they can reach. Same role branch the labels above already make.
      setError(
        report.can_manage
          ? "Skriv en besked eller vælg en ny status."
          : "Skriv en kommentar først.",
      )
      return
    }
    setError("")
    mutation.mutate()
  }

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Title order={5}>Opdatering</Title>

        {report.can_manage && (
          <Select
            label="Status"
            data={STATUS_ORDER.map((value) => ({
              value,
              label: STATUS_META[value].label,
            }))}
            value={status}
            onChange={(value) => setStatus(value as ReportStatus ?? status)}
            allowDeselect={false}
          />
        )}

        <Textarea
          label={report.can_manage ? "Besked (valgfri)" : "Kommentar"}
          placeholder="Tilføj en besked…"
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={8}
        />

        <Text size="xs" c="dimmed">
          {report.can_manage
            ? "Du kan skrive en besked uden at ændre status, eller kombinere begge."
            : "Ved du noget om sagen, kan du skrive det her — udvalget får besked."}
        </Text>

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button onClick={submit} loading={mutation.isPending}>
            {statusChanged ? "Opdater" : "Send kommentar"}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
