import { useEffect, useRef, useState, type MouseEvent } from "react"

import { Center, Loader } from "@mantine/core"

import DOMPurify from "dompurify"

import { renderAsync } from "docx-preview"

interface DocxViewerProps {
  /** Object URL of the (authenticated) .docx blob. */
  blobUrl: string

  /**
   * The file couldn't be rendered; the caller shows its fallback instead.
   * Must be stable per blobUrl — a new function re-renders the document.
   */
  onError: () => void
}

// A Word page is 21 cm, 794 px. Narrower than this, a page scaled to fit is
// too small to read on a screen that can't be pinch-zoomed (the viewport meta
// forbids it), so the text reflows to the width instead, as in Word's own
// mobile view. Wider, the pages show as Word lays them out, scaled down a
// little where they don't quite fit.
const PAGE_LAYOUT_MIN_WIDTH = 700

// Lives inside the shadow root, so it reaches only the document, and the
// document's own stylesheets (generated from the file) reach nothing else.
const VIEWER_CSS = `
  :host {
    display: block;
    height: 100%;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--mantine-color-default-hover);
    border-radius: var(--mantine-radius-md);
  }

  .docx-wrapper {
    background: transparent;
    padding: 16px 16px 0;
  }

  .docx-wrapper > section.docx {
    box-shadow: var(--mantine-shadow-sm);
    margin-bottom: 16px;
  }

  .reflow {
    min-height: 100%;
    background: #ffffff;
  }

  .reflow .docx-wrapper {
    padding: 0;
    display: block;
  }

  .reflow section.docx {
    width: auto !important;
    min-height: 0 !important;
    padding: 16px !important;
    margin: 0 !important;
    box-shadow: none !important;
    overflow-x: auto;
    overflow-wrap: break-word;
  }

  .reflow section.docx + section.docx {
    border-top: 1px dashed #adb5bd;
  }

  .reflow img {
    max-width: 100% !important;
    height: auto !important;
  }

  a {
    color: #1c7ed6;
  }
`

const OPTIONS = {
  className: "docx",

  inWrapper: true,

  // An altChunk is a piece of raw HTML, which the library would put in a
  // same-origin <iframe srcdoc> — a script in a .docx would run as the app.
  renderAltChunks: false,

  // Images and fonts as data: URLs rather than blob: URLs, which the library
  // never revokes; these go with the DOM when the viewer closes.
  useBase64URL: true,
}

// Word draws its bullets with Symbol and Wingdings, at private-use code points
// only those fonts have a glyph for. Phones don't have the fonts, so lists
// lost their bullets; these are Word's usual ones, as the characters they are.
const SYMBOL_GLYPHS: Record<string, string> = {
  "\uF0B7": "•",
  "\uF0A7": "▪",
  "\uF06E": "■",
  "\uF071": "❑",
  "\uF076": "❖",
  "\uF0D8": "➢",
  "\uF0FC": "✓",
}

const SYMBOL_GLYPH = new RegExp(`[${Object.keys(SYMBOL_GLYPHS).join("")}]`, "g")

// Nor do they have Calibri or Aptos, and a font-family naming only those falls
// back to the browser's default serif. A generic family after them keeps sans
// text sans.
const SANS_FONT =
  /calibri|aptos|arial|helvetica|verdana|segoe|tahoma|trebuchet|century gothic|franklin gothic|gill sans|open sans|roboto|lato/i

function withGenericFont(families: string): string {
  if (/\b(sans-serif|serif|monospace|system-ui)\b|var\(/.test(families)) {
    return families
  }

  return SANS_FONT.test(families) ? `${families}, sans-serif` : families
}

/** Bullets and fonts that phones can draw, in the stylesheets and the text. */
function fixGlyphsAndFonts(root: HTMLElement) {
  const glyphs = (text: string) =>
    text.replace(SYMBOL_GLYPH, (c) => SYMBOL_GLYPHS[c])

  for (const style of root.querySelectorAll("style")) {
    style.textContent = glyphs(style.textContent ?? "").replace(
      /((?:font-family|--docx-[\w-]+-font)\s*:\s*)([^;}]+)/g,
      (_, property: string, value: string) =>
        property + withGenericFont(value.trim()),
    )
  }

  for (const el of root.querySelectorAll<HTMLElement>("[style*='font']")) {
    if (el.style.fontFamily) {
      el.style.fontFamily = withGenericFont(el.style.fontFamily)
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue) node.nodeValue = glyphs(node.nodeValue)
  }
}

