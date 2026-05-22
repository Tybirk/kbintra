import { Box } from "@mantine/core"

import type { MantineRadius } from "@mantine/core"

interface BlurredThumbnailProps {
  src: string

  alt: string

  radius?: MantineRadius | number

  onClick?: () => void
}

export function BlurredThumbnail({
  src,
  alt,
  radius = "sm",
  onClick,
}: BlurredThumbnailProps) {
  const borderRadius =
    typeof radius === "number" ? radius : `var(--mantine-radius-${radius})`

  return (
    <Box
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("${src}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(20px)",
          transform: "scale(1.1)",
          opacity: 0.25,
        }}
      />
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </Box>
  )
}
