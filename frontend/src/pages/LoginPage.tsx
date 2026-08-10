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

import { isAxiosError } from "axios"

interface LocationState {
  from?: { pathname: string }
}

export default function LoginPage() {
  const navigate = useNavigate()

  const location = useLocation()

  const { login, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState("")

  const [password, setPassword] = useState("")

  const [rateLimited, setRateLimited] = useState(false)

  const from = (location.state as LocationState)?.from?.pathname || "/"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setRateLimited(false)

    try {
      await login(email, password)

      navigate(from, { replace: true })
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 429) {
        setRateLimited(true)
      }
    }
  }

  return (
    <Container size="xs" px="md" my={40}>
      <Title ta="center" fw={900}>
        KB Intra
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Kløverbakkens kommunikationsplatform
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {rateLimited && (
              <Alert color="orange">
                For mange loginforsøg. Vent venligst et minut og prøv igen.
              </Alert>
            )}
            {error && !rateLimited && (
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
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
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
        <Text c="dimmed" size="xs" ta="center" mt={10}>
          <Anchor component={Link} to="/privatlivspolitik" c="dimmed">
            Privatlivspolitik
          </Anchor>
        </Text>
      </Paper>
    </Container>
  )
}
