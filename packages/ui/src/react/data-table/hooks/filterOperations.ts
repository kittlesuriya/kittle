import type { AbilityLike } from "../../../core/runtime"
import type { OperationsConfig } from "../../../core/table/types"

/**
 * Map operation type to CASL action
 */
export function getActionForOperation(
  operationType: string
): string | undefined {
  switch (operationType) {
    case "add":
      return "create"
    case "view":
      return "view"
    case "edit":
    case "complete":
    case "dismiss":
    case "cancel":
      return "update"
    case "delete":
      return "delete"
    case "download":
    case "print":
      return "export"
    default:
      return undefined
  }
}

/**
 * Filter operations based on CASL ability.
 *
 * Structural `AbilityLike` port: the app's CASL `AppAbility` satisfies it
 * directly (method-syntax bivariance), so no narrowing casts are needed.
 */
export function filterOperationsByAbility<TData>(
  operations: OperationsConfig<TData> | undefined,
  ability: AbilityLike,
  subject: string | undefined
): OperationsConfig<TData> | undefined {
  if (!operations || !subject) return operations

  const filteredEntries = Object.entries(operations).filter(
    ([key, operation]) => {
      if (!operation) return false

      const action = operation.permissionAction ?? getActionForOperation(key)
      if (!action) return true

      const resolvedSubject = operation.permissionSubject ?? subject

      return ability.can(action, resolvedSubject)
    }
  )

  if (filteredEntries.length === 0) return undefined

  return Object.fromEntries(filteredEntries)
}

/**
 * Filter exports based on CASL ability
 */
export function filterExportsByAbility(
  exportsConfig: unknown,
  ability: AbilityLike,
  subject: string | undefined
): unknown {
  if (!exportsConfig) return undefined
  if (!subject) return exportsConfig
  if (!ability.can("export", subject)) return undefined
  return exportsConfig
}
