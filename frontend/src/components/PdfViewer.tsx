import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import {
  ActionIcon,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core"

import { IconZoomIn, IconZoomOut } from "@tabler/icons-react"

import { Document, Page, pdfjs } from "react-pdf"

import type { PDFDocumentProxy } from "pdfjs-dist"

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

// Bundle the pdf.js worker as a Vite asset (version-matched to pdfjs-dist) so it
// works offline / behind CSP — no CDN dependency.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

const MIN_SCALE = 1

const MAX_SCALE = 4

const STEP = 1.25

const PAGE_GAP = 8

// A page zoomed 4× on a 3× phone would need a ~60 MB canvas, and iOS kills the
// tab long before a PDF's worth of those. Only pages near the screen get a
// canvas at all, and each is capped at this many pixels.
const MAX_CANVAS_PIXELS = 8_000_000

interface PdfViewerProps {
  /** Object URL of the (authenticated) PDF blob. */
  blobUrl: string
}

/**
 * A zoom about to be applied: the point (in viewport px) that must stay put,
 * and the scroll offsets as they were before the content changed size.
 */
interface ZoomAnchor {
  x: number

  y: number

  scrollLeft: number

  scrollTop: number

  factor: number
}

/** A pinch or ctrl+wheel in progress, previewed with a CSS transform. */
interface ZoomPreview {
  x: number

  y: number

  ratio: number
}

const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * Renders every page of a PDF, zoomable by pinch, double-tap, ctrl+wheel
 * (trackpad pinch) and the − / + buttons. Zooming re-renders the pages at the
 * new size, so text stays sharp instead of being a stretched bitmap.
 * Lazy-loaded by FilePreview so the pdf.js bundle is only fetched when a user
 * actually opens a PDF. Fills its parent's height and scrolls itself.
 */
export default function PdfViewer({ blobUrl }: PdfViewerProps) {
  // height / width of every page, read up front so the layout never shifts
  // under the reader while pages load
  const [aspects, setAspects] = useState<number[]>([])

  const numPages = aspects.length

  const loadedPdfRef = useRef<PDFDocumentProxy | null>(null)

  const [fitWidth, setFitWidth] = useState(0)

  const [scale, setScale] = useState(1)

  const [nearScreen, setNearScreen] = useState<Set<number>>(new Set([1, 2]))

  const scrollRef = useRef<HTMLDivElement>(null)

  const contentRef = useRef<HTMLDivElement>(null)

  const scaleRef = useRef(scale)

  scaleRef.current = scale

  const anchorRef = useRef<ZoomAnchor | null>(null)

  useEffect(() => {
    const el = scrollRef.current

    if (!el) return

    const update = () => setFitWidth(el.clientWidth)

    update()

    const observer = new ResizeObserver(update)

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  /** Zoom to `next`, keeping the point (x, y) of the viewport where it is. */
  const zoomTo = useCallback(
    (next: number, x?: number, y?: number) => {
      const el = scrollRef.current

      const target = clampScale(next)

      if (!el || target === scaleRef.current) return

      anchorRef.current = {
        x: x ?? el.clientWidth / 2,

        y: y ?? el.clientHeight / 2,

        // Read now: once the content shrinks, the browser has already clamped them.
        scrollLeft: el.scrollLeft,

        scrollTop: el.scrollTop,

        factor: target / scaleRef.current,
      }

      setScale(target)
    },
    [],
  )

  // Every size (pages and gaps) scales together, so the content under the
  // anchor moves by exactly `factor` and the scroll offset can follow it.
  useLayoutEffect(() => {
    const el = scrollRef.current

    const anchor = anchorRef.current

    if (!el || !anchor) return

    anchorRef.current = null

    el.scrollLeft = (anchor.scrollLeft + anchor.x) * anchor.factor - anchor.x

    el.scrollTop = (anchor.scrollTop + anchor.y) * anchor.factor - anchor.y
  }, [scale])

  // Gestures. Native listeners: touchmove and wheel must be able to
  // preventDefault, and a zoomed-in drag must stop before a surrounding
  // carousel sees it and swipes to the next attachment.
  useEffect(() => {
    const el = scrollRef.current

    const content = contentRef.current

    if (!el || !content) return

    let preview: ZoomPreview | null = null

    let pinchStartDistance = 0

    let wheelTimer: ReturnType<typeof setTimeout> | undefined

    let lastTap = { time: 0, x: 0, y: 0 }

    const local = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()

      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const showPreview = (ratio: number) => {
      if (!preview) return

      const current = scaleRef.current

      preview.ratio = clampScale(current * ratio) / current

      content.style.transformOrigin = `${el.scrollLeft + preview.x}px ${el.scrollTop + preview.y}px`

      content.style.transform = `scale(${preview.ratio})`
    }

    const commitPreview = () => {
      if (!preview) return

      content.style.transform = ""

      zoomTo(scaleRef.current * preview.ratio, preview.x, preview.y)

      preview = null
    }

    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,

        touches[0].clientY - touches[1].clientY,
      )

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDistance = distance(e.touches)

        preview = {
          ...local(
            (e.touches[0].clientX + e.touches[1].clientX) / 2,

            (e.touches[0].clientY + e.touches[1].clientY) / 2,
          ),

          ratio: 1,
        }
      }

      if (e.touches.length > 1 || scaleRef.current > 1) e.stopPropagation()
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!preview || e.touches.length < 2) return

      e.preventDefault()

      showPreview(distance(e.touches) / pinchStartDistance)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (preview && e.touches.length < 2) {
        commitPreview()

        return
      }

      if (e.touches.length > 0 || e.changedTouches.length !== 1) return

      const touch = e.changedTouches[0]

      const now = Date.now()

      const isDoubleTap =
        now - lastTap.time < 300 &&
        Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 30

      if (isDoubleTap) {
        // No synthetic dblclick after this, or it would zoom a second time.
        e.preventDefault()

        const { x, y } = local(touch.clientX, touch.clientY)

        zoomTo(scaleRef.current > 1 ? 1 : 2, x, y)

        lastTap = { time: 0, x: 0, y: 0 }
      } else {
        lastTap = { time: now, x: touch.clientX, y: touch.clientY }
      }
    }

    const onWheel = (e: WheelEvent) => {
      // A trackpad pinch arrives as ctrl+wheel; a plain wheel just scrolls.
      if (!e.ctrlKey) return

      e.preventDefault()

      if (!preview) preview = { ...local(e.clientX, e.clientY), ratio: 1 }

      showPreview(preview.ratio * Math.exp(-e.deltaY / 200))

      clearTimeout(wheelTimer)

      wheelTimer = setTimeout(commitPreview, 150)
    }

    const onDoubleClick = (e: MouseEvent) => {
      const { x, y } = local(e.clientX, e.clientY)

      zoomTo(scaleRef.current > 1 ? 1 : 2, x, y)
    }

    // Embla starts a carousel drag on mousedown/touchstart; zoomed in, a drag
    // belongs to the page.
    const onMouseDown = (e: MouseEvent) => {
      if (scaleRef.current > 1) e.stopPropagation()
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })

    el.addEventListener("touchmove", onTouchMove, { passive: false })

    el.addEventListener("touchend", onTouchEnd, { passive: false })

    el.addEventListener("wheel", onWheel, { passive: false })

    el.addEventListener("dblclick", onDoubleClick)

    el.addEventListener("mousedown", onMouseDown)

    return () => {
      clearTimeout(wheelTimer)

      el.removeEventListener("touchstart", onTouchStart)

      el.removeEventListener("touchmove", onTouchMove)

      el.removeEventListener("touchend", onTouchEnd)

      el.removeEventListener("wheel", onWheel)

      el.removeEventListener("dblclick", onDoubleClick)

      el.removeEventListener("mousedown", onMouseDown)
    }
    // The content element only exists once the document has loaded.
  }, [zoomTo, numPages])

  // Which pages are on or near the screen, and so get a canvas.
  useEffect(() => {
    const el = scrollRef.current

    if (!el || numPages === 0) return

    const observer = new IntersectionObserver(
      (entries) =>
        setNearScreen((current) => {
          const next = new Set(current)

          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page)

            if (entry.isIntersecting) next.add(page)
            else next.delete(page)
          }

          return next
        }),

      { root: el, rootMargin: "50% 0px" },
    )

    el.querySelectorAll("[data-page]").forEach((page) => observer.observe(page))

    return () => observer.disconnect()
  }, [numPages])

  const readAspects = async (pdf: PDFDocumentProxy) => {
    loadedPdfRef.current = pdf

    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)),
    )

    // A newer document replaced this one while its pages were loading.
    if (loadedPdfRef.current !== pdf) return

    setAspects(
      pages.map((page) => {
        const viewport = page.getViewport({ scale: 1 })

        return viewport.height / viewport.width
      }),
    )
  }

  // Unrounded on purpose: rounding each of a long document's pages makes the
  // layout scale non-linearly, and a zoom then drifts off the point it held.
  const pageWidth = fitWidth * scale

  const gap = PAGE_GAP * scale

  return (
    <Stack
      gap={0}
      style={{
        height: "100%",

        // Width comes from the parent, never from the pages. Without this a
        // zoomed page widens a carousel slide, which widens the viewer, which
        // widens the page again — until the layout hits the 2^24 px limit.
        contain: "inline-size",
      }}
    >
      <Group justify="center" gap={4} py={4}>
        <ActionIcon
          variant="subtle"
          onClick={() => zoomTo(scale / STEP)}
          disabled={scale <= MIN_SCALE}
          aria-label="Zoom ud"
        >
          <IconZoomOut size={18} />
        </ActionIcon>
        <UnstyledButton
          onClick={() => zoomTo(1)}
          aria-label="Tilpas til bredden"
        >
          <Text size="sm" w={56} ta="center">
            {Math.round(scale * 100)} %
          </Text>
        </UnstyledButton>
        <ActionIcon
          variant="subtle"
          onClick={() => zoomTo(scale * STEP)}
          disabled={scale >= MAX_SCALE}
          aria-label="Zoom ind"
        >
          <IconZoomIn size={18} />
        </ActionIcon>
      </Group>

      <div
        ref={scrollRef}
        style={{
          flex: 1,

          minHeight: 0,

          overflow: "auto",

          overscrollBehavior: "contain",

          // The browser's own pinch is off app-wide; this one is ours.
          touchAction: "pan-x pan-y",
        }}
      >
        <Document
          file={blobUrl}
          onLoadSuccess={(pdf) => void readAspects(pdf)}
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
          {numPages === 0 && (
            <Center h={200}>
              <Loader />
            </Center>
          )}
          <div ref={contentRef} style={{ width: pageWidth || "100%" }}>
            {Array.from({ length: numPages }, (_, i) => {
              const pageNumber = i + 1

              const height = pageWidth * aspects[i]

              const shown = nearScreen.has(pageNumber)

              return (
                <div
                  key={pageNumber}
                  data-page={pageNumber}
                  style={{ width: pageWidth, height, marginBottom: gap }}
                >
                  {pageWidth > 0 && (
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidth}
                      renderMode={shown ? "canvas" : "none"}
                      renderTextLayer={shown}
                      renderAnnotationLayer={shown}
                      devicePixelRatio={Math.min(
                        window.devicePixelRatio || 1,

                        Math.sqrt(
                          MAX_CANVAS_PIXELS / (pageWidth * Math.max(height, 1)),
                        ),
                      )}
                      loading=""
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Document>
      </div>
    </Stack>
  )
}
