import { webcrypto } from "node:crypto"
import "@testing-library/jest-dom"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/da"

dayjs.locale("da")
dayjs.extend(relativeTime)

// Clean up after each test
afterEach(() => {
  cleanup()
})

// Polyfill crypto.subtle for jsdom (Node provides it but jsdom strips it)
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
  })
}

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

window.ResizeObserver = ResizeObserverMock

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

window.IntersectionObserver =
  (IntersectionObserverMock as unknown as typeof IntersectionObserver)

// Define __APP_VERSION__ global used by ProfilePage (normally injected by Vite)
;(globalThis as Record<string, unknown>).__APP_VERSION__ =
  new Date().toISOString()
