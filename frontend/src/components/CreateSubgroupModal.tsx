import { useEffect, useMemo, useState, lazy, Suspense } from "react"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Modal,
  Stack,
  TextInput,
  Box,
  Text,
  Checkbox,
  Group,
  Button,
  SegmentedControl,
  Select,
  Skeleton,
} from "@mantine/core"

import { DateInput } from "@mantine/dates"

import { notifications } from "@mantine/notifications"

import dayjs from "dayjs"

import { forumApi } from "../api/forum"

import { showErrorNotification } from "../utils/errorNotification"

import { flattenOrgTree } from "../utils/orgTree"

import type { RichTextEditorProps } from "./RichTextEditor"

import type { Subgroup } from "../types"

const RichTextEditorImpl = lazy(() => import("./RichTextEditor"))

function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={<Skeleton h={(props.minHeight ?? 100) + 50} radius="sm" />}
    >
      <RichTextEditorImpl {...props} />
    </Suspense>
  )
}

type CreateGroupType = "arbejdsgruppe" | "almindelig"

interface CreateSubgroupModalProps {
  opened: boolean
  onClose: () => void
  /** Preselect the type (e.g. "arbejdsgruppe" when opened from /overblik). */
  defaultGroupType?: CreateGroupType
  /** Called after a successful create, with the new subgroup. */
  onCreated?: (subgroup: Subgroup) => void
}

export default function CreateSubgroupModal({
  opened,
  onClose,
  defaultGroupType = "almindelig",
  onCreated,
}: CreateSubgroupModalProps) {
  const queryClient = useQueryClient()

  const [groupType, setGroupType] = useState<CreateGroupType>(defaultGroupType)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [allowsMembers, setAllowsMembers] = useState(false)
  const [parentId, setParentId] = useState<string | null>(null)
  const [establishedOn, setEstablishedOn] = useState<Date | null>(new Date())
  const [expiresOn, setExpiresOn] = useState<Date | null>(null)

  useEffect(() => {
    if (opened) {
      setGroupType(defaultGroupType)
    }
  }, [opened, defaultGroupType])

  const { data: orgTree } = useQuery({
    queryKey: ["forum", "organisation", false],
    queryFn: () => forumApi.getOrganisation(false),
    enabled: opened && groupType === "arbejdsgruppe",
  })

  const parentOptions = useMemo(() => flattenOrgTree(orgTree ?? []), [orgTree])

  const resetForm = () => {
    setGroupType(defaultGroupType)
    setName("")
    setDescription("")
    setAllowsMembers(false)
    setParentId(null)
    setEstablishedOn(new Date())
    setExpiresOn(null)
  }

  const createSubgroupMutation = useMutation({
    mutationFn: forumApi.createSubgroup,
    onSuccess: (subgroup) => {
      queryClient.invalidateQueries({ queryKey: ["subgroups"] })
      queryClient.invalidateQueries({ queryKey: ["forum", "organisation"] })

      notifications.show({
        title: "Gruppe oprettet",
        message: `"${subgroup.name}" er nu oprettet.`,
        color: "green",
      })

      resetForm()
      onClose()
      onCreated?.(subgroup)
    },
    onError: (error: unknown) => {
      showErrorNotification(
        error,
        "Kunne ikke oprette gruppen. Prøv venligst igen.",
      )
    },
  })

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = () => {
    createSubgroupMutation.mutate({
      name,
      description,
      allows_members: allowsMembers,
      group_type: groupType,
      parent: groupType === "arbejdsgruppe" ? Number(parentId) : null,
      established_on: establishedOn
        ? dayjs(establishedOn).format("YYYY-MM-DD")
        : null,
      expires_on: expiresOn ? dayjs(expiresOn).format("YYYY-MM-DD") : null,
    })
  }

  const isArbejdsgruppe = groupType === "arbejdsgruppe"
  const canSubmit =
    name.trim().length > 0 && (!isArbejdsgruppe || parentId !== null)

  return (
    <Modal opened={opened} onClose={handleClose} title="Opret ny gruppe">
      <Stack>
        <SegmentedControl
          fullWidth
          value={groupType}
          onChange={(value) => setGroupType(value as CreateGroupType)}
          data={[
            { label: "Almindelig gruppe", value: "almindelig" },
            { label: "Arbejdsgruppe", value: "arbejdsgruppe" },
          ]}
        />

        <TextInput
          label="Navn"
          placeholder="Gruppenavn"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />

        <Box>
          <Text size="sm" fw={500} mb={4}>
            Beskrivelse
          </Text>
          <RichTextEditor
            content={description}
            onChange={setDescription}
            placeholder="Kort beskrivelse af gruppen (valgfrit)"
            minHeight={100}
          />
        </Box>

        {isArbejdsgruppe && (
          <>
            <Select
              label="Forælder"
              description="Organet eller arbejdsgruppen denne arbejdsgruppe har mandat fra"
              placeholder="Vælg forælder"
              data={parentOptions}
              value={parentId}
              onChange={setParentId}
              searchable
              required
            />
            <Group grow>
              <DateInput
                label="Oprettelsesdato"
                placeholder="Vælg dato"
                value={establishedOn}
                onChange={(value) =>
                  setEstablishedOn(value ? new Date(value) : null)
                }
                clearable
              />
              <DateInput
                label="Udløbsdato"
                placeholder="Vælg dato (valgfrit)"
                value={expiresOn}
                onChange={(value) =>
                  setExpiresOn(value ? new Date(value) : null)
                }
                clearable
              />
            </Group>
          </>
        )}

        <Checkbox
          label="Tillad medlemskab"
          description="Relevant hvis der ønskes mulighed for private tråde."
          checked={allowsMembers}
          onChange={(e) => setAllowsMembers(e.currentTarget.checked)}
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose}>
            Annuller
          </Button>
          <Button
            onClick={handleSubmit}
            loading={createSubgroupMutation.isPending}
            disabled={!canSubmit}
          >
            Opret gruppe
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
