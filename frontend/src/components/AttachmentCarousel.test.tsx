import { describe, it, expect, vi, beforeEach } from "vitest"

import { screen } from "@testing-library/react"

import { render } from "../test/testUtils"

import { AttachmentCarousel } from "./AttachmentCarousel"

const photos = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  name: `foto-${i + 1}.jpg`,
  file_url: `/media/foto-${i + 1}.jpg`,
}))

describe("AttachmentCarousel", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}))
  })

  it("renders only the opened photo and its neighbours, not all nine", () => {
    render(
      <AttachmentCarousel
        attachments={photos}
        opened
        onClose={() => {}}
        initialIndex={4}
      />,
    )

    const shown = screen
      .getAllByRole("img")
      .map((img) => img.getAttribute("alt"))
      .filter((alt) => alt?.startsWith("foto-"))

    expect(shown.sort()).toEqual(["foto-4.jpg", "foto-5.jpg", "foto-6.jpg"])
  })
})
