import { useMemo, useState } from "react"

import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Container,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Timeline,
  Title,
} from "@mantine/core"

import { DateInput } from "@mantine/dates"

import { useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import {
  IconArrowLeft,
  IconCheck,
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import dayjs from "dayjs"

import { Link } from "react-router-dom"

import { handoversApi, housesApi } from "../api/houses"

import type {
  Handover,
  HandoverIncomingInput,
  HandoverInvitation,
  House,
  UserSummary,
} from "../types"

import { showErrorNotification } from "../utils/errorNotification"

const QUERY_KEY = ["handovers"]

const ISO = "YYYY-MM-DD"

function formatDay(iso: string): string {
  return dayjs(iso).format("D. MMMM YYYY")
}

function houseNumber(house: House): number {
  const parts = house.name.split(" ")

  return Number(parts[parts.length - 1]) || 0
}

/** The people who can move out: a deactivated account still in the house can't. */
function activeInhabitants(house: House | undefined): UserSummary[] {
  return (house?.inhabitants ?? []).filter((u) => u.is_active !== false)
}

function emptyPerson(): HandoverIncomingInput {
  return { first_name: "", last_name: "", email: "", phone_number: "" }
}

interface StatusStyle {
  label: string
  color: string
}

const INVITATION_STATUS: Record<HandoverInvitation["status"], StatusStyle> = {
  scheduled: { label: "Planlagt", color: "gray" },
  sent: { label: "Sendt", color: "blue" },
  expired: { label: "Udløbet", color: "orange" },
  registered: { label: "Oprettet", color: "green" },
}

export default function HandoverPage() {
  const [formOpen, setFormOpen] = useState(false)

  const { data: handovers, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: handoversApi.list,
  })

  return (
    <Container size="sm">
      <Anchor component={Link} to="/drift" size="sm" mb="xs">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          Administration
        </Group>
      </Anchor>

      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Title order={2}>Ind- og udflytning</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setFormOpen(true)}
        >
          Ny
        </Button>
      </Group>

      <Text size="sm" c="dimmed" mb="lg">
        Når et hus skifter hænder: vælg hvem der flytter ud, og hvem der flytter
        ind. Resten sker af sig selv på de valgte dage.
      </Text>

      {isLoading && <Loader />}

      <Stack>
        {handovers?.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            Ingen ind- eller udflytninger endnu.
          </Text>
        )}
        {handovers?.map((handover) => (
          <HandoverCard key={handover.id} handover={handover} />
        ))}
      </Stack>

      <HandoverFormModal opened={formOpen} onClose={() => setFormOpen(false)} />
    </Container>
  )
}

