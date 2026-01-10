import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import {
  Container,
  Paper,
  Title,
  TextInput,
  Button,
  Stack,
  Text,
  Anchor,
  Alert,
} from "@mantine/core"
import { IconArrowLeft, IconCheck } from "@tabler/icons-react"

import { authApi } from "../api/auth"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const forgotPasswordMutation = useMutation({
    mutationFn: () => authApi.forgotPassword({ email }),
    onSuccess: () => {
      setSubmitted(true)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      forgotPasswordMutation.mutate()
    }
  }

  if (submitted) {
    return (
      <Container size="xs" px="md" my={40}>
        <Title ta="center" fw={900}>
          KB Intra
        </Title>
        <Text c="dimmed" size="sm" ta="center" mt={5}>
          Nulstil din adgangskode
        </Text>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert icon={<IconCheck size={16} />} color="green" mb="md">
            Hvis der findes en konto med denne e-mail, har vi sendt et link til
            at nulstille din adgangskode.
          </Alert>

          <Text size="sm" c="dimmed" mb="lg">
            Tjek din indbakke (og evt. spam-mappe) for en e-mail med et link til
            at nulstille din adgangskode. Linket udløber om 1 time.
          </Text>

          <Button
            component={Link}
            to="/login"
            variant="light"
            fullWidth
            leftSection={<IconArrowLeft size={16} />}
          >
            Tilbage til login
          </Button>
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
        Nulstil din adgangskode
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            <Text size="sm">
              Indtast din e-mailadresse, og vi sender dig et link til at
              nulstille din adgangskode.
            </Text>

            <TextInput
              label="E-mail"
              placeholder="din@email.dk"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              type="email"
            />

            <Button
              type="submit"
              fullWidth
              loading={forgotPasswordMutation.isPending}
            >
              Send nulstillingslink
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
