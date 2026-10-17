/**
 * Render an arbitrary table/query value as display text.
 *
 * Mirrors `String(value)` for primitives and arrays, but returns an empty
 * string for objects so an accidental `[object Object]` never reaches the UI.
 */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }
  if (Array.isArray(value)) return value.map(toDisplayString).join(",")
  return ""
}
