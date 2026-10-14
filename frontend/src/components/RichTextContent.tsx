import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { sanitizeHtml } from "../utils/sanitizeHtml"
import { ImageZoomViewer } from "./ImageZoomViewer"

interface RichTextContentProps {
  html: string
  className?: string
}

export function RichTextContent({ html, className }: RichTextContentProps) {
  // Memoized as the object React gets, so a re-render never has it rewrite the
  // post's DOM (which dropped the images' zoom cursor set below).
  const innerHtml = useMemo(() => ({ __html: sanitizeHtml(html) }), [html])
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
  }, [innerHtml, handleClick])

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        dangerouslySetInnerHTML={innerHtml}
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
