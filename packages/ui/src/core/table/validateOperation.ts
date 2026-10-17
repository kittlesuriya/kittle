import type { BaseOperationConfig } from "./types"

export interface ValidationResult {
  isValid: boolean
  executionType: "component" | "api" | "handler" | "none"
  errors: string[]
  warnings: string[]
}

/**
 * Validates operation config and determines execution type
 */
export function validateOperation<TData>(
  operationKey: string,
  operation: BaseOperationConfig<TData> | undefined,
  mode: "strict" | "priority" = "strict"
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    executionType: "none",
    errors: [],
    warnings: [],
  }

  if (!operation) {
    // If operation is undefined, it's just not configured. That's valid but "none".
    // But caller usually checks if operation exists before validating?
    // This function handles undefined gracefully.
    return result
  }

  const hasComponent = Boolean(operation.component)
  const hasApi = Boolean(operation.api)
  const hasHandler = Boolean(operation.handler)

  const count = [hasComponent, hasApi, hasHandler].filter(Boolean).length

  // No execution method provided
  if (count === 0) {
    result.isValid = false
    result.errors.push(
      `Operation "${operationKey}" has no execution method. ` +
        `Provide one of: component, api, or handler.`
    )
    return result
  }

  // Multiple execution methods provided
  if (count > 1) {
    const methods = [
      hasComponent && "component",
      hasApi && "api",
      hasHandler && "handler",
    ].filter(Boolean)

    if (mode === "strict") {
      // STRICT MODE: Block execution
      result.isValid = false
      result.errors.push(
        `Operation "${operationKey}" has multiple execution methods: ${methods.join(", ")}. ` +
          `Only ONE of component, api, or handler should be provided.`
      )
      return result
    } else {
      // PRIORITY MODE: Use priority order (component > api > handler)
      result.warnings.push(
        `Operation "${operationKey}" has multiple execution methods: ${methods.join(", ")}. ` +
          `Using priority order: component > api > handler.`
      )

      if (hasComponent) {
        result.executionType = "component"
      } else if (hasApi) {
        result.executionType = "api"
      } else {
        result.executionType = "handler"
      }

      // Still valid in priority mode
      return result
    }
  }

  // Single execution method provided - identify & validate specifics
  if (hasComponent) {
    result.executionType = "component"
  } else if (hasApi) {
    result.executionType = "api"

    // Validate API config
    if (!operation.api?.endpoint) {
      result.isValid = false
      result.errors.push(`Operation "${operationKey}" api.endpoint is required`)
    }
    if (!operation.api?.key) {
      result.isValid = false
      result.errors.push(
        `Operation "${operationKey}" api.key is required for cache invalidation`
      )
    }
  } else if (hasHandler) {
    result.executionType = "handler"
  }

  return result
}

/**
 * Validates all operations in config
 */
export function validateOperationsConfig<TData>(
  operations: Record<string, BaseOperationConfig<TData> | undefined>,
  mode: "strict" | "priority" = "strict"
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>()

  Object.entries(operations).forEach(([key, operation]) => {
    if (operation) {
      const result = validateOperation(key, operation, mode)
      results.set(key, result)
    }
  })

  return results
}
