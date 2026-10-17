import { useMemo, useEffect } from "react"
import {
  validateOperationsConfig,
  type ValidationResult,
} from "./validateOperation"
import type { OperationsConfig } from "./types"

interface UseValidatedOperationsOptions<TData> {
  operations?: OperationsConfig<TData>
  mode?: "strict" | "priority"
  onError?: (errors: Map<string, ValidationResult>) => void
}

/**
 * Hook to validate operations config and log errors/warnings
 */
export function useValidatedOperations<TData>({
  operations,
  mode = "strict",
  onError,
}: UseValidatedOperationsOptions<TData>) {
  const validationResults = useMemo(() => {
    if (!operations) return new Map<string, ValidationResult>()
    return validateOperationsConfig(operations, mode)
  }, [operations, mode])

  const hasErrors = useMemo(() => {
    return Array.from(validationResults.values()).some(
      (result) => !result.isValid
    )
  }, [validationResults])

  // Log validation results in development
  useEffect(() => {
    if (!import.meta.env?.DEV) return

    validationResults.forEach((result, key) => {
      // Log errors
      if (result.errors.length > 0) {
        console.error(`[DataTable Operation Error] "${key}":`, result.errors)
      }

      // Log warnings
      if (result.warnings.length > 0) {
        console.warn(`[DataTable Operation Warning] "${key}":`, result.warnings)
      }
    })

    // Call error callback if provided
    if (hasErrors && onError) {
      const errorResults = new Map(
        Array.from(validationResults.entries()).filter(
          (entry) => !entry[1].isValid
        )
      )
      onError(errorResults)
    }
  }, [validationResults, hasErrors, onError])

  return {
    validationResults,
    hasErrors,
    // Helper to get valid operations
    getValidOperations: () => {
      return Array.from(validationResults.entries())
        .filter((entry) => entry[1].isValid)
        .map(([key]) => key)
    },
  }
}
