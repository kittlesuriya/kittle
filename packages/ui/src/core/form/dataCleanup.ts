// Data cleanup utilities

import type { FormValues } from "./types"

/**
 * Remove internal tracking fields from form data
 */
export function removeInternalFields<T extends FormValues>(data: T): T {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).map((item) =>
      removeInternalFields(item as FormValues)
    ) as unknown as T
  }

  if (typeof data === "object") {
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (key === "__localId") {
        continue
      }
      cleaned[key] = removeInternalFields(value as FormValues)
    }
    return cleaned as T
  }

  return data
}