function HandoverCard({ handover }: { handover: Handover }) {
  const queryClient = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)

  const [confirmCancel, setConfirmCancel] = useState(false)

  const invitationsSent = handover.invitations.some((i) => i.sent_at)

  const done = Boolean(handover.access_ended_at)

  const resend = useMutation({
    mutationFn: handoversApi.resendInvitation,
    onSuccess: (updated) => {
      queryClient.setQueryData<Handover[]>(QUERY_KEY, (old) =>
        old?.map((h) => (h.id === updated.id ? updated : h)),
      )

      notifications.show({
        message: "Invitationen er sendt igen.",
        color: "green",
      })
    },
    onError: (error) =>
      showErrorNotification(error, "Kunne ikke sende invitationen."),
  })

  const cancel = useMutation({
    mutationFn: () => handoversApi.cancel(handover.id),
    onSuccess: () => {
      setConfirmCancel(false)

      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error) => showErrorNotification(error, "Kunne ikke annullere."),
  })

  // A step that has run shows the day it actually ran: a handover registered
  // late sends its invitations today, not on the invite day already passed.
  const firstSent = handover.invitations
    .map((i) => i.sent_at)
    .filter((d): d is string => Boolean(d))
    .sort()[0]

  const steps = [
    {
      key: "invite",
      show: handover.invitations.length > 0,
      done: invitationsSent,
      title: invitationsSent ? "Invitationer sendt" : "Invitationer sendes",
      when: formatDay(firstSent ?? handover.invite_on),
    },
    {
      key: "reset",
      show: handover.reset_household,
      done: Boolean(handover.household_reset_at),
      title: handover.household_reset_at
        ? "Husets oplysninger nulstillet"
        : "Husets oplysninger nulstilles",
      // The old household keeps its things until a newcomer takes the house over.
      when: handover.household_reset_at
        ? formatDay(handover.household_reset_at)
        : handover.invitations.length > 0
          ? `Når den første nye beboer logger ind, senest ${formatDay(handover.handover_date)}`
          : formatDay(handover.handover_date),
    },
    {
      key: "move",
      show: true,
      done: Boolean(handover.moved_out_at),
      title: handover.outgoing.length > 0 ? "Fraflytning" : "Overtagelse",
      when: formatDay(handover.handover_date),
    },
    {
      key: "access",
      show: handover.outgoing.length > 0,
      done,
      title: done ? "Adgang lukket" : "Fraflyttede har adgang til og med",
      when: formatDay(handover.access_ended_at ?? handover.access_until),
    },
  ].filter((step) => step.show)

  const active = steps.filter((step) => step.done).length - 1

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="sm" wrap="nowrap" align="flex-start">
        <div>
          <Anchor
            component={Link}
            to={`/beboere/hus/${handover.house_slug}`}
            fw={600}
          >
            {handover.house_name}
          </Anchor>
          <Text size="sm" c="dimmed">
            Overtagelse {formatDay(handover.handover_date)}
          </Text>
        </div>
        <Badge
          color={done ? "gray" : handover.moved_out_at ? "blue" : "yellow"}
          style={{ flexShrink: 0 }}
        >
          {done
            ? "Afsluttet"
            : handover.moved_out_at
              ? "Fraflyttet"
              : "Planlagt"}
        </Badge>
      </Group>

      <Timeline active={active} bulletSize={18} lineWidth={2} mb="md">
        {steps.map((step) => (
          <Timeline.Item
            key={step.key}
            bullet={step.done ? <IconCheck size={12} /> : null}
            title={<Text size="sm">{step.title}</Text>}
          >
            <Text size="xs" c="dimmed">
              {step.when}
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>

      {handover.outgoing.length > 0 && (
        <Stack gap={4} mb="sm">
          <Text size="sm" fw={500}>
            Flytter ud
          </Text>
          {handover.outgoing.map((person) => (
            <div key={person.id}>
              <Text size="sm">
                {person.first_name} {person.last_name}
                {!person.is_active && (
                  <Text span size="xs" c="dimmed">
                    {" "}
                    · ikke længere adgang
                  </Text>
                )}
              </Text>
              {person.upcoming_food_shifts.length > 0 && (
                <Text size="xs" c="orange">
                  Står på madhold{" "}
                  {person.upcoming_food_shifts
                    .map((d) => dayjs(d).format("D/M"))
                    .join(", ")}{" "}
                  og tages af holdet ved fraflytningen. Giv madholdsansvarlig
                  besked.
                </Text>
              )}
            </div>
          ))}
        </Stack>
      )}

      {handover.invitations.length > 0 && (
        <Stack gap={6} mb="sm">
          <Text size="sm" fw={500}>
            Flytter ind
          </Text>
          {handover.invitations.map((invitation) => {
            const status = INVITATION_STATUS[invitation.status]

            return (
              <Group
                key={invitation.id}
                justify="space-between"
                wrap="nowrap"
                gap="xs"
                align="flex-start"
              >
                <div style={{ minWidth: 0 }}>
                  <Text size="sm">
                    {invitation.first_name} {invitation.last_name}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
                    {invitation.email}
                  </Text>
                  {invitation.phone_number && (
                    <Text size="xs" c="dimmed">
                      {invitation.phone_number}
                    </Text>
                  )}
                </div>
                <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
                  <Badge color={status.color} variant="light">
                    {status.label}
                  </Badge>
                  {(invitation.status === "sent" ||
                    invitation.status === "expired") && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      loading={
                        resend.isPending && resend.variables === invitation.id
                      }
                      onClick={() => resend.mutate(invitation.id)}
                    >
                      Send igen
                    </Button>
                  )}
                </Stack>
              </Group>
            )
          })}
        </Stack>
      )}

      {!done && (
        <Group gap="xs" mt="xs">
          <Button size="xs" variant="default" onClick={() => setEditOpen(true)}>
            Ret datoer
          </Button>
          {handover.can_cancel && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => setConfirmCancel(true)}
            >
              Annullér
            </Button>
          )}
        </Group>
      )}

      <EditDatesModal
        handover={handover}
        opened={editOpen}
        onClose={() => setEditOpen(false)}
      />

      <Modal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Annullér ind- og udflytning?"
      >
        <Text size="sm" mb="md">
          Intet er sket endnu, så den kan annulleres uden følger. Invitationerne
          bliver ikke sendt.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmCancel(false)}>
            Behold
          </Button>
          <Button
            color="red"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Annullér
          </Button>
        </Group>
      </Modal>
    </Card>
  )
}

