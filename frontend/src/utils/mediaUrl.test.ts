import { describe, it, expect } from "vitest"

import { unsignedMediaUrl } from "./mediaUrl"

describe("unsignedMediaUrl", () => {
  it("drops the signature so a copied link doesn't expire or leak", () => {
    expect(
      unsignedMediaUrl(
        "/media/forum_files/referat.pdf?exp=1770000000&sig=abc123",
      ),
    ).toBe("/media/forum_files/referat.pdf")
  })

  it("leaves an unsigned URL untouched", () => {
    expect(unsignedMediaUrl("/media/forum_files/referat.pdf")).toBe(
      "/media/forum_files/referat.pdf",
    )
  })

  it("handles absolute URLs", () => {
    expect(
      unsignedMediaUrl("https://kb-intra.dk/media/a.png?exp=1&sig=z"),
    ).toBe("https://kb-intra.dk/media/a.png")
  })
})
