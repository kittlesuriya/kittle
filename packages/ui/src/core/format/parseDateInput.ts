/**
 * Parses a YYYY-MM-DD date-only string or ISO string or Date object into a JS
 * Date object without timezone shift for date-only strings.
 *
 * Moved from erp/src/lib/format/formatDate.ts; the app re-exports it so
 * existing import sites keep working.
 */
export function parseDateInput(
  input: string | Date | null | undefined
): Date | null {
  if (input == null || input === "") return null
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input
  }

  if (typeof input === "string") {
    const trimmed = input.trim()
    if (!trimmed) return null

    // Match YYYY-MM-DD or YYYY/MM/DD
    const dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed)
    if (dateOnlyMatch) {
      const year = parseInt(dateOnlyMatch[1] ?? "", 10)
      const month = parseInt(dateOnlyMatch[2] ?? "", 10) - 1
      const day = parseInt(dateOnlyMatch[3] ?? "", 10)
      // Noon local time avoids DST boundary shifts
      const d = new Date(year, month, day, 12, 0, 0, 0)
      return isNaN(d.getTime()) ? null : d
    }

    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? null : d
  }

  return null
}