function EditDatesModal({
  handover,
  opened,
  onClose,
}: {
  handover: Handover
  opened: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const [handoverDate, setHandoverDate] = useState<string | null>(
    handover.handover_date,
  )

  const [inviteOn, setInviteOn] = useState<string | null>(handover.invite_on)

  const [accessUntil, setAccessUntil] = useState<string | null>(
    handover.access_until,
  )

  const invitationsSent = handover.invitations.some((i) => i.sent_at)

  const save = useMutation({
    mutationFn: () =>
      handoversApi.updateDates(handover.id, {
        ...(handoverDate !== handover.handover_date && handoverDate
          ? { handover_date: handoverDate }
          : {}),
        ...(inviteOn !== handover.invite_on && inviteOn
          ? { invite_on: inviteOn }
          : {}),
        ...(accessUntil !== handover.access_until && accessUntil
          ? { access_until: accessUntil }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })

      onClose()
    },
    onError: (error) =>
      showErrorNotification(error, "Kunne ikke gemme datoerne."),
  })

  return (
    <Modal opened={opened} onClose={onClose} title="Ret datoer">
      <Stack>
        <DateInput
          label="Overtagelsesdag"
          value={handoverDate}
          onChange={setHandoverDate}
          valueFormat="D. MMMM YYYY"
          disabled={Boolean(handover.moved_out_at)}
        />
        {handover.invitations.length > 0 && (
          <DateInput
            label="Invitationerne sendes"
            value={inviteOn}
            onChange={setInviteOn}
            valueFormat="D. MMMM YYYY"
            disabled={invitationsSent || Boolean(handover.household_reset_at)}
          />
        )}
        {handover.outgoing.length > 0 && (
          <DateInput
            label="Fraflyttede har adgang til og med"
            value={accessUntil}
            onChange={setAccessUntil}
            valueFormat="D. MMMM YYYY"
          />
        )}
        <Text size="xs" c="dimmed">
          En dato, der er nået, sker med det samme, når du gemmer.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Fortryd
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Gem
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function HandoverFormModal({
  opened,
  onClose,
}: {
  opened: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const isMobile = useMediaQuery("(max-width: 768px)")

  const today = dayjs().format(ISO)

  const [houseSlug, setHouseSlug] = useState<string | null>(null)

  const [outgoing, setOutgoing] = useState<string[]>([])

  const [handoverDate, setHandoverDate] = useState<string | null>(today)

  const [inviteDaysBefore, setInviteDaysBefore] = useState<number>(2)

  const [accessDays, setAccessDays] = useState<number>(30)

  const [resetHousehold, setResetHousehold] = useState(true)

  const [incoming, setIncoming] = useState<HandoverIncomingInput[]>([
    emptyPerson(),
  ])

  const [previewOpen, setPreviewOpen] = useState(false)

  const { data: houses } = useQuery({
    queryKey: ["houses"],
    queryFn: housesApi.getHouses,
    enabled: opened,
  })

  const house = houses?.find((h) => h.slug === houseSlug)

  const inhabitants = activeInhabitants(house)

  const everyoneMoves =
    inhabitants.length > 0 && outgoing.length === inhabitants.length

  const day = handoverDate ?? today

  const inviteOn = dayjs(day).subtract(inviteDaysBefore, "day").format(ISO)

  const accessUntil = dayjs(day).add(accessDays, "day").format(ISO)

  const people = incoming.filter((p) => p.first_name.trim() || p.email.trim())

  const houseOptions = useMemo(
    () =>
      [...(houses ?? [])]
        .sort((a, b) => houseNumber(a) - houseNumber(b))
        .map((h) => ({ value: h.slug, label: h.name })),
    [houses],
  )

  const { data: preview } = useQuery({
    queryKey: ["handovers", "preview", people[0]?.first_name ?? ""],
    queryFn: () => handoversApi.invitationPreview(people[0]?.first_name ?? ""),
    enabled: previewOpen,
  })

  const reset = () => {
    setHouseSlug(null)

    setOutgoing([])

    setHandoverDate(today)

    setInviteDaysBefore(2)

    setAccessDays(30)

    setResetHousehold(true)

    setIncoming([emptyPerson()])
  }

  const create = useMutation({
    mutationFn: () =>
      handoversApi.create({
        house: houseSlug ?? "",
        handover_date: day,
        invite_on: inviteOn,
        access_until: accessUntil,
        reset_household: everyoneMoves && resetHousehold,
        outgoing: outgoing.map(Number),
        incoming: people.map((p) => ({
          ...p,
          email: p.email.trim(),
          first_name: p.first_name.trim(),
          last_name: p.last_name.trim(),
          phone_number: p.phone_number.trim(),
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })

      queryClient.invalidateQueries({ queryKey: ["houses"] })

      notifications.show({ message: "Gemt.", color: "green" })

      reset()

      onClose()
    },
    onError: (error) => showErrorNotification(error, "Kunne ikke gemme."),
  })

  const selectHouse = (slug: string | null) => {
    setHouseSlug(slug)

    const chosen = houses?.find((h) => h.slug === slug)

    setOutgoing(activeInhabitants(chosen).map((u) => String(u.id)))

    setResetHousehold(true)
  }

  const updatePerson = (
    index: number,
    field: keyof HandoverIncomingInput,
    value: string,
  ) => {
    setIncoming((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    )
  }

  const whenText = (iso: string) =>
    iso <= today ? "med det samme" : formatDay(iso)

  const children = house?.children?.length ?? 0

  const cars = house?.cars?.length ?? 0

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Ny ind- og udflytning"
      // Escape on the mail preview must close only the preview, not the form.
      closeOnEscape={!previewOpen}
      fullScreen={isMobile}
      size="lg"
    >
      <Stack>
        <Select
          label="Hus"
          placeholder="Vælg hus"
          data={houseOptions}
          value={houseSlug}
          onChange={selectHouse}
          searchable
          nothingFoundMessage="Intet hus"
        />

        <DateInput
          label="Overtagelsesdag"
          description="Dagen, huset skifter hænder"
          value={handoverDate}
          onChange={setHandoverDate}
          valueFormat="D. MMMM YYYY"
        />

        {house && (
          <Checkbox.Group
            label="Flytter ud"
            description={
              inhabitants.length === 0
                ? "Der bor ingen i huset."
                : "Mister huset på overtagelsesdagen"
            }
            value={outgoing}
            onChange={setOutgoing}
          >
            <Stack gap={6} mt="xs">
              {inhabitants.map((u) => (
                <Checkbox
                  key={u.id}
                  value={String(u.id)}
                  label={`${u.first_name} ${u.last_name}`}
                />
              ))}
            </Stack>
          </Checkbox.Group>
        )}

        {outgoing.length > 0 && (
          <NumberInput
            label="Fraflyttede beholder adgang i"
            rightSection={<Text size="sm">dage</Text>}
            rightSectionWidth={50}
            min={0}
            max={365}
            value={accessDays}
            onChange={(v) => setAccessDays(Number(v) || 0)}
            description={`Kan logge ind til og med ${formatDay(accessUntil)}, derefter lukkes kontoen (den slettes ikke).`}
          />
        )}

        {house && everyoneMoves && (
          <Checkbox
            label="Nulstil husets oplysninger"
            description={`Fjerner ${children} børn, ${cars} biler, husets beskrivelse og billede samt madpræferencer, før de nye beboere får adgang.`}
            checked={resetHousehold}
            onChange={(e) => setResetHousehold(e.currentTarget.checked)}
          />
        )}

        <div>
          <Text size="sm" fw={500}>
            Flytter ind
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Får en invitation på mail med et link og en kort tjekliste.
          </Text>
          <Stack gap="sm">
            {incoming.map((person, index) => (
              <Card key={index} withBorder padding="sm">
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
                  <TextInput
                    label="Fornavn"
                    value={person.first_name}
                    onChange={(e) =>
                      updatePerson(index, "first_name", e.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Efternavn"
                    value={person.last_name}
                    onChange={(e) =>
                      updatePerson(index, "last_name", e.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Email"
                    type="email"
                    value={person.email}
                    onChange={(e) =>
                      updatePerson(index, "email", e.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Telefon"
                    type="tel"
                    value={person.phone_number}
                    onChange={(e) =>
                      updatePerson(index, "phone_number", e.currentTarget.value)
                    }
                  />
                </SimpleGrid>
                {incoming.length > 1 && (
                  <Group justify="flex-end" mt="xs">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Fjern person"
                      onClick={() =>
                        setIncoming((rows) =>
                          rows.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                )}
              </Card>
            ))}
            <Group justify="space-between">
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => setIncoming((rows) => [...rows, emptyPerson()])}
              >
                Tilføj person
              </Button>
              <Anchor
                size="xs"
                component="button"
                type="button"
                onClick={() => setPreviewOpen(true)}
              >
                Se invitationsmailen
              </Anchor>
            </Group>
          </Stack>
        </div>

        {people.length > 0 && (
          <NumberInput
            label="Send invitationerne"
            rightSection={<Text size="sm">dage før</Text>}
            rightSectionWidth={70}
            min={0}
            max={30}
            value={inviteDaysBefore}
            onChange={(v) => setInviteDaysBefore(Number(v) || 0)}
            description={`Sendes ${whenText(inviteOn)}. Linket virker i 14 dage.`}
          />
        )}

        <Alert variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Fraflyttede forsvinder fra beboeroversigten, madhold og fødselsdage,
            og får kun beskeder, der handler om dem selv. Nye beboere holder
            pause fra madhold den første måned. Medlemskab af grupper (fx
            bestyrelsen) fjernes ikke af sig selv.
          </Text>
        </Alert>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Fortryd
          </Button>
          <Button
            loading={create.isPending}
            disabled={
              !houseSlug || (outgoing.length === 0 && people.length === 0)
            }
            onClick={() => create.mutate()}
          >
            Gem
          </Button>
        </Group>
      </Stack>

      <Modal
        opened={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={preview?.subject ?? "Invitationsmail"}
        size="lg"
      >
        {preview ? (
          <Code block style={{ whiteSpace: "pre-wrap" }}>
            {preview.body}
          </Code>
        ) : (
          <Loader />
        )}
      </Modal>
    </Modal>
  )
}
