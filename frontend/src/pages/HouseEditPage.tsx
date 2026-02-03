import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Paper,
  Group,
  Avatar,
  Button,
  Textarea,
  Stack,
  Loader,
  Center,
  rem,
  TextInput,
  ActionIcon,
  Table,
  Modal,
  Alert,
} from "@mantine/core"
import { DateInput } from "@mantine/dates"
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone"
import { useDisclosure } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import {
  IconUpload,
  IconPhoto,
  IconX,
  IconArrowLeft,
  IconHome,
  IconPlus,
  IconPencil,
  IconTrash,
  IconAlertCircle,
} from "@tabler/icons-react"
import dayjs from "dayjs"

import {
  housesApi,
  type CreateChildData,
  type UpdateChildData,
} from "../api/houses"
import type { Child } from "../types"

interface UpdateChildParams {
  id: number
  data: UpdateChildData
}

export default function HouseEditPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [description, setDescription] = useState("")
  const [editingChild, setEditingChild] = useState<Child | null>(null)
  const [childModalOpened, { open: openChildModal, close: closeChildModal }] =
    useDisclosure(false)
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure(false)
  const [childToDelete, setChildToDelete] = useState<Child | null>(null)

  const [childForm, setChildForm] = useState({
    name: "",
    birthdate: null as Date | null,
  })

  const {
    data: house,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["house", "my"],
    queryFn: housesApi.getMyHouse,
  })

  useEffect(() => {
    if (house) {
      setDescription(house.description || "")
    }
  }, [house])

  const updateHouseMutation = useMutation({
    mutationFn: (data: { description: string }) =>
      housesApi.updateMyHouse(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })
      queryClient.invalidateQueries({ queryKey: ["houses"] })
      notifications.show({
        title: "Hus opdateret",
        message: "Dit hus er blevet opdateret.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere huset. Prøv igen.",
        color: "red",
      })
    },
  })

  const uploadPictureMutation = useMutation({
    mutationFn: (file: File) => housesApi.updateMyHousePicture(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })
      queryClient.invalidateQueries({ queryKey: ["houses"] })
      notifications.show({
        title: "Billede opdateret",
        message: "Husets billede er blevet opdateret.",
        color: "green",
      })
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke uploade billedet. Prøv igen.",
        color: "red",
      })
    },
  })

  const createChildMutation = useMutation({
    mutationFn: (data: CreateChildData) => housesApi.createChild(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })
      queryClient.invalidateQueries({ queryKey: ["houses"] })
      notifications.show({
        title: "Barn tilføjet",
        message: "Barnet er blevet tilføjet til husstanden.",
        color: "green",
      })
      closeChildModal()
      resetChildForm()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke tilføje barnet. Prøv igen.",
        color: "red",
      })
    },
  })

  const updateChildMutation = useMutation({
    mutationFn: ({ id, data }: UpdateChildParams) =>
      housesApi.updateChild(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })
      queryClient.invalidateQueries({ queryKey: ["houses"] })
      notifications.show({
        title: "Barn opdateret",
        message: "Barnets oplysninger er blevet opdateret.",
        color: "green",
      })
      closeChildModal()
      resetChildForm()
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke opdatere barnet. Prøv igen.",
        color: "red",
      })
    },
  })

  const deleteChildMutation = useMutation({
    mutationFn: (id: number) => housesApi.deleteChild(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })
      queryClient.invalidateQueries({ queryKey: ["houses"] })
      notifications.show({
        title: "Barn fjernet",
        message: "Barnet er blevet fjernet fra husstanden.",
        color: "green",
      })
      closeDeleteModal()
      setChildToDelete(null)
    },
    onError: () => {
      notifications.show({
        title: "Fejl",
        message: "Kunne ikke fjerne barnet. Prøv igen.",
        color: "red",
      })
    },
  })

  const resetChildForm = () => {
    setChildForm({ name: "", birthdate: null })
    setEditingChild(null)
  }

  const handleOpenAddChild = () => {
    resetChildForm()
    openChildModal()
  }

  const handleOpenEditChild = (child: Child) => {
    setEditingChild(child)
    setChildForm({
      name: child.name,
      birthdate: child.birthdate ? new Date(child.birthdate) : null,
    })
    openChildModal()
  }

  const handleOpenDeleteChild = (child: Child) => {
    setChildToDelete(child)
    openDeleteModal()
  }

  const handleSaveChild = () => {
    const data = {
      name: childForm.name,
      birthdate: childForm.birthdate
        ? dayjs(childForm.birthdate).format("YYYY-MM-DD")
        : null,
    }

    if (editingChild) {
      updateChildMutation.mutate({ id: editingChild.id, data })
    } else {
      createChildMutation.mutate(data)
    }
  }

  const handleConfirmDelete = () => {
    if (childToDelete) {
      deleteChildMutation.mutate(childToDelete.id)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateHouseMutation.mutate({ description })
  }

  const handleDrop = (files: File[]) => {
    if (files.length > 0) {
      uploadPictureMutation.mutate(files[0])
    }
  }

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !house) {
    return (
      <Center h={200}>
        <Stack align="center">
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Ingen husstand"
            color="yellow"
          >
            Du er ikke tilknyttet et hus. Kontakt en administrator for at blive
            tilknyttet.
          </Alert>
          <Button variant="light" onClick={() => navigate("/profil")}>
            Tilbage til profil
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/profil")}
        mb="md"
      >
        Tilbage til profil
      </Button>

      <Title order={1} mb="xl">
        Rediger hus
      </Title>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Group gap="md" mb="md">
          <Avatar
            src={house.profile_picture}
            size={80}
            radius="md"
            color="blue"
          >
            <IconHome size={40} />
          </Avatar>
          <div>
            <Title order={2}>{house.name}</Title>
            {house.address && (
              <Text c="dimmed" size="sm">
                {house.address}
              </Text>
            )}
          </div>
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Title order={4} mb="md">
          Husets billede
        </Title>

        <Group>
          <Avatar
            src={house.profile_picture}
            size={100}
            radius="md"
            color="blue"
          >
            <IconHome size={50} />
          </Avatar>

          <Dropzone
            onDrop={handleDrop}
            accept={IMAGE_MIME_TYPE}
            maxSize={5 * 1024 ** 2}
            loading={uploadPictureMutation.isPending}
            style={{ flex: 1 }}
          >
            <Group
              justify="center"
              gap="xl"
              mih={100}
              style={{ pointerEvents: "none" }}
            >
              <Dropzone.Accept>
                <IconUpload
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: "var(--mantine-color-blue-6)",
                  }}
                  stroke={1.5}
                />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: "var(--mantine-color-red-6)",
                  }}
                  stroke={1.5}
                />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconPhoto
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: "var(--mantine-color-dimmed)",
                  }}
                  stroke={1.5}
                />
              </Dropzone.Idle>

              <div>
                <Text size="lg" inline>
                  Træk billede hertil eller klik for at vælge
                </Text>
                <Text size="sm" c="dimmed" inline mt={7}>
                  Max filstørrelse: 5MB
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <form onSubmit={handleSubmit}>
          <Stack>
            <Title order={4}>Beskrivelse</Title>

            <Textarea
              label="Om husstanden"
              placeholder="Fortæl lidt om jeres husstand..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minRows={3}
              maxLength={1000}
              description={`${description.length}/1000 tegn`}
            />

            <Group justify="flex-end" mt="md">
              <Button type="submit" loading={updateHouseMutation.isPending}>
                Gem ændringer
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper withBorder p="xl" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={4}>Børn i husstanden</Title>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleOpenAddChild}
          >
            Tilføj barn
          </Button>
        </Group>

        <Text size="sm" c="dimmed" mb="md">
          Børn er ikke brugere med login, men vises i beboeroversigten som en
          del af husstanden.
        </Text>

        {house.children && house.children.length > 0 ? (
          <Table.ScrollContainer minWidth={400}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Navn</Table.Th>
                  <Table.Th>Fødselsdag</Table.Th>
                  <Table.Th style={{ width: 100 }}>Handlinger</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {house.children.map((child) => (
                  <Table.Tr key={child.id}>
                    <Table.Td>{child.name}</Table.Td>
                    <Table.Td>
                      {child.birthdate
                        ? dayjs(child.birthdate).format("D. MMMM YYYY")
                        : "-"}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="lg"
                          onClick={() => handleOpenEditChild(child)}
                          aria-label="Rediger barn"
                        >
                          <IconPencil size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="lg"
                          onClick={() => handleOpenDeleteChild(child)}
                          aria-label="Fjern barn"
                        >
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed" ta="center" py="lg">
            Ingen børn registreret i husstanden.
          </Text>
        )}
      </Paper>

      {/* Child Add/Edit Modal */}
      <Modal
        opened={childModalOpened}
        onClose={() => {
          closeChildModal()
          resetChildForm()
        }}
        title={editingChild ? "Rediger barn" : "Tilføj barn"}
      >
        <Stack>
          <TextInput
            label="Navn"
            placeholder="Barnets navn"
            value={childForm.name}
            onChange={(e) =>
              setChildForm((prev) => ({ ...prev, name: e.target.value }))
            }
            required
          />

          <DateInput
            label="Fødselsdag"
            placeholder="Vælg fødselsdag"
            value={childForm.birthdate}
            onChange={(value) => {
              const date = value ? new Date(value) : null
              setChildForm((prev) => ({ ...prev, birthdate: date }))
            }}
            maxDate={new Date()}
            clearable
          />

          <Group justify="flex-end" mt="md">
            <Button
              variant="light"
              onClick={() => {
                closeChildModal()
                resetChildForm()
              }}
            >
              Annuller
            </Button>
            <Button
              onClick={handleSaveChild}
              loading={
                createChildMutation.isPending || updateChildMutation.isPending
              }
              disabled={!childForm.name.trim()}
            >
              {editingChild ? "Gem ændringer" : "Tilføj"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteModalOpened}
        onClose={() => {
          closeDeleteModal()
          setChildToDelete(null)
        }}
        title="Fjern barn"
      >
        <Text mb="lg">
          Er du sikker på, at du vil fjerne{" "}
          <strong>{childToDelete?.name}</strong> fra husstanden?
        </Text>
        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={() => {
              closeDeleteModal()
              setChildToDelete(null)
            }}
          >
            Annuller
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deleteChildMutation.isPending}
          >
            Fjern
          </Button>
        </Group>
      </Modal>
    </>
  )
}
