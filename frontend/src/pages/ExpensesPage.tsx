import { useEffect, useMemo, useState } from "react"

import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Collapse,
  Container,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Pagination,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core"

import { DatePickerInput } from "@mantine/dates"

import { useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import {
  IconChevronDown,
  IconDownload,
  IconFileText,
  IconInfoCircle,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import dayjs from "dayjs"

import { expensesApi, type ExpenseFormData } from "../api/expenses"

import { usersApi } from "../api/users"

import { AttachmentArea } from "../components/FileDropzone"

import { AttachmentBadge } from "../components/AttachmentBadge"

import {
  EXPENSE_MAX_ATTACHMENT_SIZE,
  EXPENSE_MAX_ATTACHMENT_SIZE_MB,
} from "../config"

import { useAuthStore } from "../store/authStore"

import { saveDraft, loadDraft, clearDraft } from "../utils/draftStorage"

import type { AdminExpenseFilters } from "../api/expenses"

import type { Expense, ExpenseStatus } from "../types"

interface StatusMeta {
  label: string
  color: string
}

const STATUS_META: Record<ExpenseStatus, StatusMeta> = {
  pending: { label: "Afventer", color: "yellow" },
  paid: { label: "Udbetalt", color: "green" },
  rejected: { label: "Afvist", color: "red" },
}

function formatKr(amount: string): string {
  const value = parseFloat(amount)
  if (Number.isNaN(value)) return `${amount} kr`
  return `${value.toLocaleString("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr`
}

function fullName(submitter: Expense["submitted_by"]): string {
  if (!submitter) return "Ukendt"
  return `${submitter.first_name} ${submitter.last_name}`.trim() || "Ukendt"
}

// --- Guideline info box ------------------------------------------------------

function GuidelinesAlert() {
  const [open, setOpen] = useState(false)
  return (
    <Alert
      icon={<IconInfoCircle size={20} />}
      color="blue"
      variant="light"
      title="Sådan får du refunderet et udlæg"
    >
      <Stack gap="xs">
        <Text size="sm">
          Inden du køber noget på Kløverbakkens vegne, skal købet være godkendt
          skriftligt – ellers kan udlægget ikke refunderes.
        </Text>
        <Anchor
          size="sm"
          component="button"
          type="button"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Skjul detaljer" : "Vis detaljer"}
        </Anchor>
        <Collapse expanded={open}>
          <Stack gap="xs">
            <Text size="sm">
              <strong>1. Købsbilag:</strong> Vedhæft faktura, kassebon eller
              billede af MobilePay-transaktion. Det skal tydeligt fremgå, hvad
              der er købt, og hvad beløbet er. Vi betaler ikke sorte penge –
              fakturaer fra professionelle leverandører skal opfylde lovkrav,
              herunder moms.
            </Text>
            <Text size="sm">
              <strong>2. Skriftlig godkendelse:</strong> Vedhæft eller henvis
              til en godkendelse fra et udvalg eller bestyrelsen (referat, mail
              eller opslag på intranettet).
            </Text>
            <Text size="sm">
              Vil du hellere undgå at lægge ud, kan kassereren betale fakturaen
              direkte, eller du kan bruge Kløverbakkens kreditkort (fælleskonto
              eller madkonto). Skriv til oekonomi@kloeverbakken-odder.dk.
            </Text>
          </Stack>
        </Collapse>
      </Stack>
    </Alert>
  )
}

// --- Create / edit form ------------------------------------------------------

interface ExpenseFormModalProps {
  opened: boolean
  onClose: () => void
  expense?: Expense | null
}

// Autosave key for a new udlæg, so an accidental modal close doesn't lose it.
// Only create drafts are persisted (edits already live server-side).
const CREATE_DRAFT_KEY = "expense-create"

function ExpenseFormModal({ opened, onClose, expense }: ExpenseFormModalProps) {
  const queryClient = useQueryClient()
  const isEdit = !!expense
  const isMobile = useMediaQuery("(max-width: 48em)")

  // Bank details fall back to the resident's saved profile values when creating
  // a fresh udlæg, so they don't have to retype them every time.
  const profile = useAuthStore((s) => s.user)

  const [regNr, setRegNr] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [amount, setAmount] = useState<string | number>("")
  const [description, setDescription] = useState("")
  const [approvalReference, setApprovalReference] = useState("")
  const [foodRelated, setFoodRelated] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)

  // Reset the form each time the modal opens (for create or a specific expense).
  useEffect(() => {
    if (!opened) return
    setRegNr(expense?.reg_nr ?? profile?.bank_reg_nr ?? "")
    setAccountNumber(
      expense?.account_number ?? profile?.bank_account_number ?? "",
    )
    setAmount(expense ? Number(expense.amount) : "")
    setDescription(expense?.description ?? "")
    setApprovalReference(expense?.approval_reference ?? "")
    setFoodRelated(expense?.food_related ?? false)
    setFiles([])
    setError(null)

    // For a new udlæg, restore an autosaved draft on top of the defaults.
    // Bank details are intentionally never persisted (kept out of the draft).
    if (!expense) {
      loadDraft(CREATE_DRAFT_KEY).then((stored) => {
        if (!stored) return
        try {
          const d = JSON.parse(stored)
          if (typeof d.amount === "string" || typeof d.amount === "number")
            setAmount(d.amount)
          if (typeof d.description === "string") setDescription(d.description)
          if (typeof d.approvalReference === "string")
            setApprovalReference(d.approvalReference)
          if (typeof d.foodRelated === "boolean") setFoodRelated(d.foodRelated)
        } catch {
          // Ignore a corrupt draft.
        }
      })
    }
  }, [opened, expense, profile])

  // Autosave the create form so closing by accident doesn't lose the entry.
  // Bank details alone (prefilled from profile) don't count as a draft.
  useEffect(() => {
    if (!opened || isEdit) return
    const hasContent =
      String(amount).trim() !== "" ||
      description.trim() !== "" ||
      approvalReference.trim() !== ""
    if (!hasContent) {
      clearDraft(CREATE_DRAFT_KEY)
      return
    }
    saveDraft(
      CREATE_DRAFT_KEY,
      JSON.stringify({
        amount,
        description,
        approvalReference,
        foodRelated,
      }),
    )
  }, [opened, isEdit, amount, description, approvalReference, foodRelated])

  const handleAddFiles = (incoming: File[]) => {
    const accepted: File[] = []
    for (const file of incoming) {
      if (file.size > EXPENSE_MAX_ATTACHMENT_SIZE) {
        const sizeMb = (file.size / 1_000_000).toFixed(1)
        notifications.show({
          title: "Filen er for stor",
          message: `"${file.name}" fylder ${sizeMb} MB. Et bilag må højst fylde ${EXPENSE_MAX_ATTACHMENT_SIZE_MB} MB, så det kan vedhæftes mailen til økonomi.`,
          color: "red",
        })
      } else {
        accepted.push(file)
      }
    }
    setFiles((prev) => [...prev, ...accepted])
  }

  const removeAttachmentMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      expensesApi.removeAttachment(attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] })
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const data: ExpenseFormData = {
        reg_nr: regNr.trim(),
        account_number: accountNumber.trim(),
        amount: String(amount),
        description: description.trim(),
        approval_reference: approvalReference.trim(),
        food_related: foodRelated,
      }
      if (isEdit && expense) {
        await expensesApi.update(expense.id, data)
        if (files.length > 0) await expensesApi.addAttachment(expense.id, files)
      } else {
        await expensesApi.create(data, files)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] })
      if (!isEdit) clearDraft(CREATE_DRAFT_KEY)
      notifications.show({
        title: isEdit ? "Udlæg opdateret" : "Udlæg oprettet",
        message: isEdit
          ? "Dine ændringer er gemt."
          : "Dit udlæg er sendt til behandling.",
        color: "green",
      })
      onClose()
    },
    onError: () => {
      setError("Noget gik galt. Tjek felterne og prøv igen.")
    },
  })

  const handleSubmit = () => {
    setError(null)
    if (!/^\d{4}$/.test(regNr.trim())) {
      setError("Reg. nr. skal være 4 cifre.")
      return
    }
    if (!/^\d{1,10}$/.test(accountNumber.trim())) {
      setError("Kontonummer skal være 1-10 cifre.")
      return
    }
    if (!amount || parseFloat(String(amount)) <= 0) {
      setError("Angiv et gyldigt beløb.")
      return
    }
    if (!description.trim()) {
      setError("Beskriv hvad der er købt.")
      return
    }
    const existingCount = expense?.attachments.length ?? 0
    if (!isEdit && files.length === 0) {
      setError("Vedhæft mindst ét købsbilag.")
      return
    }
    if (isEdit && existingCount === 0 && files.length === 0) {
      setError("Et udlæg skal have mindst ét bilag.")
      return
    }
    mutation.mutate()
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Rediger udlæg" : "Opret udlæg"}
      size="lg"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        <NumberInput
          label="Beløb (kr.)"
          placeholder="0,00"
          value={amount}
          onChange={setAmount}
          min={0}
          decimalScale={2}
          decimalSeparator=","
          thousandSeparator="."
          required
        />
        <Group grow>
          <TextInput
            label="Reg. nr."
            placeholder="1234"
            value={regNr}
            onChange={(e) => setRegNr(e.currentTarget.value)}
            inputMode="numeric"
            maxLength={4}
            required
          />
          <TextInput
            label="Kontonummer"
            placeholder="1234567890"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.currentTarget.value)}
            inputMode="numeric"
            maxLength={10}
            required
          />
        </Group>
        <Textarea
          label="Beskrivelse"
          description="Hvad er købt, og hvad er formålet?"
          placeholder="F.eks. maling til fælleshuset, godkendt på fællesmøde 1. juni"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          minRows={2}
          autosize
          required
        />
        <Textarea
          label="Skriftlig godkendelse (valgfri)"
          description="Henvisning til referat, mail eller opslag der godkender købet"
          value={approvalReference}
          onChange={(e) => setApprovalReference(e.currentTarget.value)}
          minRows={1}
          autosize
        />

        <Checkbox
          label="Udlæg i forbindelse med fællesmad"
          description="Gør udlægget synligt for de madansvarlige"
          checked={foodRelated}
          onChange={(e) => setFoodRelated(e.currentTarget.checked)}
        />

        {isEdit && expense && expense.attachments.length > 0 && (
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Nuværende bilag
            </Text>
            <Stack gap={4}>
              {expense.attachments.map((att) => (
                <Group key={att.id} gap="xs" justify="space-between">
                  <Anchor href={att.download_url} target="_blank" size="sm">
                    <Group gap={4}>
                      <IconPaperclip size={14} />
                      {att.name}
                    </Group>
                  </Anchor>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => removeAttachmentMutation.mutate(att.id)}
                    aria-label="Fjern bilag"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </Box>
        )}

        <Box>
          <Text size="sm" fw={500} mb={4}>
            {isEdit ? "Tilføj bilag" : "Bilag (købsbilag og evt. godkendelse)"}
          </Text>
          <AttachmentArea onAddFiles={handleAddFiles}>
            {files.length > 0 && (
              <Group gap="xs">
                {files.map((file, index) => (
                  <AttachmentBadge
                    key={`${file.name}-${file.size}-${index}`}
                    file={file}
                    onRemove={() =>
                      setFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                ))}
              </Group>
            )}
          </AttachmentArea>
        </Box>

        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuller
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? "Gem ændringer" : "Send udlæg"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// --- My expenses tab ---------------------------------------------------------

function MyExpensesTab() {
  const queryClient = useQueryClient()
  const [formOpened, setFormOpened] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", "mine"],
    queryFn: expensesApi.listMine,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => expensesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] })
      notifications.show({
        title: "Udlæg slettet",
        message: "",
        color: "green",
      })
    },
  })

  const openCreate = () => {
    setEditing(null)
    setFormOpened(true)
  }

  const openEdit = (expense: Expense) => {
    setEditing(expense)
    setFormOpened(true)
  }

  return (
    <Stack gap="md">
      <GuidelinesAlert />

      <Group justify="space-between">
        <Text fw={500}>Mine udlæg</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Opret udlæg
        </Button>
      </Group>

      {isLoading ? (
        <Center h={160}>
          <Loader />
        </Center>
      ) : !expenses || expenses.length === 0 ? (
        <Text c="dimmed">Du har ingen udlæg endnu.</Text>
      ) : (
        <Stack gap="sm">
          {expenses.map((expense) => {
            const meta = STATUS_META[expense.status]
            return (
              <Card key={expense.id} withBorder padding="md" radius="md">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm">
                      <Text fw={600}>{formatKr(expense.amount)}</Text>
                      <Badge color={meta.color} variant="light">
                        {expense.status_display || meta.label}
                      </Badge>
                      {expense.food_related && (
                        <Badge color="grape" variant="light">
                          Fællesmad
                        </Badge>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {dayjs(expense.created_at).format("D. MMM YYYY")}
                    </Text>
                  </Group>

                  <Text size="sm">{expense.description}</Text>

                  {expense.attachments.length > 0 && (
                    <Group gap="md">
                      {expense.attachments.map((att) => (
                        <Anchor
                          key={att.id}
                          href={att.download_url}
                          target="_blank"
                          size="sm"
                        >
                          <Group gap={4}>
                            <IconPaperclip size={14} />
                            {att.name}
                          </Group>
                        </Anchor>
                      ))}
                    </Group>
                  )}

                  {expense.status === "rejected" && expense.admin_note && (
                    <Text size="sm" c="red">
                      Begrundelse: {expense.admin_note}
                    </Text>
                  )}

                  {expense.status === "pending" && (
                    <Group gap="xs" justify="flex-end">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPencil size={14} />}
                        onClick={() => openEdit(expense)}
                      >
                        Rediger
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                          if (window.confirm("Slet dette udlæg?"))
                            deleteMutation.mutate(expense.id)
                        }}
                      >
                        Slet
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Card>
            )
          })}
        </Stack>
      )}

      <ExpenseFormModal
        opened={formOpened}
        onClose={() => setFormOpened(false)}
        expense={editing}
      />
    </Stack>
  )
}

