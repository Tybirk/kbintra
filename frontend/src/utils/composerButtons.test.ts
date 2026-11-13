import { describe, it, expect } from "vitest"

import { buttonsStand } from "./composerButtons"

// One line of text is 23 px; three buttons standing make 106 px.
const line = 23

const column = 106

describe("buttonsStand", () => {
  it("keeps them lying while the text is lower than the column", () => {
    expect(buttonsStand(false, 37, line, column)).toBe(false)

    expect(buttonsStand(false, 84, line, column)).toBe(false)
  })

  it("stands them up once the text is as tall as the column", () => {
    expect(buttonsStand(false, 107, line, column)).toBe(true)
  })

  it("keeps them standing when the wider box takes fewer lines", () => {
    // Four lines in a row became three beside the column: still standing.
    expect(buttonsStand(true, 84, line, column)).toBe(true)

    expect(buttonsStand(true, 61, line, column)).toBe(true)
  })

  it("lies them down when the text fits on one line", () => {
    expect(buttonsStand(true, 37, line, column)).toBe(false)
  })
})
