import { useState } from "react"
import { useNavigate } from "react-router-dom"
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
  Badge,
  NumberInput,
  Textarea,
  Modal,
  Avatar,
  SegmentedControl,
  Tabs,
  ActionIcon,
  Menu,
} from "@mantine/core"
import { DateInput } from "@mantine/dates"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconArrowLeft,
  IconPlus,
  IconTicket,
  IconPhone,
  IconDotsVertical,
  IconTrash,
  IconWallet,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import { foodApi } from "../api/food"
import type { FoodTicket, CreateFoodTicketData } from "../types"

export default function FoodTicketsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false)

  const { data: availableTickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ["food", "tickets", "available"],
    queryFn: () => foodApi.getTickets(),
  })

  const { data: myTickets, isLoading: myTicketsLoading } = useQuery({
    queryKey: ["food", "tickets", "my"],
    queryFn: foodApi.getMyTickets,
  })

  const isLoading = ticketsLoading || myTicketsLoading

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/mad")}
        mb="md"
      >
        Tilbage til mad
      </Button>

      <Group justify="space-between" mb="xl">
        <div>
          <Title order={1}>Madbilletter</Title>
          <Text c="dimmed">Byt ubrugte måltider med andre</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Tilbyd billet
        </Button>
      </Group>

      <Tabs defaultValue="available">
        <Tabs.List mb="md">
          <Tabs.Tab value="available" leftSection={<IconTicket size={16} />}>
            Tilgængelige ({availableTickets?.length || 0})
          </Tabs.Tab>
          <Tabs.Tab value="my">
            Mine billetter ({myTickets?.length || 0})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="available">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : availableTickets?.length === 0 ? (
            <Paper withBorder p="xl" radius="md">
              <Center>
                <Stack align="center" gap="xs">
                  <IconTicket size={48} color="gray" />
                  <Text c="dimmed">
                    Ingen billetter tilgængelige i øjeblikket.
                  </Text>
                </Stack>
              </Center>
            </Paper>
          ) : (
            <Stack gap="md">
              {availableTickets?.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} showClaim />
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="my">
          {isLoading ? (
            <Center h={200}>
              <Loader size="lg" />
            </Center>
          ) : myTickets?.length === 0 ? (
            <Paper withBorder p="xl" radius="md">
              <Center>
                <Stack align="center" gap="xs">
                  <IconTicket size={48} color="gray" />
                  <Text c="dimmed">Du har ingen billetter.</Text>
                  <Button onClick={openCreateModal} mt="sm">
                    Tilbyd en billet
                  </Button>
                </Stack>
              </Center>
            </Paper>
          ) : (
            <Stack gap="md">
              {myTickets?.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} showActions />
              ))}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>

      <CreateTicketModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })
          closeCreateModal()
        }}
      />
    </>
  )
}

interface TicketCardProps {
  ticket: FoodTicket
  showClaim?: boolean
  showActions?: boolean
}

