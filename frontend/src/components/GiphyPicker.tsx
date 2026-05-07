import { createPortal } from "react-dom"

import { useEffect, useRef, useState } from "react"

import {
  Paper,
  Image,
  Group,
  Button,
  Text,
  Loader,
  Center,
  Box,
} from "@mantine/core"

import { fetchRandomGif, type GiphyResult } from "../api/giphy"

export interface GiphyAnchor {
  left: number

  top: number

  bottom: number
}

interface GiphyPickerProps {
  query: string

  anchor: GiphyAnchor

  onSend: (url: string) => void

  onCancel: () => void
}

const PICKER_WIDTH = 260

export default function GiphyPicker({
  query,

  anchor,

  onSend,

  onCancel,
}: GiphyPickerProps) {
  const [gif, setGif] = useState<GiphyResult | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentQueryRef = useRef(query)

  const doFetch = async (q: string) => {
    currentQueryRef.current = q

    setLoading(true)

    setError(null)

    try {
      const result = await fetchRandomGif(q)

      if (q === currentQueryRef.current) setGif(result)
    } catch {
      if (q === currentQueryRef.current) setError("Kunne ikke hente GIF")
    } finally {
      if (q === currentQueryRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    setLoading(true)

    setError(null)

    debounceRef.current = setTimeout(() => doFetch(query), 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const above = anchor.top > 300

  const left = Math.min(anchor.left, window.innerWidth - PICKER_WIDTH - 8)

  const posStyle: React.CSSProperties = above
    ? {
        position: "fixed",

        bottom: window.innerHeight - anchor.top + 8,

        left,

        zIndex: 9999,

        width: PICKER_WIDTH,
      }
    : {
        position: "fixed",

        top: anchor.bottom + 8,

        left,

        zIndex: 9999,

        width: PICKER_WIDTH,
      }

  return createPortal(
    <Paper shadow="md" withBorder p="sm" style={posStyle}>
      {loading ? (
        <Center h={120}>
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Box>
          <Text c="red" size="sm" mb="xs">
            {error}
          </Text>
          <Group gap="xs">
            <Button size="xs" onClick={() => doFetch(query)}>
              Prøv igen
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={onCancel}>
              Annuller
            </Button>
          </Group>
        </Box>
      ) : gif ? (
        <Box>
          <Image
            src={gif.previewUrl}
            alt={gif.title}
            mah={180}
            fit="contain"
            mb="xs"
            radius="sm"
          />
          <Group gap="xs">
            <Button size="xs" onClick={() => onSend(gif.originalUrl)}>
              Send
            </Button>
            <Button size="xs" variant="default" onClick={() => doFetch(query)}>
              Ny GIF
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={onCancel}>
              Annuller
            </Button>
          </Group>
        </Box>
      ) : null}
    </Paper>,

    document.body,
  )
}
