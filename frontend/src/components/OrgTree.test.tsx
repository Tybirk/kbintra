import { describe, it, expect, vi } from "vitest"

import { screen } from "@testing-library/react"

import { render } from "../test/testUtils"

import OrgTree from "./OrgTree"

import type { OrgNode } from "../types"

function node(
  name: string,
  slug: string,
  id: number,
  children: OrgNode[] = [],
): OrgNode {
  return {
    id,
    name,
    slug,
    group_type: "arbejdsgruppe",
    description: "",
    established_on: null,
    expires_on: null,
    is_active: true,
    member_count: 0,
    members: [],
    children,
  }
}

/** The branch from the plan's worked example: Grønt udvalg › Bivenner ›
 * Honninggruppen, with Frugtlunden following Bivenner so there is a guide to
 * carry past the grandchild. */
function tree(): OrgNode[] {
  return [
    node("Grønt udvalg", "groent-udvalg", 1, [
      node("Bivenner", "bivenner", 2, [
        node("Honninggruppen", "honninggruppen", 3),
      ]),
      node("Frugtlunden", "frugtlunden", 4),
    ]),
  ]
}

function renderTree(selectedSlug: string | null = null) {
  const onToggleCollapse = vi.fn()

  render(
    <OrgTree
      nodes={tree()}
      selectedSlug={selectedSlug}
      collapsed={new Set()}
      onToggleCollapse={onToggleCollapse}
    />,
  )

  return { onToggleCollapse }
}

/** Rows are <li>s; the link inside carries the name. */
function rowFor(name: string): HTMLElement {
  const link = screen.getByRole("link", { name: new RegExp(name) })
  const row = link.closest("li")

  if (!row) throw new Error(`no row for ${name}`)

  return row
}

describe("OrgTree rail geometry", () => {
  // PAD 14, STEP 18, INSET 7. These are load-bearing: if they drift, every
  // connector lands an indent level away from the row it belongs to.
  it("indents each depth level by one step", () => {
    renderTree()

    expect(rowFor("Grønt udvalg").style.paddingLeft).toBe("14px")
    expect(rowFor("Bivenner").style.paddingLeft).toBe("32px")
    expect(rowFor("Honninggruppen").style.paddingLeft).toBe("50px")
  })

  it("draws the depth-3 row exactly as the spec's worked example", () => {
    renderTree()

    const row = rowFor("Honninggruppen")

    // One guide, carrying Bivenner's line down to Frugtlunden.
    const rails = row.querySelectorAll(".org-tree-rail")
    expect(rails).toHaveLength(1)
    expect((rails[0] as HTMLElement).style.left).toBe("21px")

    const elbow = row.querySelector(".org-tree-elbow") as HTMLElement
    expect(elbow.style.left).toBe("39px")
  })

  it("gives the last child an elbow but no continuing line", () => {
    renderTree()

    const row = rowFor("Frugtlunden")

    expect(row.querySelector(".org-tree-elbow")).not.toBeNull()
    // Last of its siblings, and its parent is a root, so nothing continues.
    expect(row.querySelectorAll(".org-tree-rail")).toHaveLength(0)
  })

  it("continues a line below a child that has a later sibling", () => {
    renderTree()

    const rails = rowFor("Bivenner").querySelectorAll(".org-tree-rail")

    expect(rails).toHaveLength(1)
    expect((rails[0] as HTMLElement).style.left).toBe("21px")
  })

  it("draws no connector at all on a root row", () => {
    renderTree()

    const row = rowFor("Grønt udvalg")

    expect(row.querySelector(".org-tree-elbow")).toBeNull()
    expect(row.querySelectorAll(".org-tree-rail")).toHaveLength(0)
  })
})

describe("OrgTree rows", () => {
  it("links each group to its own panel URL", () => {
    renderTree()

    expect(
      screen.getByRole("link", { name: /Honninggruppen/ }),
    ).toHaveAttribute("href", "/overblik/honninggruppen")
  })

  it("marks the selected row for assistive tech", () => {
    renderTree("bivenner")

    expect(screen.getByRole("link", { name: /Bivenner/ })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(
      screen.getByRole("link", { name: /Frugtlunden/ }),
    ).not.toHaveAttribute("aria-current")
  })

  it("names the fold control after the branch it folds", () => {
    renderTree()

    // Two separate hit targets per row — the fold button must never be nested
    // inside the link, which would break keyboard activation.
    const fold = screen.getByRole("button", { name: "Fold Bivenner sammen" })

    expect(fold.closest("a")).toBeNull()
    expect(fold).toHaveAttribute("aria-expanded", "true")
  })
})
