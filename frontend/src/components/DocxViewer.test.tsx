import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import JSZip from "jszip"

import { render } from "../test/testUtils"

import DocxViewer from "./DocxViewer"

import { WordPreview, type FileActions } from "./FilePreview"

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

const REL = "http://schemas.openxmlformats.org/package/2006/relationships"

/**
 * A minimal .docx with everything the viewer must defuse or repair: a
 * javascript: hyperlink, an altChunk of HTML with a script in it, and a list
 * bulleted with Symbol's private-use bullet, as Word writes it.
 */
async function makeDocx(): Promise<ArrayBuffer> {
  const zip = new JSZip()

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="html" ContentType="text/html"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
    </Types>`,
  )

  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="${REL}">
      <Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  )

  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="${REL}">
      <Relationship Id="rId1" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
      <Relationship Id="rId2" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>
      <Relationship Id="rId3" Type="${R}/aFChunk" Target="afchunk.html"/>
      <Relationship Id="rId4" Type="${R}/numbering" Target="numbering.xml"/>
    </Relationships>`,
  )

  zip.file(
    "word/afchunk.html",
    "<html><body><p>ALTCHUNK</p><script>parent.hacked = true</script></body></html>",
  )

  zip.file(
    "word/numbering.xml",
    `<w:numbering xmlns:w="${W}">
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
          <w:start w:val="1"/>
          <w:numFmt w:val="bullet"/>
          <w:lvlText w:val=""/>
          <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
        </w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    </w:numbering>`,
  )

  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${W}" xmlns:r="${R}">
      <w:body>
        <w:p><w:r><w:t>Referat fra mødet</w:t></w:r></w:p>
        <w:p><w:hyperlink r:id="rId1"><w:r><w:t>ondt link</w:t></w:r></w:hyperlink></w:p>
        <w:p><w:hyperlink r:id="rId2"><w:r><w:t>godt link</w:t></w:r></w:hyperlink></w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
          <w:r><w:t>Punkt</w:t></w:r>
        </w:p>
        <w:altChunk r:id="rId3"/>
        <w:sectPr>
          <w:pgSz w:w="11906" w:h="16838"/>
          <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
        </w:sectPr>
      </w:body>
    </w:document>`,
  )

  return zip.generateAsync({ type: "arraybuffer" })
}

function serve(body: BodyInit) {
  globalThis.fetch = vi.fn(async () => new Response(body))
}

/** The shadow root the viewer renders into, once it has rendered. */
async function renderedDocument(container: HTMLElement): Promise<ShadowRoot> {
  let root: ShadowRoot | null = null

  await waitFor(() => {
    root =
      Array.from(container.querySelectorAll("div")).find((div) =>
        div.shadowRoot?.querySelector("section.docx"),
      )?.shadowRoot ?? null

    expect(root).not.toBeNull()
  })

  return root!
}

function makeActions(overrides: Partial<FileActions> = {}): FileActions {
  return {
    fileType: "word",

    blobUrl: "blob:fake",

    blobError: false,

    canShare: false,

    actionsDisabled: false,

    handleOpen: vi.fn(),

    handleDownload: vi.fn(),

    ...overrides,
  }
}

describe("DocxViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the document's text", async () => {
    serve(await makeDocx())

    const { container } = render(
      <DocxViewer blobUrl="blob:fake" onError={vi.fn()} />,
    )

    const root = await renderedDocument(container)

    expect(root.textContent).toContain("Referat fra mødet")
  })

  it("drops javascript: links and never renders an altChunk", async () => {
    serve(await makeDocx())

    const { container } = render(
      <DocxViewer blobUrl="blob:fake" onError={vi.fn()} />,
    )

    const root = await renderedDocument(container)

    const links = Array.from(root.querySelectorAll("a"))

    const bad = links.find((a) => a.textContent === "ondt link")

    const good = links.find((a) => a.textContent === "godt link")

    expect(bad?.getAttribute("href") ?? "").not.toMatch(/javascript/i)

    expect(good?.getAttribute("href")).toBe("https://example.com/")

    expect(good?.target).toBe("_blank")

    expect(good?.rel).toBe("noopener noreferrer")

    // The library would put the altChunk's HTML in a same-origin iframe.
    expect(root.querySelector("iframe, script")).toBeNull()

    expect(root.textContent).not.toContain("ALTCHUNK")
  })

  it("draws Word's Symbol bullet as a real bullet", async () => {
    serve(await makeDocx())

    const { container } = render(
      <DocxViewer blobUrl="blob:fake" onError={vi.fn()} />,
    )

    const root = await renderedDocument(container)

    const css = Array.from(root.querySelectorAll("style"))
      .map((style) => style.textContent)
      .join("\n")

    expect(css).toContain("•")

    expect(css).not.toContain("")
  })

  it("reports a file it can't read instead of rendering nothing", async () => {
    serve("not a zip file")

    const onError = vi.fn()

    render(<DocxViewer blobUrl="blob:fake" onError={onError} />)

    await waitFor(() => expect(onError).toHaveBeenCalled())
  })
})

describe("WordPreview", () => {
  it("falls back to the server preview when the file won't render", async () => {
    serve("not a zip file")

    render(
      <WordPreview
        file={{
          name: "referat.docx",
          file_url: "/media/referat.docx",
          preview_html: "<p>Serverens udgave</p>",
        }}
        actions={makeActions()}
      />,
    )

    expect(await screen.findByText("Serverens udgave")).toBeInTheDocument()

    expect(screen.getByRole("button", { name: "Gem" })).toBeInTheDocument()
  })

  it("says so, and offers Gem, when there is nothing to show", async () => {
    serve("not a zip file")

    render(
      <WordPreview
        file={{ name: "referat.docx", file_url: "/media/referat.docx" }}
        actions={makeActions()}
      />,
    )

    expect(
      await screen.findByText(/Dokumentet kan ikke vises her/),
    ).toBeInTheDocument()

    expect(screen.getByRole("button", { name: "Gem" })).toBeInTheDocument()
  })

  it("doesn't try to render formats other than .docx", () => {
    globalThis.fetch = vi.fn()

    render(
      <WordPreview
        file={{ name: "vedtægter.rtf", file_url: "/media/vedtægter.rtf" }}
        actions={makeActions()}
      />,
    )

    expect(
      screen.getByText(/Dokumentet kan ikke vises her/),
    ).toBeInTheDocument()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
