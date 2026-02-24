import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import {
  Center,
  Stack,
  Title,
  Text,
  Button,
  Loader,
  ThemeIcon,
} from "@mantine/core"
import { IconCheck, IconX } from "@tabler/icons-react"

import { usersApi } from "../api/users"

export default function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get("token")

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  )
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setErrorMessage("Ugyldigt link. Prøv at anmode om en ny emailændring.")
      return
    }

    usersApi
      .confirmEmailChange(token)
      .then(() => setStatus("success"))
      .catch((err: { response?: { data?: Record<string, string[]> } }) => {
        const data = err.response?.data
        const msg =
          data?.token?.[0] ??
          data?.non_field_errors?.[0] ??
          "Noget gik galt. Linket er måske udløbet."
        setErrorMessage(msg)
        setStatus("error")
      })
  }, [token])

  if (status === "loading") {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    )
  }

  if (status === "success") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <ThemeIcon size={64} radius="xl" color="green">
            <IconCheck size={36} />
          </ThemeIcon>
          <Title order={2}>Emailadresse opdateret</Title>
          <Text c="dimmed" ta="center">
            Din emailadresse er nu ændret. Log ind igen med din nye adresse.
          </Text>
          <Button onClick={() => navigate("/login")}>Gå til login</Button>
        </Stack>
      </Center>
    )
  }

  return (
    <Center h="100vh">
      <Stack align="center" gap="md">
        <ThemeIcon size={64} radius="xl" color="red">
          <IconX size={36} />
        </ThemeIcon>
        <Title order={2}>Bekræftelse mislykkedes</Title>
        <Text c="dimmed" ta="center">
          {errorMessage}
        </Text>
        <Button variant="light" onClick={() => navigate("/profil/rediger")}>
          Tilbage til profil
        </Button>
      </Stack>
    </Center>
  )
}
