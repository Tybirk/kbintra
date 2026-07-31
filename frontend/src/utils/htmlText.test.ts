import { describe, it, expect } from "vitest"

import { htmlToPlainText, htmlToPreview } from "./htmlText"

describe("htmlToPlainText", () => {
  it("decodes HTML entities instead of leaking them into the text", () => {
    expect(htmlToPlainText("<p>Kære&nbsp;KB&#39;er</p>")).toBe("Kære KB'er")

    expect(htmlToPlainText("<p>Ost &amp; skinke</p>")).toBe("Ost & skinke")

    expect(htmlToPlainText("<p>3 &lt; 5</p>")).toBe("3 < 5")
  })

  it("separates block elements but keeps words with inline markup intact", () => {
    expect(htmlToPlainText("<p>Hej</p><p>Verden</p>")).toBe("Hej Verden")

    expect(htmlToPlainText("<p>Linje<br>Brud</p>")).toBe("Linje Brud")

    expect(htmlToPlainText("<ul><li>Et</li><li>To</li></ul>")).toBe("Et To")

    expect(htmlToPlainText("<p><strong>ord</strong>ner</p>")).toBe("ordner")
  })

  it("collapses whitespace and trims", () => {
    expect(htmlToPlainText("<p>  meget \n\n  luft  </p>")).toBe("meget luft")
  })

  it("returns an empty string for empty input", () => {
    expect(htmlToPlainText("")).toBe("")
  })

  it("does not execute or leak script content markup", () => {
    expect(htmlToPlainText("<p>ok</p><script>alert(1)</script>")).toBe(
      "ok alert(1)",
    )
  })
})

describe("htmlToPreview", () => {
  it("truncates with an ellipsis past the limit", () => {
    expect(htmlToPreview("<p>abcdefghij</p>", 4)).toBe("abcd...")
  })

  it("leaves short text untouched", () => {
    expect(htmlToPreview("<p>abc</p>", 10)).toBe("abc")
  })

  it("counts decoded text, not markup", () => {
    expect(htmlToPreview("<p><em>abc</em>&nbsp;def</p>", 7)).toBe("abc def")
  })
})
