import type { OperationsConfig } from "./types"

/**
 * Granular operation permissions format
 * Key: moduleKey (e.g., "tenant.branches")
 * Value: array of allowed operation keys (e.g., ["view", "edit", "delete"])
 */
export type GranularPermissions = Record<string, string[]>

/**
 * Filter operations based on granular permission map
 *
 * @param operations - All configured operations
 * @param allowedOps - Array of allowed operation keys from server
 * @returns Filtered operations config with only allowed operations
 */
export function filterOperationsByGranular<TData>(
  operations: OperationsConfig<TData> | undefined,
  allowedOps: string[] | undefined
): OperationsConfig<TData> | undefined {
  if (!operations) return operations
  if (!allowedOps || allowedOps.length === 0) return undefined

  const filteredEntries = Object.entries(operations).filter(
    ([key, operation]) => {
      const permissionKey = operation?.permissionKey ?? key
      return allowedOps.includes(permissionKey)
    }
  )

  if (filteredEntries.length === 0) return undefined

  return Object.fromEntries(filteredEntries)
}

/**
 * Check if operation is allowed in granular permissions
 */
export function isOperationAllowed(
  operationKey: string,
  allowedOps: string[] | undefined
): boolean {
  if (!allowedOps || allowedOps.length === 0) return false
  return allowedOps.includes(operationKey)
}
