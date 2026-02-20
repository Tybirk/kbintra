import { Anchor } from "@mantine/core"
import { Link } from "react-router-dom"
import type { AnchorProps } from "@mantine/core"

interface UserLinkProps extends Omit<AnchorProps, "href" | "onClick"> {
  id: number
  firstName: string
  lastName: string
}

export default function UserLink({
  id,
  firstName,
  lastName,
  ...props
}: UserLinkProps) {
  return (
    <Anchor
      component={Link}
      to={`/profil/${id}`}
      c="inherit"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      {...props}
    >
      {firstName} {lastName}
    </Anchor>
  )
}
