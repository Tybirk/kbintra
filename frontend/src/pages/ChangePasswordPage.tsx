import { useState } from "react"

import { useNavigate } from "react-router-dom"

import { useMutation } from "@tanstack/react-query"

import {
  Title,
  Paper,
  Button,
  PasswordInput,
  Stack,
  Alert,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import { authApi } from "../api/auth"

import { BackButton } from "../components/BackButton"

import type { ChangePasswordData } from "../types"

export default function ChangePasswordPage() {
  const navigate = useNavigate()

  const [formData, setFormData] = useState<ChangePasswordData>({
    current_password: "",

    new_password: "",

    new_password_confirm: "",
  })

  const [error, setError] = useState<string | null>(null)

  const changePasswordMutation = useMutation({
    mutationFn: (data: ChangePasswordData) => authApi.changePassword(data),

    onSuccess: () => {
      notifications.show({
        title: "Adgangskode opdateret",

        message: "Din adgangskode er blevet ændret.",

        color: "green",
      })

      navigate("/profil")
    },

    onError: (err: { response?: { data?: Record<string, string[]> } }) => {
      const data = err.response?.data

      if (data?.current_password) {
        setError("Den nuværende adgangskode er forkert.")
      } else if (data?.new_password) {
        setError(data.new_password.join(" "))
      } else if (data?.new_password_confirm) {
        setError("De nye adgangskoder matcher ikke.")
      } else {
        setError("Der opstod en fejl. Prøv venligst igen.")
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    setError(null)

    if (formData.new_password !== formData.new_password_confirm) {
      setError("De nye adgangskoder matcher ikke.")

      return
    }

    if (formData.new_password.length < 8) {
      setError("Den nye adgangskode skal være mindst 8 tegn.")

      return
    }

    changePasswordMutation.mutate(formData)
  }

  return (
    <>
      <BackButton to="/profil" label="Tilbage til profil" />

      <Title order={1} mb="xl">
        Skift adgangskode
      </Title>

      <Paper withBorder p="xl" radius="md" maw={500}>
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" onClose={() => setError(null)} withCloseButton>
                {error}
              </Alert>
            )}

            <PasswordInput
              label="Nuværende adgangskode"
              placeholder="Indtast din nuværende adgangskode"
              value={formData.current_password}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,

                  current_password: e.target.value,
                }))
              }
              required
            />

            <PasswordInput
              label="Ny adgangskode"
              placeholder="Indtast din nye adgangskode"
              value={formData.new_password}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,

                  new_password: e.target.value,
                }))
              }
              required
              description="Mindst 8 tegn"
            />

            <PasswordInput
              label="Bekræft ny adgangskode"
              placeholder="Gentag din nye adgangskode"
              value={formData.new_password_confirm}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,

                  new_password_confirm: e.target.value,
                }))
              }
              required
            />

            <Button
              type="submit"
              loading={changePasswordMutation.isPending}
              mt="md"
            >
              Skift adgangskode
            </Button>
          </Stack>
        </form>
      </Paper>
    </>
  )
}
