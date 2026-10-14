import { describe, it, expect, vi, beforeEach } from "vitest"

import { act, render } from "@testing-library/react"

import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom"

import { useScrollToTopOnNavigate } from "./useScrollToTopOnNavigate"

let navigate: NavigateFunction

function Probe() {
  useScrollToTopOnNavigate()

  navigate = useNavigate()

  return null
}

describe("useScrollToTopOnNavigate", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()

    render(
      <MemoryRouter initialEntries={["/forum/faelles"]}>
        <Probe />
      </MemoryRouter>,
    )

    vi.mocked(window.scrollTo).mockClear()
  })

  it("opens a new page at the top", () => {
    act(() => navigate("/forum/faelles/traad/mad-tilmelding"))

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("leaves a link to an anchor to the page that owns it", () => {
    act(() => navigate("/forum/faelles/traad/mad-tilmelding#post-7"))

    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("leaves back/forward to the browser", () => {
    act(() => navigate("/forum/faelles/traad/mad-tilmelding"))

    vi.mocked(window.scrollTo).mockClear()

    act(() => navigate(-1))

    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("does not reset for a change of query on the same page", () => {
    act(() => navigate("/forum/faelles?side=2"))

    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