/** Scale the pages down to the width of the view, if they're wider. */
function fitPages(host: HTMLElement) {
  const wrapper = host.shadowRoot?.querySelector<HTMLElement>(".docx-wrapper")

  if (!wrapper || wrapper.closest(".reflow")) return

  wrapper.style.zoom = ""

  // The widest page plus the wrapper's padding. Not scrollWidth: the pages are
  // centred, and what overflows to the left isn't counted there.
  const { paddingLeft, paddingRight } = getComputedStyle(wrapper)

  const pages = wrapper.querySelectorAll<HTMLElement>(":scope > section")

  const natural =
    Math.max(0, ...Array.from(pages, (page) => page.offsetWidth)) +
    parseFloat(paddingLeft) +
    parseFloat(paddingRight)

  if (natural > host.clientWidth && host.clientWidth > 0) {
    wrapper.style.zoom = String(host.clientWidth / natural)
  }
}

/**
 * A .docx rendered in the browser with docx-preview: headings, tables,
 * colours, images, headers and footers as in Word, which the server's mammoth
 * preview drops — and for every file, including the ones uploaded before that
 * preview existed. Lazy-loaded; scrolls itself and only needs a height.
 */
export default function DocxViewer({ blobUrl, onError }: DocxViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)

  // Pages or reflowed text, from the width: null until measured, and decided
  // again when a rotation carries the width across the line.
  const [reflow, setReflow] = useState<boolean | null>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    const measure = () => {
      setReflow(host.clientWidth < PAGE_LAYOUT_MIN_WIDTH)

      fitPages(host)
    }

    measure()

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(measure)

    observer.observe(host)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current

    if (!host || reflow === null) return

    let cancelled = false

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" })

    setLoading(true)

    const root = document.createElement("div")

    if (reflow) root.className = "reflow"

    fetch(blobUrl)
      .then((res) => res.arrayBuffer())

      .then((data) =>
        renderAsync(data, root, root, {
          ...OPTIONS,

          ignoreWidth: reflow,

          ignoreHeight: reflow,

          breakPages: !reflow,
        }),
      )

      .then(() => {
        if (cancelled) return

        // Scripts, event handlers, iframes and javascript: links out; the
        // file's own <style> blocks and inline styles stay — the shadow root
        // keeps them to the document.
        DOMPurify.sanitize(root, {
          IN_PLACE: true,
          ADD_TAGS: ["style"],
          FORBID_TAGS: ["form", "input", "button", "textarea", "select"],
        })

        fixGlyphsAndFonts(root)

        for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
          if (!a.getAttribute("href")?.startsWith("#")) {
            a.target = "_blank"

            a.rel = "noopener noreferrer"
          }
        }

        // After the document's own stylesheets, so it wins on a tie.
        const style = document.createElement("style")

        style.textContent = VIEWER_CSS

        shadow.replaceChildren(root, style)

        fitPages(host)

        setLoading(false)
      })

      .catch(() => {
        if (!cancelled) onError()
      })

    return () => {
      cancelled = true
    }
  }, [blobUrl, reflow, onError])

  // A table of contents links to bookmarks by #id. Inside a shadow root the
  // browser can't find them, and would only change the page's own URL.
  const handleClick = (e: MouseEvent) => {
    const target = e.nativeEvent.composedPath()[0]

    const link = target instanceof Element ? target.closest("a") : null

    const href = link?.getAttribute("href")

    if (!href?.startsWith("#")) return

    e.preventDefault()

    hostRef.current?.shadowRoot
      ?.getElementById(decodeURIComponent(href.slice(1)))
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* Positioned out of the flow, so a page wider than the view can't
          stretch the carousel slide around it: it gets scaled to fit. */}
      <div
        ref={hostRef}
        onClick={handleClick}
        style={{ position: "absolute", inset: 0 }}
      />
      {loading && (
        <Center pos="absolute" inset={0}>
          <Loader />
        </Center>
      )}
    </div>
  )
}
