import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import type { RefObject } from "react"

import type { Message } from "../types"

/**
 * Scrolling for a chat, as one rule: the view holds on to an anchor, and only
 * the reader moves it.
 *
 * - `"bottom"`: the reader is at the newest message; the view stays there while
 *   content grows (new messages, images finishing loading).
 * - a message and `"centre"`: opened from a link to it; the view keeps it
 *   centred while the page settles, loading older pages until it exists, and
 *   lets go on the reader's first input. A link to the newest message (a
 *   new-message push) turns into `"bottom"` once the conversation carries on.
 * - a message and an offset: the reader has scrolled into the history; the
 *   message at the top of the view stays exactly where it is, whatever changes
 *   around it — an older page arriving, an edit, reaction or deletion above,
 *   an image loading, a refetch.
 *
 * Sending is the reader's act too: the page calls `followBottom()`. Every jump
 * is instant — no animation to sit through in a long conversation.
 */

/** A message, and where in the view it is held: centred, or px below the top. */
interface MessageAnchor {
  id: string

  offset: number | "centre"
}

type Anchor = "bottom" | MessageAnchor

const MESSAGE_ID_PREFIX = "msg-"

/** The element id a message is rendered with, and a link to it points at. */
export const messageElementId = (id: number) => `${MESSAGE_ID_PREFIX}${id}`

const NEAR_BOTTOM_PX = 40

const LOAD_OLDER_WITHIN_PX = 300

interface ChatScrollOptions {
  messages: Message[]

  hasOlder: boolean

  isLoadingOlder: boolean

  loadOlder: () => void

  /** Element id of a message to open at, as made by `messageElementId`. */
  targetId: string | null
}

export function useChatScroll(
  viewportRef: RefObject<HTMLDivElement | null>,

  contentRef: RefObject<HTMLDivElement | null>,

  {
    messages,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    targetId,
  }: ChatScrollOptions,
) {
  const anchorRef = useRef<Anchor>(
    targetId ? { id: targetId, offset: "centre" } : "bottom",
  )

  const lastIdRef = useRef<number | undefined>(undefined)

  const loadOlderRef = useRef<() => void>(() => {})

  loadOlderRef.current = hasOlder && !isLoadingOlder ? loadOlder : () => {}

  const holdAnchor = useCallback(() => {
    const viewport = viewportRef.current

    const anchor = anchorRef.current

    if (!viewport) return

    if (anchor === "bottom") {
      viewport.scrollTop = viewport.scrollHeight

      return
    }

    const el = document.getElementById(anchor.id)

    if (!el) return

    const wanted =
      anchor.offset === "centre"
        ? (viewport.clientHeight - el.offsetHeight) / 2
        : anchor.offset

    // Scroll the viewport only; scrollIntoView would also scroll the page around it.
    viewport.scrollTop +=
      el.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      wanted
  }, [viewportRef])

  /** The message at the top of the view, and how far below the top it sits. */
  const readerAnchor = useCallback((): MessageAnchor | null => {
    const viewport = viewportRef.current

    const content = contentRef.current

    if (!viewport || !content) return null

    const top = viewport.getBoundingClientRect().top

    const rendered = content.querySelectorAll<HTMLElement>(
      `[id^="${MESSAGE_ID_PREFIX}"]`,
    )

    // The first message whose bottom edge is below the top of the view.
    let low = 0

    let high = rendered.length - 1

    let found: HTMLElement | null = null

    while (low <= high) {
      const mid = (low + high) >> 1

      if (rendered[mid].getBoundingClientRect().bottom > top) {
        found = rendered[mid]

        high = mid - 1
      } else {
        low = mid + 1
      }
    }

    return found
      ? { id: found.id, offset: found.getBoundingClientRect().top - top }
      : null
  }, [viewportRef, contentRef])

  // A new link target in the same conversation (e.g. a second notification).
  useEffect(() => {
    if (!targetId) return

    anchorRef.current = { id: targetId, offset: "centre" }

    holdAnchor()
  }, [targetId, holdAnchor])

  // Messages changed: put the anchor back where it was, before the paint.
  useLayoutEffect(() => {
    const anchor = anchorRef.current

    const previousLast = lastIdRef.current

    lastIdRef.current = messages.at(-1)?.id

    if (
      previousLast !== undefined &&
      lastIdRef.current !== previousLast &&
      anchor !== "bottom" &&
      anchor.offset === "centre" &&
      anchor.id === messageElementId(previousLast)
    ) {
      anchorRef.current = "bottom"
    }

    holdAnchor()
  }, [messages, holdAnchor])

  // An anchored message that isn't loaded yet lives further back in the history.
  useEffect(() => {
    const anchor = anchorRef.current

    if (
      anchor === "bottom" ||
      anchor.offset !== "centre" ||
      document.getElementById(anchor.id)
    ) {
      return
    }

    if (hasOlder) {
      if (!isLoadingOlder) loadOlder()
    } else if (messages.length > 0) {
      anchorRef.current = "bottom"

      holdAnchor()
    }
  }, [messages, targetId, hasOlder, isLoadingOlder, loadOlder, holdAnchor])

  // Highlight the linked message once it is on screen.
  useEffect(() => {
    if (!targetId) return

    const el = document.getElementById(targetId)

    if (!el || el.dataset.highlighted) return

    el.dataset.highlighted = "true"

    el.style.transition = "box-shadow 0.3s ease"

    el.style.boxShadow = "0 0 0 3px var(--mantine-color-blue-4)"

    setTimeout(() => {
      el.style.boxShadow = ""
    }, 2000)
  }, [messages, targetId])

  // Content growing (images loading, a reaction row appearing) or the viewport
  // shrinking (the on-screen keyboard opening) keeps the anchor.
  useEffect(() => {
    const viewport = viewportRef.current

    const content = contentRef.current

    if (!viewport || !content) return

    const observer = new ResizeObserver(holdAnchor)

    observer.observe(content)

    observer.observe(viewport)

    return () => observer.disconnect()
  }, [viewportRef, contentRef, holdAnchor])

  // The reader moves the anchor. A link target only lets go on real input, since
  // our own re-centring fires scroll events too.
  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) return

    const isLinkTarget = (anchor: Anchor) =>
      anchor !== "bottom" && anchor.offset === "centre"

    const releaseTarget = () => {
      if (isLinkTarget(anchorRef.current)) {
        anchorRef.current = readerAnchor() ?? anchorRef.current
      }
    }

    const onScroll = () => {
      if (isLinkTarget(anchorRef.current)) return

      const fromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

      anchorRef.current =
        fromBottom < NEAR_BOTTOM_PX
          ? "bottom"
          : (readerAnchor() ?? anchorRef.current)

      if (viewport.scrollTop < LOAD_OLDER_WITHIN_PX) loadOlderRef.current()
    }

    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const

    inputs.forEach((type) =>
      viewport.addEventListener(type, releaseTarget, { passive: true }),
    )

    viewport.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      inputs.forEach((type) =>
        viewport.removeEventListener(type, releaseTarget),
      )

      viewport.removeEventListener("scroll", onScroll)
    }
  }, [viewportRef, readerAnchor])

  const followBottom = useCallback(() => {
    anchorRef.current = "bottom"

    holdAnchor()
  }, [holdAnchor])

  return { followBottom }
}
