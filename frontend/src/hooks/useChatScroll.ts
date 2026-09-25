import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import type { RefObject } from "react"

import type { Message } from "../types"

/**
 * Scrolling for a chat, as one rule: the view holds on to an anchor, and only
 * the reader moves it.
 *
 * - `"bottom"`: the reader is at the newest message; the view stays there while
 *   content grows (new messages, images finishing loading).
 * - an element id: opened from a link to one message; the view keeps it centred
 *   while the page settles, loading older pages until it exists.
 * - `null`: the reader has scrolled into the history; nothing moves the view.
 *   A prepended older page keeps the reader's place.
 *
 * Changes to existing messages (reactions, edits, read receipts) never scroll.
 * Every jump is instant — no animation to sit through in a long conversation.
 */

type Anchor = "bottom" | string | null

const NEAR_BOTTOM_PX = 40

const LOAD_OLDER_WITHIN_PX = 300

/** Ids of the oldest and newest loaded message. */
interface ListEdges {
  first?: number

  last?: number
}

interface ChatScrollOptions {
  messages: Message[]

  hasOlder: boolean

  isLoadingOlder: boolean

  loadOlder: () => void

  /** Element id of a message to open at, e.g. "msg-123". */
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
  const anchorRef = useRef<Anchor>(targetId ?? "bottom")

  const heightRef = useRef(0)

  const edgesRef = useRef<ListEdges>({})

  const loadOlderRef = useRef<() => void>(() => {})

  loadOlderRef.current = hasOlder && !isLoadingOlder ? loadOlder : () => {}

  const holdAnchor = useCallback(() => {
    const viewport = viewportRef.current

    const anchor = anchorRef.current

    if (!viewport) return

    const el = anchor && anchor !== "bottom" && document.getElementById(anchor)

    if (anchor === "bottom") {
      viewport.scrollTop = viewport.scrollHeight
    } else if (el) {
      // Scroll the viewport only; scrollIntoView would also scroll the page around it.
      const offset =
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top

      viewport.scrollTop +=
        offset - (viewport.clientHeight - el.offsetHeight) / 2
    }

    heightRef.current = viewport.scrollHeight
  }, [viewportRef])

  // A new link target in the same conversation (e.g. a second notification).
  useEffect(() => {
    if (!targetId) return

    anchorRef.current = targetId

    holdAnchor()
  }, [targetId, holdAnchor])

  // Messages changed: tell apart an older page, a new message and an edit.
  useLayoutEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) return

    const first = messages[0]?.id

    const last = messages.at(-1)?.id

    const prev = edgesRef.current

    edgesRef.current = { first, last }

    if (anchorRef.current === null) {
      if (
        prev.first !== undefined &&
        first !== prev.first &&
        last === prev.last
      ) {
        viewport.scrollTop += viewport.scrollHeight - heightRef.current
      } else if (last !== prev.last && messages.at(-1)?.is_own) {
        // Your own message just went out: follow it.
        anchorRef.current = "bottom"
      }
    }

    holdAnchor()
  }, [messages, viewportRef, holdAnchor])

  // An anchored message that isn't loaded yet lives further back in the history.
  useEffect(() => {
    const anchor = anchorRef.current

    if (!anchor || anchor === "bottom" || document.getElementById(anchor)) {
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

    const releaseTarget = () => {
      if (anchorRef.current !== "bottom") anchorRef.current = null
    }

    const onScroll = () => {
      const anchor = anchorRef.current

      if (anchor && anchor !== "bottom") return

      const fromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

      anchorRef.current = fromBottom < NEAR_BOTTOM_PX ? "bottom" : null

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
  }, [viewportRef])
}
