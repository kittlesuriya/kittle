/**
 * Build a storage key for persisting table state
 */
export function buildStorageKey(title: string, tag: string): string {
  const sanitizedTitle = title.toLowerCase().replace(/\s+/g, "-")
  const sanitizedTag = tag.toLowerCase().replace(/\s+/g, "-")
  return `table-state-${sanitizedTitle}-${sanitizedTag}`
}