// --- Admin tab ---------------------------------------------------------------

interface RejectState {
  expense: Expense
  note: string
}

interface StatusMutationVars {
  id: number
  status: ExpenseStatus
  note: string
}

function AdminExpensesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery("(max-width: 48em)")
  const [status, setStatus] = useState<ExpenseStatus | "">("")
  const [userId, setUserId] = useState<string | null>(null)
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null])
  const [foodFilter, setFoodFilter] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<RejectState | null>(null)
  const [page, setPage] = useState(1)

  const fromStr = range[0] ? dayjs(range[0]).format("YYYY-MM-DD") : undefined
  const toStr = range[1] ? dayjs(range[1]).format("YYYY-MM-DD") : undefined

  // The summed total and CSV export use the full filtered set, so they take
  // the filters without the page. The page is only added for the list query.
  // Food-admin-only users always see the food_related subset (server-enforced),
  // so the food filter is only surfaced to managers.
  const filters: AdminExpenseFilters = useMemo(
    () => ({
      status: status || undefined,
      user: userId ? Number(userId) : undefined,
      from: fromStr,
      to: toStr,
      food_related: foodFilter === null ? undefined : foodFilter === "true",
    }),
    [status, userId, fromStr, toStr, foodFilter],
  )

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setPage(1)
  }, [filters])

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "admin", filters, page],
    queryFn: () => expensesApi.listAll({ ...filters, page }),
  })

  // Keep the control in sync if the server clamped an out-of-range page.
  useEffect(() => {
    if (data && data.page !== page) setPage(data.page)
  }, [data, page])

  const { data: usersData } = useQuery({
    queryKey: ["users", "all"],
    queryFn: usersApi.getAllUsers,
  })

  const userOptions = useMemo(
    () =>
      (usersData ?? [])
        .map((u) => ({
          value: String(u.id),
          label: `${u.first_name} ${u.last_name}`.trim(),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "da")),
    [usersData],
  )

  const statusMutation = useMutation({
    mutationFn: (vars: StatusMutationVars) =>
      expensesApi.setStatus(vars.id, vars.status, vars.note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] })
      notifications.show({
        title: "Status opdateret",
        message: "",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Kunne ikke opdatere",
        message: "Prøv igen.",
        color: "red",
      })
    },
  })

  const exportMutation = useMutation({
    mutationFn: () => expensesApi.exportCsv(filters),
    onError: () => {
      notifications.show({
        title: "Eksport fejlede",
        message: "",
        color: "red",
      })
    },
  })

  const setStatusFor = (expense: Expense, next: ExpenseStatus) => {
    if (next === "rejected") {
      setRejecting({ expense, note: expense.admin_note ?? "" })
      return
    }
    statusMutation.mutate({ id: expense.id, status: next, note: "" })
  }

  const rows = data?.results ?? []

  return (
    <Stack gap="md">
      {!canManage && (
        <Alert
          icon={<IconInfoCircle size={20} />}
          color="grape"
          variant="light"
        >
          Du ser udlæg i forbindelse med fællesmad. Kun kassereren kan markere
          dem som udbetalt eller afvist.
        </Alert>
      )}

      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Status"
            placeholder="Alle"
            data={[
              { value: "pending", label: "Afventer" },
              { value: "paid", label: "Udbetalt" },
              { value: "rejected", label: "Afvist" },
            ]}
            value={status || null}
            onChange={(v) => setStatus(v as ExpenseStatus ?? "")}
            clearable
            w={140}
          />
          <Select
            label="Beboer"
            placeholder="Alle"
            data={userOptions}
            value={userId}
            onChange={setUserId}
            clearable
            searchable
            w={200}
          />
          <DatePickerInput
            type="range"
            label="Periode"
            value={range}
            onChange={(val) =>
              setRange(val as unknown as [Date | null, Date | null])
            }
            placeholder="Vælg datointerval"
            valueFormat="D/M YYYY"
            w={240}
            clearable
          />
          {canManage && (
            <Select
              label="Fællesmad"
              placeholder="Alle"
              data={[
                { value: "true", label: "Kun fællesmad" },
                { value: "false", label: "Ikke fællesmad" },
              ]}
              value={foodFilter}
              onChange={setFoodFilter}
              clearable
              w={160}
            />
          )}
        </Group>
        <Button
          variant="light"
          leftSection={<IconDownload size={16} />}
          onClick={() => exportMutation.mutate()}
          loading={exportMutation.isPending}
        >
          Eksportér CSV
        </Button>
      </Group>

      <Divider />

      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {data?.count ?? 0} udlæg
        </Text>
        <Badge size="lg" color="blue">
          Total: {data ? formatKr(data.total) : "–"}
        </Badge>
      </Group>

      {isLoading ? (
        <Center h={160}>
          <Loader />
        </Center>
      ) : rows.length === 0 ? (
        <Text c="dimmed">Ingen udlæg matcher filteret.</Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Dato</Table.Th>
                <Table.Th>Navn</Table.Th>
                <Table.Th>Beløb</Table.Th>
                <Table.Th>Reg./konto</Table.Th>
                <Table.Th>Beskrivelse</Table.Th>
                <Table.Th>Fællesmad</Table.Th>
                <Table.Th>Bilag</Table.Th>
                <Table.Th>Status</Table.Th>
                {canManage && <Table.Th>Handling</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((expense) => {
                const meta = STATUS_META[expense.status]
                return (
                  <Table.Tr key={expense.id}>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {dayjs(expense.created_at).format("D/M YYYY")}
                    </Table.Td>
                    <Table.Td>{fullName(expense.submitted_by)}</Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {formatKr(expense.amount)}
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {expense.reg_nr} / {expense.account_number}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={2} maw={220}>
                        {expense.description}
                      </Text>
                      {expense.status === "rejected" && expense.admin_note && (
                        <Text size="xs" c="red">
                          {expense.admin_note}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {expense.food_related ? (
                        <Badge color="grape" variant="light">
                          Ja
                        </Badge>
                      ) : (
                        <Text size="sm" c="dimmed">
                          –
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {expense.attachments.map((att) => (
                          <ActionIcon
                            key={att.id}
                            component="a"
                            href={att.download_url}
                            target="_blank"
                            variant="subtle"
                            aria-label={att.name}
                          >
                            <IconFileText size={16} />
                          </ActionIcon>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={meta.color} variant="light">
                        {expense.status_display || meta.label}
                      </Badge>
                    </Table.Td>
                    {canManage && (
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <Button
                              size="xs"
                              variant="light"
                              rightSection={<IconChevronDown size={14} />}
                            >
                              Skift
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              onClick={() => setStatusFor(expense, "paid")}
                            >
                              Marker som udbetalt
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              onClick={() => setStatusFor(expense, "rejected")}
                            >
                              Afvis
                            </Menu.Item>
                            <Menu.Item
                              onClick={() => setStatusFor(expense, "pending")}
                            >
                              Sæt som afventer
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    )}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {data && data.num_pages > 1 && (
        <Group justify="center">
          <Pagination total={data.num_pages} value={page} onChange={setPage} />
        </Group>
      )}

      <Modal
        opened={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Afvis udlæg"
        size="md"
        fullScreen={isMobile}
      >
        <Stack gap="md">
          <Textarea
            label="Begrundelse"
            description="Vises til beboeren"
            value={rejecting?.note ?? ""}
            onChange={(e) => {
              // Capture the value before the (deferred) state updater runs —
              // React nulls out the synthetic event's currentTarget afterwards.
              const note = e.currentTarget.value
              setRejecting((prev) => (prev ? { ...prev, note } : prev))
            }}
            minRows={3}
            autosize
            required
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRejecting(null)}>
              Annuller
            </Button>
            <Button
              color="red"
              loading={statusMutation.isPending}
              onClick={() => {
                if (!rejecting) return
                if (!rejecting.note.trim()) return
                statusMutation.mutate(
                  {
                    id: rejecting.expense.id,
                    status: "rejected",
                    note: rejecting.note.trim(),
                  },
                  { onSuccess: () => setRejecting(null) },
                )
              }}
            >
              Afvis udlæg
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

// --- Page --------------------------------------------------------------------

export default function ExpensesPage() {
  const user = useAuthStore((s) => s.user)
  // Economy admins (and staff) manage everything; food admins get a read-only
  // view of the fællesmad-related udlæg.
  const canManage = !!(user?.is_staff || user?.is_economy_admin)
  const canViewAdmin = canManage || !!user?.is_food_admin
  const [tab, setTab] = useState<string | null>("mine")

  return (
    <Container size="md">
      <Title order={2} mb="lg">
        Udlæg
      </Title>

      {canViewAdmin ? (
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="md">
            <Tabs.Tab value="mine">Mine udlæg</Tabs.Tab>
            <Tabs.Tab value="admin">
              {canManage ? "Administration" : "Fællesmad-udlæg"}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="mine">
            <MyExpensesTab />
          </Tabs.Panel>
          <Tabs.Panel value="admin">
            <AdminExpensesTab canManage={canManage} />
          </Tabs.Panel>
        </Tabs>
      ) : (
        <MyExpensesTab />
      )}
    </Container>
  )
}
