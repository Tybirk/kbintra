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

let locationKey = ""

interface PageProps {
  settled?: boolean

  withPost?: boolean
}

function Page({ settled = true, withPost = true }: PageProps) {
  useHoldHashTarget(true, settled)

  navigate = useNavigate()

  locationKey = useLocation().key

  return withPost ? <div id="post-7">Indlæg</div> : <div>Tråd</div>
}

function renderAt(url: string, props: PageProps = {}) {
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <Page {...props} />
    </MemoryRouter>,
  )

  return (next: PageProps) =>
    view.rerender(
      <MemoryRouter initialEntries={[url]}>
        <Page {...next} />
      </MemoryRouter>,
    )
}

describe("useHoldHashTarget", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
  })

  it("scrolls to the linked element without a new router entry", () => {
    renderAt("/forum/faelles/traad/mad#post-7")

    const key = locationKey

    expect(window.scrollTo).toHaveBeenCalled()

    // A replace through the router would change the key, and BackButton would
    // then offer a "Tilbage" with nothing behind it on a cold start.
    expect(locationKey).toBe(key)
  })

  it("follows the same link a second time", () => {
    renderAt("/forum/faelles/traad/mad#post-7")

    vi.mocked(window.scrollTo).mockClear()

    act(() => navigate("/forum/faelles/traad/mad#post-7"))

    expect(window.scrollTo).toHaveBeenCalled()
  })

  it("waits for the fresh copy before deciding the post is missing", () => {
    // A cached thread without the new reply, refetch in flight.
    const rerender = renderAt("/forum/faelles/traad/mad#post-7", {
      settled: false,
      withPost: false,
    })

    expect(window.scrollTo).not.toHaveBeenCalled()

    rerender({ settled: true, withPost: true })

    expect(window.scrollTo).toHaveBeenCalled()

    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0)
  })

  it("opens at the top when the linked post is gone", () => {
    // Arriving from a scrolled page; a cold start is at the top already.
    renderAt("/forum/faelles")

    act(() => navigate("/forum/faelles/traad/mad#post-999"))

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("leaves the page alone for an in-page anchor to nothing", () => {
    // A plain <a href="#afsnit"> inside a post arrives as a POP.
    render(
      <MemoryRouter
        initialEntries={[
          "/forum/faelles/traad/mad#afsnit",
          "/forum/faelles/traad/mad",
        ]}
        initialIndex={1}
      >
        <Page />
      </MemoryRouter>,
    )

    act(() => navigate(-1))

    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0)
  })
})
