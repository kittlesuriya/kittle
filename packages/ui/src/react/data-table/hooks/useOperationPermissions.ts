import { useMemo } from "react"
import type { AbilityLike } from "../../../core/runtime"
import {
  filterOperationsByGranular,
  type GranularPermissions,
} from "../../../core/table/granularPermissions"
import { filterOperationsByAbility } from "./filterOperations"
import type { OperationsConfig } from "../../../core/table/types"

interface UseOperationPermissionsParams<TData> {
  operations: OperationsConfig<TData> | undefined
  moduleKey: string | undefined
  subject: string | undefined
  ability: AbilityLike
  granularPermissions: GranularPermissions | undefined
}

interface UseOperationPermissionsReturn<TData> {
  resolvedOperations: OperationsConfig<TData> | undefined
  permissionSource: "granular" | "casl" | "none"
}

/**
 * Hook to resolve operations with support for both granular and CASL permissions
 *
 * Priority:
 * 1. Granular permissions (if provided for this moduleKey)
 * 2. CASL ability checks (fallback)
 * 3. No permissions (returns undefined)
 */
export function useOperationPermissions<TData>({
  operations,
  moduleKey,
  subject,
  ability,
  granularPermissions,
}: UseOperationPermissionsParams<TData>): UseOperationPermissionsReturn<TData> {
  return useMemo(() => {
    // If no operations configured, return early
    if (!operations) {
      return { resolvedOperations: undefined, permissionSource: "none" }
    }

    if (granularPermissions) {
      const filteredEntries = Object.entries(operations).filter(
        ([key, operation]) => {
          if (!operation) return false
          const targetModuleKey = operation.permissionModuleKey ?? moduleKey
          if (!targetModuleKey) return false

          const allowedOps = granularPermissions[targetModuleKey]
          if (!allowedOps) return false

          const permissionKey = operation.permissionKey ?? key
          return allowedOps.includes(permissionKey)
        }
      )

      const hasGranularContext =
        (!!moduleKey && !!granularPermissions[moduleKey]) ||
        Object.values(operations).some((operation) => {
          const targetModuleKey = operation?.permissionModuleKey
          return !!targetModuleKey && !!granularPermissions[targetModuleKey]
        })

      if (hasGranularContext) {
        return {
          resolvedOperations:
            filteredEntries.length > 0
              ? Object.fromEntries(filteredEntries)
              : undefined,
          permissionSource: "granular",
        }
      }

      if (moduleKey && granularPermissions[moduleKey]) {
        const allowedOps = granularPermissions[moduleKey]
        const filtered = filterOperationsByGranular(operations, allowedOps)
        return {
          resolvedOperations: filtered,
          permissionSource: "granular",
        }
      }
    }

    // Fallback to CASL ability checks
    if (subject) {
      const filtered = filterOperationsByAbility(operations, ability, subject)
      return {
        resolvedOperations: filtered,
        permissionSource: "casl",
      }
    }

    // No permissions available
    return { resolvedOperations: undefined, permissionSource: "none" }
  }, [operations, moduleKey, subject, ability, granularPermissions])
}
