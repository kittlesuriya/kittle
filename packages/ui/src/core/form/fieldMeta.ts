// Field metadata builder utilities
import type { VisibilityCondition } from "./types"

/**
 * Field metadata for use with z.describe()
 */
interface FieldMetadata {
  label?: string
  helpTitle?: string
  helpDescription?: string
  helpBullets?: string[]
  helpExample?: string
  placeholder?: string
  colSpan?: number
  order?: number
  inputType?: string
  options?: Array<{ label: string; value: string | number }>
  visibleWhen?: VisibilityCondition | VisibilityCondition[]
  hidden?: boolean
  [key: string]: unknown
}

/**
 * Type-safe metadata builder for field configuration
 * Usage: z.string().describe(fieldMeta({ label: "Email", colSpan: 6 }))
 */
export function fieldMeta(metadata: FieldMetadata): string {
  return JSON.stringify(metadata)
}

/**
 * Condition builder helpers for better DX
 */
export const when = {
  equals: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "equals",
    value,
  }),
  notEquals: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "notEquals",
    value,
  }),
  contains: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "contains",
    value,
  }),
  notContains: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "notContains",
    value,
  }),
  greaterThan: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "greaterThan",
    value,
  }),
  lessThan: (field: string, value: unknown): VisibilityCondition => ({
    field,
    operator: "lessThan",
    value,
  }),
}
