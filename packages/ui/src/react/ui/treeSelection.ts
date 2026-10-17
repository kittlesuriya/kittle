/**
 * Pure tree-selection helpers behind MultiSelect's opt-in cascade (and the
 * path picker's depth indent). No React, no DOM — every rule below is pinned
 * by `treeSelection.test.ts` instead of by browser proofs.
 *
 * The invariant: a selected parent always means its WHOLE subtree. Checking
 * a parent completes it; unchecking drops it plus any ancestor it breaks.
 * A parent that is unselected with a selected descendant renders the
 * indeterminate mark; clicking it completes the subtree.
 */

/** Check/uncheck expansion for one toggle interaction. */
export function cascadeToggle<T extends string | number>(
  prev: T[],
  next: T[],
  getDescendants: (value: T) => T[]
): T[] {
  const key = (v: T) => String(v)
  const prevSet = new Set(prev.map(key))
  const added = next.filter((v) => !prevSet.has(key(v)))
  const removed = prev.filter((v) => !next.some((n) => key(n) === key(v)))
  let expanded = next
  if (added.length > 0) {
    // Check: append each added node's missing descendants right after it,
    // in tree order, so a picked subtree stays contiguous in the saved
    // sequence. Bulk checks (notably Select All) hand over ancestors and
    // descendants together, so values already emitted — as a pick or as
    // someone's descendant — are skipped instead of pushed twice.
    const seen = new Set(prevSet)
    const emitted = new Set<string>()
    const out: T[] = []
    for (const v of next) {
      if (emitted.has(key(v))) continue
      out.push(v)
      emitted.add(key(v))
      if (added.some((a) => key(a) === key(v))) {
        for (const d of getDescendants(v)) {
          if (!seen.has(key(d)) && !emitted.has(key(d))) {
            seen.add(key(d))
            emitted.add(key(d))
            out.push(d)
          }
        }
      }
    }
    expanded = out
  }
  if (added.length === 0 && removed.length === 0) return [...next]
  // Ancestor repair, both branches: a selected parent always means its
  // WHOLE subtree, so any kept ancestor with a missing descendant goes —
  // but only the ancestors themselves, never their kept descendants
  // (siblings the user never touched stay selected). Single pass:
  // `getDescendants` is transitive, so every broken ancestor sees its own
  // missing descendant directly.
  const drop = new Set<string>()
  for (const v of removed) {
    drop.add(key(v))
    for (const d of getDescendants(v)) drop.add(key(d))
  }
  const keptSet = new Set(expanded.filter((v) => !drop.has(key(v))).map(key))
  for (const v of expanded) {
    if (
      !drop.has(key(v)) &&
      getDescendants(v).some((d) => !keptSet.has(key(d)))
    ) {
      drop.add(key(v))
    }
  }
  return expanded.filter((v) => !drop.has(key(v)))
}

/**
 * Unselected values with a selected descendant — the indeterminate set.
 * Selected parents never appear here (their check mark already communicates
 * membership); clicking a partial parent completes its subtree.
 */
export function partialSelected<T extends string | number>(
  selected: T[],
  candidates: T[],
  getDescendants: (value: T) => T[]
): Set<string> {
  const sel = new Set(selected.map(String))
  const partial = new Set<string>()
  for (const c of candidates) {
    const k = String(c)
    if (sel.has(k)) continue
    if (getDescendants(c).some((d) => sel.has(String(d)))) {
      partial.add(k)
    }
  }
  return partial
}

/**
 * Depth from a parent chain. `getParent` returns the parent id, `null` for a
 * known root, and `undefined` for an id outside the map. Missing parents,
 * cross-tree links and cycles collapse toward 0 instead of looping — a bad
 * edge degrades one row's indent, never the render. Capped at `maxDepth`.
 */
export function depthOf(
  id: string,
  getParent: (id: string) => string | null | undefined,
  maxDepth = 25
): number {
  let depth = 0
  let current = getParent(id)
  const seen = new Set<string>([id])
  while (current && !seen.has(current) && depth < maxDepth) {
    // Unknown id (not a root, just absent): dangling edge, don't count it.
    if (getParent(current) === undefined) break
    seen.add(current)
    depth += 1
    current = getParent(current)
  }
  return depth
}
