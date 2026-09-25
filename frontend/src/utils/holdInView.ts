/**
 * Scroll the window so `el` sits just under the fixed header, and keep it
 * there while the page settles (images above it loading), until the reader
 * scrolls or taps. Instant — no animation to sit through in a long thread.
 * Returns a function that lets go.
 */
export function holdInView(el: HTMLElement): () => void {
  const place = () => {
    if (!el.isConnected) return release()

    const header = document.querySelector(".mantine-AppShell-header")

    const headerBottom = header?.getBoundingClientRect().bottom ?? 0

    window.scrollTo(
      0,
      window.scrollY + el.getBoundingClientRect().top - headerBottom - 8,
    )
  }

  const observer = new ResizeObserver(place)

  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const

  const release = () => {
    observer.disconnect()

    inputs.forEach((type) => window.removeEventListener(type, release))
  }

  place()

  observer.observe(document.body)

  inputs.forEach((type) =>
    window.addEventListener(type, release, { passive: true }),
  )

  return release
}
