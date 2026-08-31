import { useState, useEffect } from "react"

import { useNavigate, Link } from "react-router-dom"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  Title,
  Text,
  Paper,
  Group,
  Avatar,
  Button,
  TextInput,
  PasswordInput,
  Textarea,
  Stack,
  Loader,
  Center,
  Collapse,
  Modal,
  Anchor,
  rem,
} from "@mantine/core"

import { DateInput } from "@mantine/dates"

import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone"

import "@mantine/dropzone/styles.css"

import { notifications } from "@mantine/notifications"

import { showErrorNotification } from "../utils/errorNotification"

import {
  IconUpload,
  IconPhoto,
  IconX,
  IconLock,
  IconMail,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react"

import dayjs from "dayjs"

import { usersApi } from "../api/users"

import { BackButton } from "../components/BackButton"

import { useAuthStore } from "../store/authStore"

import type { User } from "../types"

export default function ProfileEditPage() {
  const navigate = useNavigate()

  const queryClient = useQueryClient()

  const { updateUser, logout } = useAuthStore()

  const [formData, setFormData] = useState({
    first_name: "",

    last_name: "",

    phone_number: "",

    bio: "",

    birthdate: null as Date | null,

    house: null as number | null,

    bank_reg_nr: "",

    bank_account_number: "",
  })

  const [emailChangeOpen, setEmailChangeOpen] = useState(false)

  const [emailChangeData, setEmailChangeData] = useState({
    new_email: "",

    current_password: "",
  })

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  const [deletePassword, setDeletePassword] = useState("")

  const { data: user, isLoading } = useQuery({
    queryKey: ["user", "me"],

    queryFn: usersApi.getCurrentUser,
  })

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || "",

        last_name: user.last_name || "",

        phone_number: user.phone_number || "",

        bio: user.bio || "",

        birthdate: user.birthdate ? new Date(user.birthdate) : null,

        house: user.house,

        bank_reg_nr: user.bank_reg_nr || "",

        bank_account_number: user.bank_account_number || "",
      })
    }
  }, [user])

  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<User>) => usersApi.updateProfile(data),

    onSuccess: (updatedUser) => {
      updateUser(updatedUser)

      queryClient.invalidateQueries({ queryKey: ["user"] })

      notifications.show({
        title: "Profil opdateret",

        message: "Din profil er blevet opdateret.",

        color: "green",
      })

      navigate("/profil")
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke opdatere profilen. Prøv igen.")
    },
  })

  const requestEmailChangeMutation = useMutation({
    mutationFn: () =>
      usersApi.requestEmailChange(
        emailChangeData.new_email,

        emailChangeData.current_password,
      ),

    onSuccess: () => {
      setEmailChangeData({ new_email: "", current_password: "" })

      setEmailChangeOpen(false)

      notifications.show({
        title: "Bekræftelsesmail sendt",

        message: `En bekræftelsesmail er sendt til ${emailChangeData.new_email}. Klik på linket i mailen for at bekræfte ændringen.`,

        color: "green",

        autoClose: 8000,
      })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Noget gik galt. Prøv igen.")
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: () => usersApi.deleteAccount(deletePassword),

    onSuccess: () => {
      logout()
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Noget gik galt. Prøv igen.")
    },
  })

  const exportDataMutation = useMutation({
    mutationFn: () => usersApi.exportData(),

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke eksportere data. Prøv igen.")
    },
  })

  const uploadPictureMutation = useMutation({
    mutationFn: (file: File) => usersApi.updateProfilePicture(file),

    onSuccess: (updatedUser) => {
      updateUser(updatedUser)

      queryClient.invalidateQueries({ queryKey: ["user"] })
    },

    onError: (error: unknown) => {
      showErrorNotification(error, "Kunne ikke uploade billede. Prøv igen.")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    updateProfileMutation.mutate({
      first_name: formData.first_name,

      last_name: formData.last_name,

      phone_number: formData.phone_number,

      bio: formData.bio,

      birthdate: formData.birthdate
        ? dayjs(formData.birthdate).format("YYYY-MM-DD")
        : null,

      house: formData.house,

      bank_reg_nr: formData.bank_reg_nr.trim(),

      bank_account_number: formData.bank_account_number.trim(),
    })
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

  return (
    <>
      <BackButton to="/profil" label="Tilbage til profil" />

      <Title order={1} mb="xl">
        Rediger profil
      </Title>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Title order={4} mb="md">
          Profilbillede
        </Title>

        <Group>
          <Avatar src={user?.profile_picture} size={100} radius={100}>
            {user?.first_name?.[0]}
            {user?.last_name?.[0]}
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
                  Maks filstørrelse: 5 MB
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            <Title order={4}>Personlige oplysninger</Title>

            <Group grow>
              <TextInput
                label="Fornavn"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,

                    first_name: e.target.value,
                  }))
                }
                required
              />
              <TextInput
                label="Efternavn"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,

                    last_name: e.target.value,
                  }))
                }
                required
              />
            </Group>

            <TextInput
              label="Telefonnummer"
              placeholder="+45 12 34 56 78"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,

                  phone_number: e.target.value,
                }))
              }
            />

            <DateInput
              label="Fødselsdag"
              placeholder="Vælg din fødselsdag"
              value={formData.birthdate}
              onChange={(value) => {
                const date = value ? new Date(value) : null

                setFormData((prev) => ({ ...prev, birthdate: date }))
              }}
              maxDate={new Date()}
              clearable
              inputMode="none"
            />

            <Textarea
              label="Bio"
              placeholder="Fortæl om dig selv..."
              value={formData.bio}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, bio: e.target.value }))
              }
              minRows={3}
              maxLength={500}
              description={`${formData.bio.length}/500 tegn`}
            />

            <Title order={4} mt="md">
              Bankoplysninger
            </Title>
            <Text size="sm" c="dimmed">
              Bruges til at udfylde dine udlæg automatisk. Kun du kan se dem.
            </Text>

            <Group grow>
              <TextInput
                label="Reg. nr."
                placeholder="1234"
                value={formData.bank_reg_nr}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,

                    bank_reg_nr: e.target.value,
                  }))
                }
                inputMode="numeric"
                maxLength={4}
              />
              <TextInput
                label="Kontonummer"
                placeholder="1234567890"
                value={formData.bank_account_number}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,

                    bank_account_number: e.target.value,
                  }))
                }
                inputMode="numeric"
                maxLength={10}
              />
            </Group>

            <Group justify="flex-end" mt="md">
              <Button variant="light" onClick={() => navigate("/profil")}>
                Annuller
              </Button>
              <Button type="submit" loading={updateProfileMutation.isPending}>
                Gem ændringer
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper withBorder p="xl" radius="md" mt="xl">
        <Title order={4} mb="md">
          Sikkerhed
        </Title>
        <Stack gap="sm">
          <Button
            variant="light"
            leftSection={<IconLock size={16} />}
            onClick={() => navigate("/profil/skift-adgangskode")}
          >
            Skift adgangskode
          </Button>

          <Button
            variant="light"
            leftSection={<IconMail size={16} />}
            onClick={() => setEmailChangeOpen((o) => !o)}
          >
            Skift emailadresse
          </Button>

          <Collapse expanded={emailChangeOpen}>
            <Stack gap="sm" pt="xs">
              <Text size="sm" c="dimmed">
                Din nuværende emailadresse er <strong>{user?.email}</strong>. Du
                vil modtage en bekræftelsesmail på den nye adresse.
              </Text>
              <TextInput
                label="Ny emailadresse"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ny@email.dk"
                value={emailChangeData.new_email}
                onChange={(e) =>
                  setEmailChangeData((prev) => ({
                    ...prev,

                    new_email: e.target.value,
                  }))
                }
              />
              <PasswordInput
                label="Bekræft med din nuværende adgangskode"
                placeholder="Din nuværende adgangskode"
                value={emailChangeData.current_password}
                onChange={(e) =>
                  setEmailChangeData((prev) => ({
                    ...prev,

                    current_password: e.target.value,
                  }))
                }
              />
              <Group>
                <Button
                  variant="filled"
                  loading={requestEmailChangeMutation.isPending}
                  disabled={
                    !emailChangeData.new_email ||
                    !emailChangeData.current_password
                  }
                  onClick={() => requestEmailChangeMutation.mutate()}
                >
                  Send bekræftelsesmail
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => {
                    setEmailChangeOpen(false)

                    setEmailChangeData({ new_email: "", current_password: "" })
                  }}
                >
                  Annuller
                </Button>
              </Group>
            </Stack>
          </Collapse>
        </Stack>
      </Paper>

      <Paper withBorder p="xl" radius="md" mt="xl">
        <Title order={4} mb="xs">
          Mine data
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Du kan til enhver tid downloade alle dine data eller slette din konto.
          Læs vores{" "}
          <Anchor component={Link} to="/privatlivspolitik" size="sm">
            privatlivspolitik
          </Anchor>
          .
        </Text>
        <Stack gap="sm">
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            loading={exportDataMutation.isPending}
            onClick={() => exportDataMutation.mutate()}
          >
            Download mine data (JSON)
          </Button>
          <Button
            variant="light"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={() => setDeleteModalOpen(true)}
          >
            Slet min konto
          </Button>
        </Stack>
      </Paper>

      <Modal
        opened={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false)

          setDeletePassword("")
        }}
        title="Slet konto"
        centered
      >
        <Stack>
          <Text size="sm">
            Er du sikker på, at du vil slette din konto? Denne handling kan ikke
            fortrydes. Alle dine personlige data vil blive slettet.
          </Text>
          <PasswordInput
            label="Bekræft med din adgangskode"
            placeholder="Din adgangskode"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => {
                setDeleteModalOpen(false)

                setDeletePassword("")
              }}
            >
              Annuller
            </Button>
            <Button
              color="red"
              loading={deleteAccountMutation.isPending}
              disabled={!deletePassword}
              onClick={() => deleteAccountMutation.mutate()}
            >
              Slet konto permanent
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
