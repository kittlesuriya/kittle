/**
 * Canonical order for the row-actions menu.
 *
 * `RowActions` renders `Object.entries(operations)`, i.e. whatever order a
 * page happened to declare, so custom operations landed wherever they were
 * written — before View/Edit on the Learning Design pages, and after Delete
 * on SMS Templates (`view, edit, delete, add, preview, testSend`). Pages
 * cannot be relied on to get this right, so the rule lives here:
 *
 *   View -> Edit -> everything else (declaration order) -> Delete
 *
 * The comparator returns 0 for a tie and `Array.prototype.sort` is stable,
 * so operations of the same rank keep their declaration order. `add` is a
 * table-level operation and never reaches the menu.
 */
export function rankRowOperation(operationKey: string): number {
  if (operationKey === "view") return 1
  if (operationKey === "edit") return 2
  if (operationKey === "delete") return 4
  return 3
}

export function sortRowOperations<T>(
  entries: ReadonlyArray<readonly [string, T]>
): Array<readonly [string, T]> {
  return [...entries].sort(
    (a, b) => rankRowOperation(a[0]) - rankRowOperation(b[0])
  )
}
