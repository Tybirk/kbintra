import { useState, useRef, useEffect, useCallback } from "react"
import { ImageZoomViewer } from "./ImageZoomViewer"

interface RichTextContentProps {
  html: string
  className?: string
}

export function RichTextContent({ html, className }: RichTextContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [zoomAlt, setZoomAlt] = useState<string | undefined>(undefined)

  const handleClick = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement
      event.preventDefault()
      event.stopPropagation()
      setZoomSrc(img.src)
      setZoomAlt(img.alt)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const imgs = container.querySelectorAll("img")
    imgs.forEach((img) => {
      img.style.cursor = "zoom-in"
    })

    container.addEventListener("click", handleClick)
    return () => {
      container.removeEventListener("click", handleClick)
    }
  }, [html, handleClick])

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ImageZoomViewer
        src={zoomSrc || ""}
        alt={zoomAlt}
        opened={zoomSrc !== null}
        onClose={() => setZoomSrc(null)}
      />
    </>
  )
}
