import { useState, useEffect } from "react"

import { Link, useSearchParams } from "react-router-dom"

import { useMutation } from "@tanstack/react-query"

import {
  Container,
  Paper,
  Title,
  PasswordInput,
  Button,
  Stack,
  Text,
  Anchor,
  Alert,
} from "@mantine/core"

import { IconArrowLeft, IconCheck, IconAlertCircle } from "@tabler/icons-react"

import { authApi } from "../api/auth"

import type { ResetPasswordData } from "../types"

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()

  const token = searchParams.get("token")

  const [formData, setFormData] = useState({
    new_password: "",

    new_password_confirm: "",
  })

  const [error, setError] = useState<string | null>(null)

  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setError("Ugyldigt eller manglende nulstillingstoken.")
    }
  }, [token])

  const resetPasswordMutation = useMutation({
    mutationFn: (data: ResetPasswordData) => authApi.resetPassword(data),

    onSuccess: () => {
      setSuccess(true)
    },

    onError: (err: { response?: { data?: Record<string, string[]> } }) => {
      const data = err.response?.data

      if (data?.token) {
        setError(
          "Nulstillingslinket er ugyldigt eller udløbet. Anmod venligst om et nyt link.",
        )
      } else if (data?.new_password) {
        setError(data.new_password.join(" "))
      } else if (data?.new_password_confirm) {
        setError("Adgangskoderne matcher ikke.")
      } else {
        setError("Der opstod en fejl. Prøv venligst igen.")
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    setError(null)

    if (!token) {
      setError("Ugyldigt eller manglende nulstillingstoken.")

      return
    }

    if (formData.new_password !== formData.new_password_confirm) {
      setError("Adgangskoderne matcher ikke.")

      return
    }

    if (formData.new_password.length < 8) {
      setError("Adgangskoden skal være mindst 8 tegn.")

      return
    }

    resetPasswordMutation.mutate({
      token,

      new_password: formData.new_password,

      new_password_confirm: formData.new_password_confirm,
    })
  }

  if (success) {
    return (
      <Container size="xs" px="md" my={40}>
        <Title ta="center" fw={900}>
          KB Intra
        </Title>
        <Text c="dimmed" size="sm" ta="center" mt={5}>
          Adgangskode nulstillet
        </Text>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert icon={<IconCheck size={16} />} color="green" mb="md">
            Din adgangskode er blevet nulstillet.
          </Alert>

          <Text size="sm" c="dimmed" mb="lg">
            Du kan nu logge ind med din nye adgangskode.
          </Text>

          <Button component={Link} to="/login" fullWidth>
            Gå til login
          </Button>
        </Paper>
      </Container>
    )
  }

  if (!token) {
    return (
      <Container size="xs" px="md" my={40}>
        <Title ta="center" fw={900}>
          KB Intra
        </Title>
        <Text c="dimmed" size="sm" ta="center" mt={5}>
          Nulstil adgangskode
        </Text>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
            Ugyldigt eller manglende nulstillingslink.
          </Alert>

          <Text size="sm" c="dimmed" mb="lg">
            Linket du fulgte er ugyldigt. Anmod venligst om et nyt
            nulstillingslink.
          </Text>

          <Stack gap="sm">
            <Button component={Link} to="/forgot-password" fullWidth>
              Anmod om nyt link
            </Button>
            <Button
              component={Link}
              to="/login"
              variant="light"
              fullWidth
              leftSection={<IconArrowLeft size={16} />}
            >
              Tilbage til login
            </Button>
          </Stack>
        </Paper>
      </Container>
    )
  }

  return (
    <Container size="xs" px="md" my={40}>
      <Title ta="center" fw={900}>
        KB Intra
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Vælg en ny adgangskode
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" onClose={() => setError(null)} withCloseButton>
                {error}
              </Alert>
            )}

            <PasswordInput
              label="Ny adgangskode"
              placeholder="Indtast din nye adgangskode"
              value={formData.new_password}
              onChange={(e) => {
                const value = e.currentTarget.value
                setFormData((prev) => ({ ...prev, new_password: value }))
              }}
              required
              description="Mindst 8 tegn"
            />

            <PasswordInput
              label="Bekræft adgangskode"
              placeholder="Gentag din nye adgangskode"
              value={formData.new_password_confirm}
              onChange={(e) => {
                const value = e.currentTarget.value
                setFormData((prev) => ({
                  ...prev,
                  new_password_confirm: value,
                }))
              }}
              required
            />

            <Button
              type="submit"
              fullWidth
              loading={resetPasswordMutation.isPending}
            >
              Nulstil adgangskode
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center" mt={15}>
          Huskede du din adgangskode?{" "}
          <Anchor component={Link} to="/login" size="sm">
            Log ind her
          </Anchor>
        </Text>
      </Paper>
    </Container>
  )
}
