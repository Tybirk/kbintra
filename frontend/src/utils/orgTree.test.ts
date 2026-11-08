import { describe, it, expect } from "vitest"

import {
  findNodeBySlug,
  flattenForDisplay,
  flattenOrgTree,
  mandatePath,
} from "./orgTree"

import type { OrgNode } from "../types"

function node(
  name: string,
  slug: string,
  children: OrgNode[] = [],
  id = slug.length,
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

/** Mirrors the shape that makes the rails interesting: a root whose first child
 * has a later sibling, and a grandchild under that first child. */
function sampleTree(): OrgNode[] {
  return [
    node("Bestyrelsen", "bestyrelsen", [], 1),
    node(
      "Grønt udvalg",
      "groent-udvalg",
      [
        node(
          "Bivenner",
          "bivenner",
          [node("Honninggruppen", "honninggruppen", [], 4)],
          3,
        ),
        node("Frugtlunden", "frugtlunden", [], 5),
      ],
      2,
    ),
  ]
}

describe("findNodeBySlug", () => {
  it("finds a node nested three levels down", () => {
    expect(findNodeBySlug(sampleTree(), "honninggruppen")?.name).toBe(
      "Honninggruppen",
    )
  })

  it("returns null for a slug that isn't in the tree", () => {
    expect(findNodeBySlug(sampleTree(), "findes-ikke")).toBeNull()
  })
})

describe("mandatePath", () => {
  it("lists the ancestors root first, excluding the group itself", () => {
    expect(
      mandatePath(sampleTree(), "honninggruppen").map((n) => n.name),
    ).toEqual(["Grønt udvalg", "Bivenner"])
  })

  it("is empty for a root, which has no mandate above it", () => {
    expect(mandatePath(sampleTree(), "bestyrelsen")).toEqual([])
  })

  it("is empty for an unknown slug rather than throwing", () => {
    expect(mandatePath(sampleTree(), "findes-ikke")).toEqual([])
  })
})

describe("flattenForDisplay", () => {
  it("keeps ancestorHasNext exactly one shorter than the depth", () => {
    // Roots draw no connector of their own, so they contribute no guide. Every
    // rail's x position is derived from this offset; if it drifts, the whole
    // tree's lines land one indent level off.
    for (const row of flattenForDisplay(sampleTree(), new Set())) {
      expect(row.ancestorHasNext).toHaveLength(Math.max(0, row.depth - 1))
    }
  })

  it("carries a guide past a grandchild whose parent has a later sibling", () => {
    const rows = flattenForDisplay(sampleTree(), new Set())

    // Honninggruppen sits under Bivenner, and Bivenner is followed by
    // Frugtlunden — so Bivenner's line has to keep running past this row.
    const honning = rows.find((r) => r.node.slug === "honninggruppen")
    expect(honning).toMatchObject({
      depth: 2,
      isLast: true,
      ancestorHasNext: [true],
    })
  })

  it("drops no guide when the parent is the last of its siblings", () => {
    const tree = [
      node("Grønt udvalg", "groent-udvalg", [
        node("Bivenner", "bivenner", [node("Honninggruppen", "honning")]),
      ]),
    ]

    expect(
      flattenForDisplay(tree, new Set()).find((r) => r.node.slug === "honning")
        ?.ancestorHasNext,
    ).toEqual([false])
  })

  it("marks only the final sibling as last", () => {
    const rows = flattenForDisplay(sampleTree(), new Set())

    expect(
      rows.filter((r) => r.depth === 0).map((r) => [r.node.slug, r.isLast]),
    ).toEqual([
      ["bestyrelsen", false],
      ["groent-udvalg", true],
    ])
  })

  it("skips the children of a collapsed node but keeps the node itself", () => {
    const rows = flattenForDisplay(sampleTree(), new Set([2]))

    expect(rows.map((r) => r.node.slug)).toEqual([
      "bestyrelsen",
      "groent-udvalg",
    ])
  })
})

describe("flattenOrgTree", () => {
  it("still indents parent options by depth", () => {
    expect(flattenOrgTree(sampleTree()).map((o) => o.label)).toEqual([
      "Bestyrelsen",
      "Grønt udvalg",
      "  Bivenner",
      "    Honninggruppen",
      "  Frugtlunden",
    ])
  })
})
