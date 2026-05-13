const DANISH_PLATE_RE = /^[A-Z]{2}\d{5}$/

function normalize(plate: string): string {
  return plate.toUpperCase().replace(/\s+/g, "")
}

export function formatLicensePlate(plate: string): string {
  const norm = normalize(plate)
  if (DANISH_PLATE_RE.test(norm)) {
    return `${norm.slice(0, 2)} ${norm.slice(2, 4)} ${norm.slice(4, 7)}`
  }
  return norm
}
