import { useState, useEffect } from "react"

import { useNavigate, useSearchParams, Link } from "react-router-dom"

import {
  Container,
  Paper,
  Title,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Text,
  Anchor,
  Alert,
  Loader,
  Center,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { authApi } from "../api/auth"

export default function RegisterPage() {
  const navigate = useNavigate()

  const [searchParams] = useSearchParams()

  const token = searchParams.get("token") || ""

  const [isValidating, setIsValidating] = useState(true)

  const [isValid, setIsValid] = useState(false)

  const [invitationEmail, setInvitationEmail] = useState("")

  const [error, setError] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(false)

  const [formData, setFormData] = useState({
    email: "",

    firstName: "",

    lastName: "",

    password: "",

    passwordConfirm: "",
  })

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false)

        setError(
          "Ingen invitationskode angivet. Brug venligst linket fra din invitationsmail.",
        )

        return
      }

      try {
        const result = await authApi.validateInvitation(token)

        setIsValid(result.valid)

        setInvitationEmail(result.email)

        setFormData((prev) => ({ ...prev, email: result.email }))
      } catch {
        setError("Ugyldig eller udløbet invitationskode.")
      } finally {
        setIsValidating(false)
      }
    }

    validateToken()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setError(null)

    if (formData.password !== formData.passwordConfirm) {
      setError("Adgangskoderne matcher ikke.")

      return
    }

    if (formData.password.length < 8) {
      setError("Adgangskoden skal være mindst 8 tegn.")

      return
    }

    setIsLoading(true)

    try {
      await authApi.register({
        token,

        email: formData.email,

        password: formData.password,

        password_confirm: formData.passwordConfirm,

        first_name: formData.firstName,

        last_name: formData.lastName,
      })

      notifications.show({
        title: "Registrering gennemført!",

        message: "Du kan nu logge ind med dine oplysninger.",

        color: "green",
      })

      navigate("/login")
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosError = err as {
          response?: { data?: Record<string, string[]> }
        }

        const data = axiosError.response?.data

        if (data) {
          const messages = Object.values(data).flat().join(" ")

          setError(messages)
        } else {
          setError("Registrering mislykkedes. Prøv venligst igen.")
        }
      } else {
        setError("Registrering mislykkedes. Prøv venligst igen.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (isValidating) {
    return (
      <Container size="xs" px="md" my={40}>
        <Center>
          <Loader size="lg" />
        </Center>
        <Text ta="center" mt="md">
          Validerer invitation...
        </Text>
      </Container>
    )
  }

  if (!isValid) {
    return (
      <Container size="xs" px="md" my={40}>
        <Title ta="center" fw={900}>
          KB Intra
        </Title>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert color="red" title="Ugyldig invitation">
            {error || "Denne invitation er ugyldig eller udløbet."}
          </Alert>

          <Text ta="center" mt="md">
            <Anchor component={Link} to="/login" size="sm">
              Tilbage til login
            </Anchor>
          </Text>
        </Paper>
      </Container>
    )
  }

  return (
    <Container size="xs" px="md" my={40}>
      <Title ta="center" fw={900}>
        Bliv en del af KB Intra
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Færdiggør din registrering
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}

            <TextInput
              label="E-mail"
              value={invitationEmail}
              disabled
              description="E-mail fra din invitation"
            />

            <TextInput
              label="Fornavn"
              placeholder="Dit fornavn"
              required
              value={formData.firstName}
              onChange={(e) => {
                const value = e.currentTarget.value

                setFormData((prev) => ({ ...prev, firstName: value }))
              }}
            />

            <TextInput
              label="Efternavn"
              placeholder="Dit efternavn"
              required
              value={formData.lastName}
              onChange={(e) => {
                const value = e.currentTarget.value

                setFormData((prev) => ({ ...prev, lastName: value }))
              }}
            />

            <PasswordInput
              label="Adgangskode"
              placeholder="Opret en adgangskode"
              required
              value={formData.password}
              onChange={(e) => {
                const value = e.currentTarget.value

                setFormData((prev) => ({ ...prev, password: value }))
              }}
              description="Mindst 8 tegn"
            />

            <PasswordInput
              label="Bekræft adgangskode"
              placeholder="Bekræft din adgangskode"
              required
              value={formData.passwordConfirm}
              onChange={(e) => {
                const value = e.currentTarget.value

                setFormData((prev) => ({ ...prev, passwordConfirm: value }))
              }}
            />

            <Button type="submit" fullWidth loading={isLoading}>
              Opret konto
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center" mt={15}>
          Har du allerede en konto?{" "}
          <Anchor component={Link} to="/login" size="sm">
            Log ind
          </Anchor>
        </Text>
      </Paper>
    </Container>
  )
}
