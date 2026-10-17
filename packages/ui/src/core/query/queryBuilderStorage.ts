// localStorage key management for QueryBuilder persistence.
//
// Keys are scoped per page: `{prefix}{pathname}::{schemaSignature}`. Reset
// flows (e.g. DataTable Retry) must clear only the current page's entries —
// never a blanket `localStorage.clear()`, which would wipe every other
// page's drafts and table state.

export const FILTER_MODE_STORAGE_PREFIX = "query-builder-mode:"
export const FILTER_STATE_STORAGE_PREFIX = "query-builder-state:"

function scopePrefix(prefix: string, pathname: string): string {
  return `${prefix}${pathname}::`
}

/**
 * Remove this page's QueryBuilder entries (`state` + `mode`) from
 * localStorage. Scoped to `pathname` (defaults to the current location) so
 * other pages are untouched. Safe to call when nothing is stored.
 */
export function clearQueryBuilderStorageForPath(pathname?: string): void {
  if (typeof window === "undefined") return
  const path =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "global")
  const prefixes = [
    FILTER_STATE_STORAGE_PREFIX,
    FILTER_MODE_STORAGE_PREFIX,
  ].map((prefix) => scopePrefix(prefix, path))
  const victims: string[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      victims.push(key)
    }
  }
  for (const key of victims) {
    window.localStorage.removeItem(key)
  }
}
