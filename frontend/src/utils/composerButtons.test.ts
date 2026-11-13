import { describe, it, expect } from "vitest"

import { buttonColumns, buttonsWidth } from "./composerButtons"

// Buttons of 34 px, 2 px apart; a line of text is 23 px, plus 14 px of
// padding and border; a character is 10 px wide.
const button = 34

const gap = 2

const line = 23

/** The text's height in a box that is `boxWithRow` wide beside a row of `count`. */
const textOf =
  (characters: number, count: number, boxWithRow: number) =>
  (columns: number) => {
    const box =
      boxWithRow +
      buttonsWidth(count, button, gap) -
      buttonsWidth(columns, button, gap)

    const lines = Math.max(1, Math.ceil((characters * 10) / (box - 20)))

    return lines * line + 14
  }

describe("buttonColumns", () => {
  it("keeps three buttons in a row for a line of text", () => {
    expect(buttonColumns(3, button, gap, line, textOf(10, 3, 174))).toBe(3)
  })

  it("puts them in two rows once the text takes two lines there", () => {
    // 30 characters: two lines in the 210 px box two columns leave.
    expect(buttonColumns(3, button, gap, line, textOf(30, 3, 174))).toBe(2)
  })

  it("keeps the row when the wider box would hold the text on one line", () => {
    // 17 characters: two lines beside a row (154 px of text), one beside two
    // columns (190 px). Going to two rows would only flip back.
    expect(buttonColumns(3, button, gap, line, textOf(17, 3, 174))).toBe(3)
  })

  it("stands them in one column once the text is four lines there", () => {
    expect(buttonColumns(3, button, gap, line, textOf(90, 3, 174))).toBe(1)
  })

  it("puts four buttons two by two, never three and one", () => {
    expect(buttonColumns(4, button, gap, line, textOf(60, 4, 318))).toBe(2)

    expect(buttonColumns(4, button, gap, line, textOf(400, 4, 318))).toBe(1)
  })
})
