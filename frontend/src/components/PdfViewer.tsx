import { useEffect, useRef, useState } from "react"

import { Center, Loader, Stack, Text } from "@mantine/core"

import { Document, Page, pdfjs } from "react-pdf"

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

// Bundle the pdf.js worker as a Vite asset (version-matched to pdfjs-dist) so it
// works offline / behind CSP — no CDN dependency.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

interface PdfViewerProps {
  /** Object URL of the (authenticated) PDF blob. */
  blobUrl: string
}

/**
 * Renders every page of a PDF inline. Lazy-loaded by FilePreview so the pdf.js
 * bundle is only fetched when a user actually opens a PDF.
 */
export default function PdfViewer({ blobUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)

  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current

    if (!el) return

    const update = () => setWidth(el.clientWidth)

    update()

    const observer = new ResizeObserver(update)

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <Document
        file={blobUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={
          <Center h={200}>
            <Loader />
          </Center>
        }
        error={
          <Center h={200}>
            <Text c="red">Kunne ikke indlæse PDF&apos;en.</Text>
          </Center>
        }
      >
        <Stack gap="sm" align="center">
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i}
              pageNumber={i + 1}
              width={width || undefined}
              renderTextLayer
              renderAnnotationLayer
            />
          ))}
        </Stack>
      </Document>
    </div>
  )
}
