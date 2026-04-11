import { Text, Anchor } from "@mantine/core"
import type { TextProps } from "@mantine/core"

interface LocationTextProps extends TextProps {
  location: string
}

const URL_REGEX = /https?:\/\/[^\s]+/g

/**
 * Renders a location string, turning any URLs into clickable links.
 */
export function LocationText({ location, ...textProps }: LocationTextProps) {
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of location.matchAll(URL_REGEX)) {
    const url = match[0]
    const start = match.index
    if (start > lastIndex) {
      parts.push(location.slice(lastIndex, start))
    }
    parts.push(
      <Anchor
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        size={textProps.size}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {url}
      </Anchor>,
    )
    lastIndex = start + url.length
  }

  if (lastIndex < location.length) {
    parts.push(location.slice(lastIndex))
  }

  if (parts.length === 0) {
    parts.push(location)
  }

  return <Text {...textProps}>{parts}</Text>
}
