/**
 * Makes phone photos small enough to attach to an udlæg.
 *
 * A receipt only has to stay readable, so photos are downscaled and re-encoded
 * as JPEG in the browser before upload. Everything else (PDFs, ...) is left
 * alone. Compression is best effort: if the browser cannot decode a file (Chrome
 * and Firefox cannot read HEIC) the original is kept, and the server, which can,
 * takes it from there.
 */

import {
  EXPENSE_MAX_ATTACHMENT_SIZE,
  EXPENSE_MAX_ATTACHMENT_SIZE_MB,
} from "../config"

// Enough to read a crumpled kassebon when zoomed in; the merged PDF for the
// accounting program is rendered at a lower resolution than this anyway.
export const MAX_LONG_EDGE_PX = 2400
const JPEG_QUALITY = 0.82

// Below this a file costs nothing to keep as it is, and a MobilePay screenshot
// stays pixel-sharp.
export const COMPRESS_ABOVE_BYTES = 2_000_000

const PHOTO_EXTENSION = /\.(jpe?g|png|webp|hei[cf])$/i
const PHOTO_MIME_TYPE = /^image\/(jpeg|png|webp|hei[cf])$/i

export type PreparedAttachment = { file: File } | { error: string }

export function isCompressiblePhoto(file: File): boolean {
  return PHOTO_MIME_TYPE.test(file.type) || PHOTO_EXTENSION.test(file.name)
}

/** Pixel size that fits the long-edge cap, keeping the aspect ratio. */
export function scaledDimensions(width: number, height: number) {
  const scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(width, height))
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

export function jpegFileName(name: string): string {
  return `${name.replace(/\.[^.]*$/, "")}.jpg`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Could not decode image"))
    image.src = url
  })
}

function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode image")),
      "image/jpeg",
      JPEG_QUALITY,
    )
  })
}

/**
 * Re-encode a photo as a downscaled JPEG. Throws if the browser cannot.
 *
 * Goes through <img> rather than createImageBitmap: <img> applies the EXIF
 * rotation in every browser we support, and also decodes HEIC in Safari.
 */
export async function compressPhoto(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const { width, height } = scaledDimensions(
      image.naturalWidth,
      image.naturalHeight,
    )
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No canvas context")
    // JPEG has no transparency; a see-through PNG would otherwise turn black.
    context.fillStyle = "white"
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = "high"
    context.drawImage(image, 0, 0, width, height)
    const blob = await encodeJpeg(canvas)
    return new File([blob], jpegFileName(file.name), { type: "image/jpeg" })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function tooBigMessage(file: File): string {
  const sizeMb = (file.size / 1_000_000).toFixed(1).replace(".", ",")
  const prefix = `"${file.name}" fylder ${sizeMb} MB, og et bilag må højst fylde ${EXPENSE_MAX_ATTACHMENT_SIZE_MB} MB.`
  return isCompressiblePhoto(file)
    ? `${prefix} Billedet kunne ikke gøres mindre automatisk. Tag et nyt billede af bonen, eller send et skærmbillede af det i stedet.`
    : `${prefix} Del filen op i flere mindre filer. Har du samlet billeder i én PDF eller zip-fil, så vedhæft i stedet billederne hver for sig; de bliver gjort mindre automatisk.`
}

/** Shrink a picked file if it is a big photo, and check it fits the limit. */
export async function prepareExpenseAttachment(
  file: File,
  compress: (file: File) => Promise<File> = compressPhoto,
): Promise<PreparedAttachment> {
  let result = file
  if (file.size > COMPRESS_ABOVE_BYTES && isCompressiblePhoto(file)) {
    try {
      const smaller = await compress(file)
      if (smaller.size < file.size) result = smaller
    } catch (error) {
      console.warn("Could not compress receipt photo", error)
    }
  }
  if (result.size > EXPENSE_MAX_ATTACHMENT_SIZE) {
    return { error: tooBigMessage(file) }
  }
  return { file: result }
}
