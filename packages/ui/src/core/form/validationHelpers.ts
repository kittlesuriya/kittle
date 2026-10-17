// Validation utilities for form error handling
import type { z } from "zod"
import type { FieldErrors, ValidationResult } from "./types"

/**
 * Normalized error structure
 */
interface NormalizedError {
  path: string
  message: string
}

/**
 * Type guard for Zod error map
 */
function isZodErrorMap(obj: unknown): obj is Record<string, string[]> {
  if (!obj || typeof obj !== "object") return false
  return Object.values(obj).every(
    (val) => Array.isArray(val) && val.every((v) => typeof v === "string")
  )
}

/**
 * Normalize various error formats into consistent structure
 */
export function normalizeError(error: unknown): NormalizedError | null {
  if (!error) return null

  // Already in correct format
  if (
    typeof error === "object" &&
    error !== null &&
    "path" in error &&
    "message" in error &&
    typeof (error as NormalizedError).path === "string" &&
    typeof (error as NormalizedError).message === "string"
  ) {
    return error as NormalizedError
  }

  // String error
  if (typeof error === "string") {
    return { path: "", message: error }
  }

  // Object with message only
  if (typeof error === "object" && error !== null && "message" in error) {
    const msg = error.message
    if (typeof msg === "string") {
      return { path: "", message: msg }
    }
  }

  return null
}

/**
 * Extract unique error messages from array of mixed errors
 */
export function getUniqueErrorMessages(errors: unknown[]): string[] {
  if (!errors?.length) return []

  const seen = new Set<string>()
  const messages: string[] = []

  for (const error of errors) {
    const normalized = normalizeError(error)
    if (normalized && !seen.has(normalized.message)) {
      seen.add(normalized.message)
      messages.push(normalized.message)
    }
  }

  return messages
}

/**
 * Validate data with Zod schema and return structured errors
 */
export function validateWithZod<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data }
  }

  const fieldErrors: FieldErrors = {}
  for (const issue of result.error.issues) {
    const pathKey = issue.path.join(".")
    if (!fieldErrors[pathKey]) {
      fieldErrors[pathKey] = []
    }
    fieldErrors[pathKey].push(issue.message)
  }

  return { success: false, errors: fieldErrors }
}

/**
 * Get errors for a specific field from form errors
 */
export function getFieldErrors(
  formErrors: unknown[],
  fieldName: string
): NormalizedError[] {
  const errors: NormalizedError[] = []

  for (const errorObj of formErrors) {
    if (!errorObj || typeof errorObj !== "object") continue

    // Handle Zod validation map
    if (isZodErrorMap(errorObj)) {
      if (fieldName in errorObj) {
        const messages = errorObj[fieldName]
        if (messages) {
          for (const msg of messages) {
            errors.push({ path: fieldName, message: msg })
          }
        }
      }

      // Nested field match
      for (const key of Object.keys(errorObj)) {
        if (key.startsWith(`${fieldName}.`)) {
          const messages = errorObj[key]
          if (messages) {
            for (const msg of messages) {
              errors.push({ path: key, message: msg })
            }
          }
        }
      }
      continue
    }

    // Handle normalized error objects
    const normalized = normalizeError(errorObj)
    if (normalized) {
      if (
        normalized.path === fieldName ||
        normalized.path.startsWith(`${fieldName}.`)
      ) {
        errors.push(normalized)
      }
    }
  }

  return errors
}