function TicketCard({ ticket, showClaim, showActions }: TicketCardProps) {
  const queryClient = useQueryClient()
  const [buyModalOpened, { open: openBuyModal, close: closeBuyModal }] =
    useDisclosure(false)

  const claimMutation = useMutation({
    mutationFn: () => foodApi.claimTicket(ticket.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })
      closeBuyModal()
      if (ticket.is_own) {
        notifications.show({
          title: "Billet tilbagekaldt",
          message:
            "Du har tilbagekaldt din billet og kan nu tilmelde dig måltidet igen.",
          color: "green",
        })
      } else {
        notifications.show({
          title: "Billet købt",
          message: "Husk at betale ejeren via MobilePay eller kontant.",
          color: "green",
        })
      }
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke købe billet.",
        color: "red",
      })
    },
  })

  const releaseMutation = useMutation({
    mutationFn: () => foodApi.releaseTicket(ticket.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })
      notifications.show({
        title: "Billet frigivet",
        message: "Billetten er nu tilgængelig igen.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke frigive billet.",
        color: "red",
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => foodApi.deleteTicket(ticket.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "tickets"] })
      notifications.show({
        title: "Billet slettet",
        message: "Din billet er blevet fjernet.",
        color: "blue",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke slette billet.",
        color: "red",
      })
    },
  })

  const isClaimed = !ticket.is_available
  const isOwner = ticket.is_own
  const isClaimedByMe = ticket.claimed_by && !isOwner

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap" style={{ flex: 1 }}>
            <Avatar src={ticket.owner.profile_picture} radius="xl" size="lg">
              {ticket.owner.first_name?.[0]}
              {ticket.owner.last_name?.[0]}
            </Avatar>
            <div style={{ flex: 1 }}>
              <Group gap="xs" mb={4}>
                <Text fw={500}>
                  {ticket.owner.first_name} {ticket.owner.last_name}
                </Text>
                {ticket.is_free ? (
                  <Badge color="green" variant="light">
                    Gratis
                  </Badge>
                ) : (
                  <Badge color="blue" variant="light">
                    {ticket.price} DKK
                  </Badge>
                )}
                {isClaimed && (
                  <Badge color="gray" variant="light">
                    {isOwner ? "Solgt" : "Reserveret"}
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed">
                {ticket.day_name}, {dayjs(ticket.date).format("D. MMM")} •{" "}
                {ticket.total_portions}{" "}
                {ticket.total_portions === 1 ? "portion" : "portioner"}
                {ticket.day_of_week === 2 &&
                  ` • ${ticket.meal_type === "meat" ? "Kød" : "Vegetar"}`}
              </Text>
              {ticket.description && (
                <Text size="sm" mt={4}>
                  {ticket.description}
                </Text>
              )}
              {isClaimed && ticket.claimed_by && (
                <Text size="sm" c="dimmed" mt={4}>
                  {isOwner ? "Købt" : "Reserveret"} af{" "}
                  {ticket.claimed_by.first_name} {ticket.claimed_by.last_name}
                </Text>
              )}
            </div>
          </Group>

          <Group gap="xs">
            {/* Show MobilePay button for claimed tickets with a price */}
            {isClaimed &&
              isClaimedByMe &&
              !ticket.is_free &&
              ticket.owner.phone_number && (
                <Button
                  variant="filled"
                  color="indigo"
                  size="sm"
                  leftSection={<IconWallet size={14} />}
                  component="a"
                  href={`mobilepay://send?phone=${encodeURIComponent(ticket.owner.phone_number)}&amount=${ticket.price}&comment=${encodeURIComponent(`Madbillet ${dayjs(ticket.date).format("D/M")}`)}&lock=1`}
                >
                  Betal {ticket.price} kr
                </Button>
              )}

            {/* Show phone number for claimed tickets */}
            {isClaimed && isClaimedByMe && ticket.owner.phone_number && (
              <Button
                variant="light"
                size="sm"
                leftSection={<IconPhone size={14} />}
                component="a"
                href={`tel:${ticket.owner.phone_number}`}
              >
                {ticket.owner.phone_number}
              </Button>
            )}

            {/* Buy button for available tickets */}
            {showClaim && ticket.is_available && !ticket.is_own && (
              <Button onClick={openBuyModal}>Køb</Button>
            )}

            {/* Actions for owned/claimed tickets */}
            {showActions && (
              <>
                {isClaimedByMe && (
                  <Button
                    variant="light"
                    color="red"
                    onClick={() => releaseMutation.mutate()}
                    loading={releaseMutation.isPending}
                  >
                    Frigiv
                  </Button>
                )}
                {isOwner && ticket.is_available && (
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => claimMutation.mutate()}
                    loading={claimMutation.isPending}
                  >
                    Tilbagekald
                  </Button>
                )}
                {isOwner && (
                  <Menu shadow="md" width={200}>
                    <Menu.Target>
                      <ActionIcon variant="subtle">
                        <IconDotsVertical size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {!ticket.is_available && (
                        <Menu.Item onClick={() => releaseMutation.mutate()}>
                          Frigiv billet
                        </Menu.Item>
                      )}
                      {ticket.is_available && (
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => deleteMutation.mutate()}
                        >
                          Slet
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </>
            )}
          </Group>
        </Group>
      </Paper>

      {/* Buy Modal */}
      <Modal
        opened={buyModalOpened}
        onClose={closeBuyModal}
        title="Køb madbillet"
        centered
      >
        <Stack gap="md">
          <div>
            <Text size="sm" c="dimmed">
              Sælger
            </Text>
            <Group gap="sm">
              <Avatar src={ticket.owner.profile_picture} radius="xl" size="sm">
                {ticket.owner.first_name?.[0]}
                {ticket.owner.last_name?.[0]}
              </Avatar>
              <Text fw={500}>
                {ticket.owner.first_name} {ticket.owner.last_name}
              </Text>
            </Group>
          </div>

          <div>
            <Text size="sm" c="dimmed">
              Billet
            </Text>
            <Text>
              {ticket.day_name}, {dayjs(ticket.date).format("D. MMM")} •{" "}
              {ticket.total_portions}{" "}
              {ticket.total_portions === 1 ? "portion" : "portioner"}
              {ticket.day_of_week === 2 &&
                ` • ${ticket.meal_type === "meat" ? "Kød" : "Vegetar"}`}
            </Text>
          </div>

          <div>
            <Text size="sm" c="dimmed">
              Pris
            </Text>
            <Text fw={500} size="lg">
              {ticket.is_free ? "Gratis" : `${ticket.price} kr`}
            </Text>
          </div>

          {!ticket.is_free && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Betal med MobilePay
              </Text>
              {ticket.owner.phone_number ? (
                <Button
                  variant="filled"
                  color="indigo"
                  leftSection={<IconWallet size={16} />}
                  component="a"
                  href={`mobilepay://send?phone=${encodeURIComponent(ticket.owner.phone_number)}&amount=${ticket.price}&comment=${encodeURIComponent(`Madbillet ${dayjs(ticket.date).format("D/M")}`)}&lock=1`}
                >
                  Åbn MobilePay ({ticket.price} kr)
                </Button>
              ) : (
                <Text size="sm" c="dimmed">
                  Sælger har ikke registreret telefonnummer
                </Text>
              )}
              {ticket.owner.phone_number && (
                <Button
                  variant="light"
                  leftSection={<IconPhone size={16} />}
                  component="a"
                  href={`tel:${ticket.owner.phone_number}`}
                >
                  Ring til {ticket.owner.phone_number}
                </Button>
              )}
            </Stack>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={closeBuyModal}>
              Annuller
            </Button>
            <Button
              onClick={() => claimMutation.mutate()}
              loading={claimMutation.isPending}
            >
              Bekræft køb
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

interface CreateTicketModalProps {
  opened: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateTicketModal({
  opened,
  onClose,
  onSuccess,
}: CreateTicketModalProps) {
  const [date, setDate] = useState<Date | null>(null)
  const [adults, setAdults] = useState(1)
  const [children, setChildren] = useState(0)
  const [mealType, setMealType] = useState<"meat" | "vegetarian">("meat")
  const [description, setDescription] = useState("")

  const createMutation = useMutation({
    mutationFn: (data: CreateFoodTicketData) => foodApi.createTicket(data),
    onSuccess: () => {
      notifications.show({
        title: "Billet oprettet",
        message: "Din billet er nu tilgængelig for andre.",
        color: "green",
      })
      // Reset form
      setDate(null)
      setAdults(1)
      setChildren(0)
      setMealType("meat")
      setDescription("")
      onSuccess()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke oprette billet.",
        color: "red",
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!date) return

    createMutation.mutate({
      date: dayjs(date).format("YYYY-MM-DD"),
      adults_count: adults,
      children_count: children,
      meal_type: mealType,
      description,
    })
  }

  const isWednesday = date ? date.getDay() === 3 : false

  // Filter to only allow Mon-Thu
  const excludeDate = (d: Date) => {
    const day = d.getDay()
    return day === 0 || day === 5 || day === 6 // Exclude Sun, Fri, Sat
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Tilbyd en madbillet"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <DateInput
            label="Dato"
            placeholder="Vælg dato"
            value={date}
            onChange={(value) => {
              const dateValue = value ? new Date(value) : null
              setDate(dateValue)
            }}
            excludeDate={(dateStr) => excludeDate(new Date(dateStr))}
            minDate={new Date()}
            required
          />

          <Group grow>
            <NumberInput
              label="Voksne"
              value={adults}
              onChange={(val) => setAdults(Number(val) || 0)}
              min={0}
              max={10}
            />
            <NumberInput
              label="Børn"
              value={children}
              onChange={(val) => setChildren(Number(val) || 0)}
              min={0}
              max={10}
            />
          </Group>

          {isWednesday && (
            <div>
              <Text size="sm" fw={500} mb={4}>
                Måltidstype
              </Text>
              <SegmentedControl
                value={mealType}
                onChange={(val) => setMealType(val as "meat" | "vegetarian")}
                data={[
                  { label: "Kød", value: "meat" },
                  { label: "Vegetar", value: "vegetarian" },
                ]}
                fullWidth
              />
            </div>
          )}

          <Textarea
            label="Note (valgfrit)"
            placeholder="Yderligere information..."
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Annuller
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!date || (adults === 0 && children === 0)}
            >
              Opret billet
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
