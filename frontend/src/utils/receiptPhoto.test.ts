import { describe, expect, it, vi } from "vitest"

import {
  COMPRESS_ABOVE_BYTES,
  MAX_LONG_EDGE_PX,
  isCompressiblePhoto,
  jpegFileName,
  prepareExpenseAttachment,
  scaledDimensions,
} from "./receiptPhoto"

import { EXPENSE_MAX_ATTACHMENT_SIZE } from "../config"

function fileOfSize(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type })
  Object.defineProperty(file, "size", { value: size })
  return file
}

const BIG = COMPRESS_ABOVE_BYTES + 1
const TOO_BIG = EXPENSE_MAX_ATTACHMENT_SIZE + 1

describe("isCompressiblePhoto", () => {
  it.each([
    ["IMG_1.JPG", "image/jpeg"],
    ["skaerm.png", "image/png"],
    ["IMG_2.HEIC", "image/heic"],
    // Some browsers give HEIC an empty type, so the name has to be enough.
    ["IMG_3.heic", ""],
  ])("accepts %s (%s)", (name, type) => {
    expect(isCompressiblePhoto(new File(["x"], name, { type }))).toBe(true)
  })

  it.each([
    ["bon.pdf", "application/pdf"],
    ["bilag.zip", "application/zip"],
    ["logo.svg", "image/svg+xml"],
    ["sjov.gif", "image/gif"],
  ])("leaves %s alone", (name, type) => {
    expect(isCompressiblePhoto(new File(["x"], name, { type }))).toBe(false)
  })
})

describe("scaledDimensions", () => {
  it("caps the long edge and keeps the aspect ratio", () => {
    expect(scaledDimensions(4032, 3024)).toEqual({
      width: MAX_LONG_EDGE_PX,
      height: 1800,
    })
    expect(scaledDimensions(3024, 4032)).toEqual({
      width: 1800,
      height: MAX_LONG_EDGE_PX,
    })
  })

  it("never upscales a small picture", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe("jpegFileName", () => {
  it("swaps the extension", () => {
    expect(jpegFileName("IMG_0001.HEIC")).toBe("IMG_0001.jpg")
    expect(jpegFileName("bon.fra.netto.png")).toBe("bon.fra.netto.jpg")
  })

  it("adds an extension when there is none", () => {
    expect(jpegFileName("kvittering")).toBe("kvittering.jpg")
  })
})

describe("prepareExpenseAttachment", () => {
  it("replaces a big photo with the smaller version", async () => {
    const photo = fileOfSize("IMG.jpg", "image/jpeg", TOO_BIG)
    const small = fileOfSize("IMG.jpg", "image/jpeg", 900_000)
    const result = await prepareExpenseAttachment(photo, async () => small)
    expect(result).toEqual({ file: small })
  })

  it("does not touch a small photo", async () => {
    const photo = fileOfSize("IMG.jpg", "image/jpeg", COMPRESS_ABOVE_BYTES)
    const compress = vi.fn()
    expect(await prepareExpenseAttachment(photo, compress)).toEqual({
      file: photo,
    })
    expect(compress).not.toHaveBeenCalled()
  })

  it("never compresses a PDF", async () => {
    const pdf = fileOfSize("bon.pdf", "application/pdf", BIG)
    const compress = vi.fn()
    expect(await prepareExpenseAttachment(pdf, compress)).toEqual({ file: pdf })
    expect(compress).not.toHaveBeenCalled()
  })

  it("keeps the original if re-encoding would make it bigger", async () => {
    const photo = fileOfSize("IMG.jpg", "image/jpeg", BIG)
    const larger = fileOfSize("IMG.jpg", "image/jpeg", BIG + 1)
    expect(await prepareExpenseAttachment(photo, async () => larger)).toEqual({
      file: photo,
    })
  })

  it("falls back to the original when the browser cannot decode it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const heic = fileOfSize("IMG.HEIC", "image/heic", BIG)
    const failing = () => Promise.reject(new Error("no decoder"))
    expect(await prepareExpenseAttachment(heic, failing)).toEqual({
      file: heic,
    })
  })

  it("explains what to do with a photo it could not shrink", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const heic = fileOfSize("IMG.HEIC", "image/heic", TOO_BIG)
    const failing = () => Promise.reject(new Error("no decoder"))
    const result = await prepareExpenseAttachment(heic, failing)
    expect(result).toEqual({ error: expect.stringContaining("skærmbillede") })
    expect(result).toEqual({ error: expect.stringContaining("IMG.HEIC") })
  })

  it("tells the owner of a huge PDF to attach the photos one by one", async () => {
    const pdf = fileOfSize("alle-bilag.pdf", "application/pdf", 32_000_000)
    const result = await prepareExpenseAttachment(pdf, vi.fn())
    expect(result).toEqual({ error: expect.stringContaining("32,0 MB") })
    expect(result).toEqual({ error: expect.stringContaining("hver for sig") })
  })

  it("accepts a PDF exactly at the limit", async () => {
    const pdf = fileOfSize(
      "bon.pdf",
      "application/pdf",
      EXPENSE_MAX_ATTACHMENT_SIZE,
    )
    expect(await prepareExpenseAttachment(pdf, vi.fn())).toEqual({ file: pdf })
  })
})
