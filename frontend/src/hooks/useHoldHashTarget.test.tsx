import { describe, it, expect, vi, beforeEach } from "vitest"

import { act, render } from "@testing-library/react"

import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom"

import { useHoldHashTarget } from "./useHoldHashTarget"

let navigate: NavigateFunction

let currentHash = ""

function Page() {
  useHoldHashTarget(true)

  navigate = useNavigate()

  currentHash = useLocation().hash

  return <div id="post-7">Indlæg</div>
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page />
    </MemoryRouter>,
  )
}

describe("useHoldHashTarget", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
  })

  it("scrolls to the linked element and consumes the hash", () => {
    renderAt("/forum/faelles/traad/mad#post-7")

    expect(window.scrollTo).toHaveBeenCalled()

    expect(currentHash).toBe("")
  })

  it("follows the same link a second time", () => {
    renderAt("/forum/faelles/traad/mad#post-7")

    vi.mocked(window.scrollTo).mockClear()

    act(() => navigate("/forum/faelles/traad/mad#post-7"))

    expect(window.scrollTo).toHaveBeenCalled()
  })

  it("opens at the top when the hash names nothing", () => {
    renderAt("/forum/faelles/traad/mad#post-999")

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)

    expect(currentHash).toBe("")
  })
})
