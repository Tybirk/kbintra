import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { screen, waitFor } from "@testing-library/react"

import { render } from "../test/testUtils"

import {
  FileActionButtons,
  getRenderableFileType,
  type FileActions,
} from "./FilePreview"

/** Make useMediaQuery("(pointer: coarse)") report a touch device. */
function mockPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query.includes("coarse"),

    media: query,

    onchange: null,

    addListener: vi.fn(),

    removeListener: vi.fn(),

    addEventListener: vi.fn(),

    removeEventListener: vi.fn(),

    dispatchEvent: vi.fn(),
  }))
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

describe("FileActionButtons", () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it("hides the share button for files the browser refuses to share", async () => {
    // Chrome/Android rejects Office documents, so "Del" would only ever fall
    // back to the download that "Gem" already does.
    mockPointer(true)

    render(<FileActionButtons actions={makeActions({ canShare: false })} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Gem" })).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("button", { name: "Del" }),
    ).not.toBeInTheDocument()
  })

  it("shows the share button when the browser accepts the file", async () => {
    mockPointer(true)

    render(<FileActionButtons actions={makeActions({ canShare: true })} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Del" })).toBeInTheDocument()
    })
  })

  it("always offers PDFs, which open in a tab when sharing is unavailable", async () => {
    mockPointer(false)

    render(
      <FileActionButtons
        actions={makeActions({ fileType: "pdf", canShare: false })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Åbn" })).toBeInTheDocument()
    })
  })

  it("hides the share button for non-PDFs on desktop", async () => {
    mockPointer(false)

    render(<FileActionButtons actions={makeActions({ canShare: true })} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Gem" })).toBeInTheDocument()
    })

    expect(
      screen.queryByRole("button", { name: /Åbn|Del/ }),
    ).not.toBeInTheDocument()
  })
})

describe("getRenderableFileType", () => {
  it("treats HEIC as an image only when a converted preview exists", () => {
    const withPreview = {
      name: "iphone.heic",
      file_url: "/media/x/iphone.heic",
      preview_url: "/media/x/previews/1.jpg",
    }

    const withoutPreview = {
      name: "iphone.heic",
      file_url: "/media/x/iphone.heic",
    }

    expect(getRenderableFileType(withPreview)).toBe("image")

    // No preview (forum documents, search results) — an <img> here would be
    // broken in every browser but Safari, so fall back to the file tile.
    expect(getRenderableFileType(withoutPreview)).toBe("other")
  })

  it("leaves ordinary images and documents alone", () => {
    expect(
      getRenderableFileType({ name: "foto.jpg", file_url: "/media/foto.jpg" }),
    ).toBe("image")

    expect(
      getRenderableFileType({
        name: "notat.docx",
        file_url: "/media/notat.docx",
      }),
    ).toBe("word")

    expect(
      getRenderableFileType({
        name: "rapport.pdf",
        file_url: "/media/rapport.pdf",
      }),
    ).toBe("pdf")
  })

  it("is case-insensitive about the extension", () => {
    expect(
      getRenderableFileType({ name: "IMG_0881.HEIC", file_url: "/x" }),
    ).toBe("other")

    expect(
      getRenderableFileType({
        name: "IMG_0881.HEIF",
        file_url: "/x",
        preview_url: "/p.jpg",
      }),
    ).toBe("image")
  })
})
