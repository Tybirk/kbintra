import { describe, it, expect, vi, afterEach } from "vitest"

import { screen } from "@testing-library/react"

import { render } from "../test/testUtils"

import ChatRichTextEditor from "./ChatRichTextEditor"

/** Answer the media queries as a device with this pointer would. */
const pretendPointer = (pointer: "fine" | "coarse") => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({
        matches: query === `(pointer: ${pointer})`,

        media: query,

        onchange: null,

        addListener: vi.fn(),

        removeListener: vi.fn(),

        addEventListener: vi.fn(),

        removeEventListener: vi.fn(),

        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

const renderEditor = () =>
  render(
    <ChatRichTextEditor
      content=""
      onChange={() => {}}
      onSend={() => {}}
      attachments={[]}
      onAttachmentsChange={() => {}}
      onCreatePoll={() => {}}
    />,
  )

describe("ChatRichTextEditor attach buttons", () => {
  afterEach(() => {
    pretendPointer("fine")
  })

  it("gives a computer one button for files and pictures alike", () => {
    // Its file dialog is the same for both; a photo button only filtered it.
    pretendPointer("fine")

    renderEditor()

    expect(screen.getByTitle("Vedhæft fil eller billede")).toBeInTheDocument()

    expect(screen.queryByTitle("Vælg billeder")).not.toBeInTheDocument()
  })

  it("keeps the photo button on a phone or tablet", () => {
    // There it opens the photo library or camera, the paperclip the files.
    pretendPointer("coarse")

    renderEditor()

    expect(screen.getByTitle("Vælg billeder")).toBeInTheDocument()

    expect(screen.getByTitle("Vedhæft fil")).toBeInTheDocument()
  })
})
