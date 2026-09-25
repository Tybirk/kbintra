import { Anchor } from "@mantine/core"

import { Link } from "react-router-dom"

import type { AnchorProps } from "@mantine/core"

interface UserLinkProps
  extends Omit<AnchorProps, "href" | "onClick"> {

  /** Shown instead of the full name, e.g. just the first name. */
  id: number

  firstName: string

  lastName: string
  children?: React.ReactNode
}

export default function UserLink({
  id,

  firstName,

  lastName,

  children,

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
      {children ?? `${firstName} ${lastName}`}
    </Anchor>
  )
}
