import { useState } from "react"
import { useNavigate, useLocation, Link } from "react-router-dom"
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
} from "@mantine/core"
import { useAuthStore } from "../store/authStore"

interface LocationState {
  from?: { pathname: string }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const from = (location.state as LocationState)?.from?.pathname || "/"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch {
      // Error is handled by the store
    }
  }

  return (
    <Container size="xs" px="md" my={40}>
      <Title ta="center" fw={900}>
        KB Intra
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Fællesskabets kommunikationsplatform
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" onClose={clearError}>
                Forkert e-mail eller adgangskode. Prøv venligst igen.
              </Alert>
            )}

            <TextInput
              label="E-mail"
              placeholder="din@email.dk"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              type="email"
            />

            <PasswordInput
              label="Adgangskode"
              placeholder="Din adgangskode"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />

            <Anchor component={Link} to="/forgot-password" size="sm" ta="right">
              Glemt adgangskode?
            </Anchor>

            <Button type="submit" fullWidth loading={isLoading}>
              Log ind
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center" mt={15}>
          Ny bruger? Brug registreringslinket fra din invitationsmail.
        </Text>
      </Paper>
    </Container>
  )
}
