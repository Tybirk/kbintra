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
  Switch,
  Badge,
} from "@mantine/core"

import { DateInput } from "@mantine/dates"

import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone"

import "@mantine/dropzone/styles.css"

import { useDisclosure } from "@mantine/hooks"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconUpload,
  IconPhoto,
  IconX,
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
  type CreateCarData,
  type UpdateCarData,
} from "../api/houses"

import type { Car, Child } from "../types"

import { formatLicensePlate } from "../utils/licensePlate"

import { BackButton } from "../components/BackButton"

interface UpdateChildParams {
  id: number

  data: UpdateChildData
}

interface UploadChildPictureParams {
  id: number

  file: File
}

interface UpdateCarParams {
  id: number

  data: UpdateCarData
}

export default function HouseEditPage() {
  const navigate = useNavigate()

  const queryClient = useQueryClient()

  const [description, setDescription] = useState("")

  const [isEditingDescription, setIsEditingDescription] = useState(false)

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

  const [editingCar, setEditingCar] = useState<Car | null>(null)

  const [carModalOpened, { open: openCarModal, close: closeCarModal }] =
    useDisclosure(false)

  const [
    deleteCarModalOpened,

    { open: openDeleteCarModal, close: closeDeleteCarModal },
  ] = useDisclosure(false)

  const [carToDelete, setCarToDelete] = useState<Car | null>(null)

  const [carForm, setCarForm] = useState({
    license_plate: "",

    is_electric: false,
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

      setIsEditingDescription(false)

      notifications.show({
        title: "Hus opdateret",

        message: "Dit hus er blevet opdateret.",

        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere huset. Prøv igen.")
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke uploade billedet. Prøv igen.")
    },
  })

  const uploadChildPictureMutation = useMutation({
    mutationFn: ({ id, file }: UploadChildPictureParams) =>
      housesApi.updateChildPicture(id, file),

    onSuccess: (child) => {
      queryClient.invalidateQueries({ queryKey: ["house"] })

      queryClient.invalidateQueries({ queryKey: ["houses"] })

      setEditingChild(child)

      notifications.show({
        title: "Billede opdateret",
        message: "Barnets billede er blevet opdateret.",
        color: "green",
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke uploade billedet. Prøv igen.")
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke tilføje barnet. Prøv igen.")
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere barnet. Prøv igen.")
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

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke fjerne barnet. Prøv igen.")
    },
  })

  const createCarMutation = useMutation({
    mutationFn: (data: CreateCarData) => housesApi.createCar(data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })

      queryClient.invalidateQueries({ queryKey: ["houses"] })

      notifications.show({
        title: "Bil tilføjet",

        message: "Bilen er blevet tilføjet til husstanden.",

        color: "green",
      })

      closeCarModal()

      resetCarForm()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke tilføje bilen. Prøv igen.")
    },
  })

  const updateCarMutation = useMutation({
    mutationFn: ({ id, data }: UpdateCarParams) =>
      housesApi.updateCar(id, data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })

      queryClient.invalidateQueries({ queryKey: ["houses"] })

      notifications.show({
        title: "Bil opdateret",

        message: "Bilens oplysninger er blevet opdateret.",

        color: "green",
      })

      closeCarModal()

      resetCarForm()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere bilen. Prøv igen.")
    },
  })

  const deleteCarMutation = useMutation({
    mutationFn: (id: number) => housesApi.deleteCar(id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["house"] })

      queryClient.invalidateQueries({ queryKey: ["houses"] })

      notifications.show({
        title: "Bil fjernet",

        message: "Bilen er blevet fjernet fra husstanden.",

        color: "green",
      })

      closeDeleteCarModal()

      setCarToDelete(null)
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke fjerne bilen. Prøv igen.")
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

  const resetCarForm = () => {
    setCarForm({ license_plate: "", is_electric: false })

    setEditingCar(null)
  }

  const handleOpenAddCar = () => {
    resetCarForm()

    openCarModal()
  }

  const handleOpenEditCar = (car: Car) => {
    setEditingCar(car)

    setCarForm({
      license_plate: car.license_plate,

      is_electric: car.is_electric,
    })

    openCarModal()
  }

  const handleOpenDeleteCar = (car: Car) => {
    setCarToDelete(car)

    openDeleteCarModal()
  }

  const handleSaveCar = () => {
    const data = {
      license_plate: carForm.license_plate,

      is_electric: carForm.is_electric,
    }

    if (editingCar) {
      updateCarMutation.mutate({ id: editingCar.id, data })
    } else {
      createCarMutation.mutate(data)
    }
  }

  const handleConfirmDeleteCar = () => {
    if (carToDelete) {
      deleteCarMutation.mutate(carToDelete.id)
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

  const handleChildPictureDrop = (files: File[]) => {
    if (editingChild && files.length > 0) {
      uploadChildPictureMutation.mutate({ id: editingChild.id, file: files[0] })
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
      <BackButton to="/profil" label="Tilbage til profil" />

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
        {isEditingDescription ? (
          <form onSubmit={handleSubmit}>
            <Stack>
              <Title order={4}>Beskrivelse</Title>

              <Textarea
                label="Om husstanden"
                placeholder="Fortæl lidt om jeres husstand..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autosize
                minRows={8}
                maxRows={20}
                maxLength={1000}
                description={`${description.length}/1000 tegn`}
                autoFocus
              />

              <Group justify="flex-end" mt="md">
                <Button
                  variant="subtle"
                  onClick={() => {
                    setDescription(house.description || "")
                    setIsEditingDescription(false)
                  }}
                  disabled={updateHouseMutation.isPending}
                >
                  Annuller
                </Button>
                <Button type="submit" loading={updateHouseMutation.isPending}>
                  Gem ændringer
                </Button>
              </Group>
            </Stack>
          </form>
        ) : (
          <Stack>
            <Group justify="space-between" align="flex-start">
              <Title order={4}>Beskrivelse</Title>
              <Button
                variant="subtle"
                leftSection={<IconPencil size={16} />}
                onClick={() => setIsEditingDescription(true)}
              >
                Rediger
              </Button>
            </Group>

            {house.description ? (
              <Text style={{ whiteSpace: "pre-wrap" }}>
                {house.description}
              </Text>
            ) : (
              <Text c="dimmed" fs="italic">
                Ingen beskrivelse endnu.
              </Text>
            )}
          </Stack>
        )}
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
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <Avatar
                          src={child.profile_picture}
                          radius="xl"
                          size="md"
                          color="grape"
                        >
                          {child.name?.[0]}
                        </Avatar>
                        <Text>{child.name}</Text>
                      </Group>
                    </Table.Td>
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

      <Paper withBorder p="xl" radius="md" mt="xl">
        <Group justify="space-between" mb="md">
          <Title order={4}>Biler i husstanden</Title>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleOpenAddCar}
          >
            Tilføj bil
          </Button>
        </Group>

        <Text size="sm" c="dimmed" mb="md">
          Registrer jeres biler så naboer kan finde ejeren via nummerpladen.
        </Text>

        {house.cars && house.cars.length > 0 ? (
          <Table.ScrollContainer minWidth={400}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nummerplade</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th style={{ width: 100 }}>Handlinger</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {house.cars.map((car) => (
                  <Table.Tr key={car.id}>
                    <Table.Td>
                      {car.license_plate ? (
                        formatLicensePlate(car.license_plate)
                      ) : (
                        <Text size="sm">Bil</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {car.is_electric ? (
                        <Badge size="sm" variant="light" color="green">
                          Elbil
                        </Badge>
                      ) : (
                        <Badge size="sm" variant="light" color="gray">
                          Ikke-elbil
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="lg"
                          onClick={() => handleOpenEditCar(car)}
                          aria-label="Rediger bil"
                        >
                          <IconPencil size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="lg"
                          onClick={() => handleOpenDeleteCar(car)}
                          aria-label="Fjern bil"
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
            Ingen biler registreret i husstanden.
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
          {editingChild && (
            <Group>
              <Avatar
                src={editingChild.profile_picture}
                size={80}
                radius="xl"
                color="grape"
              >
                {editingChild.name?.[0]}
              </Avatar>
              <Dropzone
                onDrop={handleChildPictureDrop}
                accept={IMAGE_MIME_TYPE}
                maxSize={5 * 1024 ** 2}
                loading={uploadChildPictureMutation.isPending}
                style={{ flex: 1 }}
              >
                <Group
                  justify="center"
                  gap="md"
                  mih={80}
                  style={{ pointerEvents: "none" }}
                >
                  <Dropzone.Accept>
                    <IconUpload
                      style={{
                        width: rem(32),
                        height: rem(32),
                        color: "var(--mantine-color-blue-6)",
                      }}
                      stroke={1.5}
                    />
                  </Dropzone.Accept>
                  <Dropzone.Reject>
                    <IconX
                      style={{
                        width: rem(32),
                        height: rem(32),
                        color: "var(--mantine-color-red-6)",
                      }}
                      stroke={1.5}
                    />
                  </Dropzone.Reject>
                  <Dropzone.Idle>
                    <IconPhoto
                      style={{
                        width: rem(32),
                        height: rem(32),
                        color: "var(--mantine-color-dimmed)",
                      }}
                      stroke={1.5}
                    />
                  </Dropzone.Idle>
                  <Text size="sm" c="dimmed">
                    Træk billede hertil eller klik for at vælge
                  </Text>
                </Group>
              </Dropzone>
            </Group>
          )}

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
            inputMode="none"
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

      {/* Car Add/Edit Modal */}
      <Modal
        opened={carModalOpened}
        onClose={() => {
          closeCarModal()

          resetCarForm()
        }}
        title={editingCar ? "Rediger bil" : "Tilføj bil"}
      >
        <Stack>
          <TextInput
            label="Nummerplade (valgfri)"
            placeholder="F.eks. AB12345"
            value={carForm.license_plate}
            onChange={(e) =>
              setCarForm((prev) => ({
                ...prev,

                license_plate: e.target.value,
              }))
            }
          />

          <Switch
            label="Elbil"
            checked={carForm.is_electric}
            onChange={(e) => {
              const checked = e.currentTarget.checked

              setCarForm((prev) => ({
                ...prev,

                is_electric: checked,
              }))
            }}
          />

          <Group justify="flex-end" mt="md">
            <Button
              variant="light"
              onClick={() => {
                closeCarModal()

                resetCarForm()
              }}
            >
              Annuller
            </Button>
            <Button
              onClick={handleSaveCar}
              loading={
                createCarMutation.isPending || updateCarMutation.isPending
              }
            >
              {editingCar ? "Gem ændringer" : "Tilføj"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Car Delete Confirmation Modal */}
      <Modal
        opened={deleteCarModalOpened}
        onClose={() => {
          closeDeleteCarModal()

          setCarToDelete(null)
        }}
        title="Fjern bil"
      >
        <Text mb="lg">
          {carToDelete?.license_plate ? (
            <>
              Er du sikker på, at du vil fjerne bilen med nummerplade{" "}
              <strong>{formatLicensePlate(carToDelete.license_plate)}</strong>{" "}
              fra husstanden?
            </>
          ) : (
            <>Er du sikker på, at du vil fjerne denne bil fra husstanden?</>
          )}
        </Text>
        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={() => {
              closeDeleteCarModal()

              setCarToDelete(null)
            }}
          >
            Annuller
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDeleteCar}
            loading={deleteCarMutation.isPending}
          >
            Fjern
          </Button>
        </Group>
      </Modal>
    </>
  )
}
