import { describe, expect, it } from "vitest"
import { cascadeToggle, depthOf, partialSelected } from "./treeSelection"

// Tree under test (ids mirror the path picker shape):
//   root
//   ├─ a
//   │  └─ a1
//   └─ b
// orphan (parent id points nowhere)
const CHILDREN: Record<string, string[]> = {
  root: ["a", "b"],
  a: ["a1"],
  b: [],
  a1: [],
  orphan: [],
}
const PARENTS: Record<string, string | null> = {
  root: null,
  a: "root",
  a1: "a",
  b: "root",
  orphan: "missing",
}
const getDescendants = (v: string): string[] => {
  // Depth-first pre-order, mirroring the picker's own closure: a picked
  // subtree stays contiguous in the saved sequence.
  const out: string[] = []
  const seen = new Set([v])
  const stack = [...(CHILDREN[v] ?? [])].reverse()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    const next = CHILDREN[cur] ?? []
    for (let i = next.length - 1; i >= 0; i--) {
      const child = next[i]
      if (child !== undefined) stack.push(child)
    }
  }
  return out
}

describe("cascadeToggle", () => {
  it("checking a parent appends its whole subtree in tree order", () => {
    expect(cascadeToggle([], ["root"], getDescendants)).toEqual([
      "root",
      "a",
      "a1",
      "b",
    ])
  })

  it("checking a mid-tree node appends only its own subtree", () => {
    expect(cascadeToggle([], ["a"], getDescendants)).toEqual(["a", "a1"])
  })

  it("checking a leaf changes nothing beyond the leaf", () => {
    expect(
      cascadeToggle(
        ["root", "a", "b"],
        ["root", "a", "b", "a1"],
        getDescendants
      )
    ).toEqual(["root", "a", "b", "a1"])
  })

  it("keeps pre-existing order and skips already-present descendants", () => {
    // b picked first, then the parent: parent slots in where clicked, only
    // the missing descendants append after it.
    expect(cascadeToggle(["b"], ["b", "root"], getDescendants)).toEqual([
      "b",
      "root",
      "a",
      "a1",
    ])
  })

  it("unchecking a parent drops the whole subtree", () => {
    expect(
      cascadeToggle(["root", "a", "a1", "b"], ["a", "a1", "b"], getDescendants)
    ).toEqual([])
  })

  it("unchecking one child drops the broken ancestors but keeps siblings", () => {
    // Removing a1 breaks a (and transitively root); b and its clean state
    // stay exactly as they were.
    expect(
      cascadeToggle(
        ["root", "a", "a1", "b"],
        ["root", "a", "b"],
        getDescendants
      )
    ).toEqual(["b"])
  })

  it("unchecking a mid-tree node drops it, its subtree and its ancestors", () => {
    expect(
      cascadeToggle(["root", "a", "a1"], ["root", "a1"], getDescendants)
    ).toEqual([])
  })

  it("is a no-op when nothing changed and never mutates inputs", () => {
    const prev = ["a", "a1"]
    const next = ["a", "a1"]
    const out = cascadeToggle(prev, next, getDescendants)
    expect(out).toEqual(["a", "a1"])
    expect(out).not.toBe(next)
    expect(prev).toEqual(["a", "a1"])
  })

  it("supports numeric values without collapsing types", () => {
    const out = cascadeToggle<number>([], [7], (v) => (v === 7 ? [8] : []))
    expect(out).toEqual([7, 8])
  })

  it("emits each node once when a bulk check hands over ancestors and descendants together", () => {
    // Select All in a cascade picker passes every in-scope value at once;
    // without the emitted-set each child lands twice (once as a pick, once
    // as its parent's descendant) and the submit guard sees duplicates.
    expect(cascadeToggle([], ["root", "a", "a1", "b"], getDescendants)).toEqual(
      ["root", "a", "a1", "b"]
    )
  })

  it("keeps bulk-check order and still completes partial subtrees", () => {
    // Child first, then the parent: the missing sibling appends after the
    // parent without duplicating the already-picked child.
    expect(cascadeToggle(["b"], ["b", "root"], getDescendants)).toEqual([
      "b",
      "root",
      "a",
      "a1",
    ])
    expect(cascadeToggle([], ["a", "root"], getDescendants)).toEqual([
      "a",
      "a1",
      "root",
      "b",
    ])
  })
})

describe("partialSelected", () => {
  it("marks an unselected parent with a selected descendant", () => {
    expect(partialSelected(["a1"], ["root", "a", "b"], getDescendants)).toEqual(
      new Set(["root", "a"])
    )
  })

  it("never marks selected parents or untouched branches", () => {
    expect(
      partialSelected(
        ["root", "a", "a1", "b"],
        ["root", "a", "b"],
        getDescendants
      )
    ).toEqual(new Set())
  })

  it("is empty without cascade data", () => {
    expect(partialSelected(["a1"], ["root"], () => [])).toEqual(new Set())
  })
})

describe("depthOf", () => {
  // Note: `?? null` would collapse the dangling-pointer signal the
  // implementation reads — unknown ids must surface as `undefined`.
  const getParent = (id: string) => (id in PARENTS ? PARENTS[id] : undefined)

  it("returns 0 for roots", () => {
    expect(depthOf("root", getParent)).toBe(0)
  })

  it("walks the full chain, not just one level", () => {
    expect(depthOf("a1", getParent)).toBe(2)
    expect(depthOf("a", getParent)).toBe(1)
  })

  it("collapses missing parents to 0 instead of counting ghosts", () => {
    expect(depthOf("orphan", getParent)).toBe(0)
    expect(depthOf("nope", getParent)).toBe(0)
  })

  it("cannot loop on cycles", () => {
    const cyclic = (id: string) => (id === "x" ? "y" : id === "y" ? "x" : null)
    expect(depthOf("x", cyclic)).toBeLessThanOrEqual(25)
  })

  it("respects a custom cap", () => {
    const chain = (id: string) => `p-${id}`
    expect(depthOf("leaf", chain, 3)).toBe(3)
  })
})
