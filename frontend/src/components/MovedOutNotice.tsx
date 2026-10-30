import { Alert } from "@mantine/core"

import dayjs from "dayjs"

import { useAuthStore } from "../store/authStore"

/**
 * Tells a resident who has moved out that their login is on borrowed time:
 * until access_until they can still read and write, then the account closes.
 */
export function MovedOutNotice() {
  const user = useAuthStore((s) => s.user)

  if (!user?.moved_out_on) return null

  const until = user.access_until
    ? ` Du har adgang til KB Intra til og med ${dayjs(user.access_until).format("D. MMMM YYYY")}, så du kan nå at gemme det, du har brug for.`
    : ""

  return (
    <Alert
      color="gray"
      variant="light"
      mb="md"
      title="Du er flyttet fra Kløverbakken"
    >
      Du er ikke længere med på beboerlisten, madhold eller fællesbeskeder.
      {until}
    </Alert>
  )
}
