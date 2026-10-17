/**
 * Type-safe entity ID extraction from mutation variables.
 *
 * Moved from `erp/src/lib/utils.ts` so the headless table code owns its
 * dependencies; the old path re-exports this implementation.
 */
export function extractEntityId(variables: unknown): string | undefined {
  if (
    typeof variables === "object" &&
    variables !== null &&
    "id" in variables
  ) {
    const id = (variables as Record<string, unknown>).id
    return typeof id === "string" ? id : undefined
  }
  return undefined
}
