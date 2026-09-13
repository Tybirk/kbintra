import { useEffect, useState } from "react"

import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core"

import { useMediaQuery } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import {
  IconInfoCircle,
  IconLock,
  IconPaperclip,
  IconX,
} from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { reportsApi } from "../../api/reports"

import { AttachmentArea } from "../../components/FileDropzone"

import { KIND_META, KIND_ORDER } from "./shared"

import type { Report, ReportKind } from "../../types"

interface ReportFormProps {
  opened: boolean
  onClose: () => void
  /** Pre-selected udvalg, when opened from that udvalg's own page. */
  subgroupSlug?: string
  onCreated?: (report: Report) => void
}

/**
 * One screen to file a report.
 *
 * The old app walked people through four steps because it had to collect name,
 * email and husnummer by hand. Logged in, that is already known, which leaves
 * three fields — so a wizard would be ceremony.
 */
export function ReportForm({
  opened,
  onClose,
  subgroupSlug,
  onCreated,
}: ReportFormProps) {
  const queryClient = useQueryClient()

  // Every other modal in the app goes full-screen on a phone; a `size="lg"` box
  // inside 390px is a cramped column with the send button pushed under the fold.
  // Reporting a broken thing happens standing in front of it, on a phone.
  const isMobile = useMediaQuery("(max-width: 48em)")

  const [kind, setKind] = useState<ReportKind>("defect")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [photos, setPhotos] = useState<File[]>([])
  const [subgroup, setSubgroup] = useState(subgroupSlug ?? "")
  const [error, setError] = useState("")

  const { data: subgroups = [] } = useQuery({
    queryKey: ["reports", "subgroups"],
    queryFn: reportsApi.subgroups,
    enabled: opened,
  })

  // With one udvalg accepting reports there is nothing to choose, so the field
  // becomes a line of text instead of a dropdown of one.
  const single = subgroups.length === 1 ? subgroups[0] : null
  const target = subgroupSlug || subgroup || single?.slug || ""

  useEffect(() => {
    if (!subgroup && single) setSubgroup(single.slug)
  }, [single, subgroup])

  function reset() {
    setKind("defect")
    setDescription("")
    setLocation("")
    setPhotos([])
    setError("")
  }

  const createMutation = useMutation({
    mutationFn: () =>
      reportsApi.create(
        { subgroup: target, kind, description, location },
        photos,
      ),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ["reports"] })
      notifications.show({
        title: `Sag #${report.number} er sendt`,
        message: `${report.subgroup.name} har fået din indrapportering.`,
        color: "green",
      })
      reset()
      onClose()
      onCreated?.(report)
    },
    onError: () => setError("Kunne ikke sende indrapporteringen. Prøv igen."),
  })

  function submit() {
    if (!description.trim()) {
      setError("Skriv en beskrivelse af hvad der er sket.")
      return
    }
    if (!target) {
      setError("Vælg hvilket udvalg det skal sendes til.")
      return
    }
    setError("")
    createMutation.mutate()
  }

  const targetGroup = subgroups.find((option) => option.slug === target)
  const targetName = targetGroup?.name ?? ""
  const targetIsClosed = targetGroup?.is_closed ?? false

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Ny indrapportering"
      size="lg"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        {/* Cards rather than a dropdown, matching the category picker below.
            A Select can only show the udvalg's name, and the name alone does
            not tell anyone whether a wobbly bench belongs to Driftsudvalget or
            Grønt udvalg — the intro line does, and it needs somewhere to live.
            It also gives the lock a place: whether the udvalg's queue is public
            has to be readable before the description is written, not after. */}
        {subgroups.length > 1 && !subgroupSlug ? (
          <Box>
            <Text size="sm" fw={500} mb={6}>
              Til hvilket udvalg?
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              {subgroups.map((option) => {
                const selected = target === option.slug
                return (
                  <UnstyledButton
                    key={option.slug}
                    onClick={() => setSubgroup(option.slug)}
                    p="sm"
                    style={{
                      borderRadius: 8,
                      border: `1px solid var(--mantine-color-${
                        selected ? "blue-6" : "gray-4"
                      })`,
                      background: selected
                        ? "var(--mantine-color-blue-light)"
                        : undefined,
                    }}
                  >
                    <Group gap={6} wrap="nowrap" align="center">
                      <Text size="sm" fw={selected ? 600 : 500}>
                        {option.name}
                      </Text>
                      {option.is_closed && (
                        <IconLock
                          size={14}
                          style={{ flexShrink: 0 }}
                          aria-label="Lukket"
                        />
                      )}
                    </Group>
                    {option.reporting_intro && (
                      <Text size="xs" c="dimmed">
                        {option.reporting_intro}
                      </Text>
                    )}
                  </UnstyledButton>
                )
              })}
            </SimpleGrid>
          </Box>
        ) : (
          targetName && (
            <Text size="sm" c="dimmed">
              Til: <strong>{targetName}</strong>
            </Text>
          )
        )}

        {targetIsClosed && (
          <Alert
            icon={<IconLock size={16} />}
            color="gray"
            variant="light"
            p="xs"
          >
            <Text size="xs">
              Kun {targetName} kan læse sagerne her. Du kan selv følge din egen
              sag.
            </Text>
          </Alert>
        )}

        <Box>
          <Text size="sm" fw={500} mb={6}>
            Hvad handler det om?
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
            {KIND_ORDER.map((option) => {
              const meta = KIND_META[option]
              const Icon = meta.icon
              const selected = kind === option
              return (
                <UnstyledButton
                  key={option}
                  onClick={() => setKind(option)}
                  p="sm"
                  style={{
                    borderRadius: 8,
                    border: `1px solid var(--mantine-color-${
                      selected ? meta.color : "gray"
                    }-${selected ? 6 : 4})`,
                    background: selected
                      ? `var(--mantine-color-${meta.color}-light)`
                      : undefined,
                  }}
                >
                  <Group gap={8} wrap="nowrap">
                    <Icon size={18} />
                    <Text size="sm" fw={selected ? 600 : 400}>
                      {meta.label}
                    </Text>
                  </Group>
                </UnstyledButton>
              )
            })}
          </SimpleGrid>
        </Box>

        <Textarea
          label="Beskrivelse"
          placeholder={KIND_META[kind].placeholder}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={10}
          required
        />

        <TextInput
          label="Hvor?"
          description="Valgfri"
          placeholder="fx. køkkenet i fælleshuset"
          value={location}
          onChange={(event) => setLocation(event.currentTarget.value)}
        />

        <Box>
          {/* `prompt`, not children: children are the badge area, where clicks
              are swallowed so removing one doesn't reopen the picker. As a
              child this label was the one part of the box that did nothing. */}
          <AttachmentArea
            accept="image/*"
            onAddFiles={(files) =>
              setPhotos((current) => [...current, ...files].slice(0, 10))
            }
            prompt={
              <Group gap={8} justify="center">
                <IconPaperclip size={18} />
                <Text size="sm">Tilføj vedhæftning</Text>
              </Group>
            }
          />
          <Alert
            icon={<IconInfoCircle size={16} />}
            color="blue"
            variant="light"
            mt="xs"
            p="xs"
          >
            <Text size="xs">
              Et billede gør det langt lettere at handle hurtigt.
            </Text>
          </Alert>
        </Box>

        {photos.length > 0 && (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
            {photos.map((photo, index) => (
              <Box key={`${photo.name}-${index}`} pos="relative">
                <Image
                  src={URL.createObjectURL(photo)}
                  alt={photo.name}
                  h={80}
                  fit="cover"
                  radius="sm"
                />
                {/* 32px, not the 18px this started as — a thumb target rather
                    than a mouse one. Kept inside the tile: a negative offset
                    would look better but the rightmost column would then poke
                    past the grid and reintroduce horizontal page overflow. */}
                <ActionIcon
                  onClick={() =>
                    setPhotos((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  aria-label={`Fjern ${photo.name}`}
                  variant="filled"
                  color="dark"
                  radius="xl"
                  size={32}
                  pos="absolute"
                  top={4}
                  right={4}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Box>
            ))}
          </SimpleGrid>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annullér
          </Button>
          <Button onClick={submit} loading={createMutation.isPending}>
            Send ind
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
