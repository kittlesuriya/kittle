// Single choke point for the ABAC → CRUD operator vocabulary mismatch.
//
// The filter UI speaks the ABAC policy vocabulary (modulePolicies
// `conditionFields`: `equals`, `notEquals`, `includesAny`, `before`, …) but
// Kittle list endpoints only accept the CRUD vocabulary
// (`filterInterop.js` OPERATOR_MAP: `eq`, `neq`, `in`, `gt`, `lt`, …).
// Anything sent untranslated 400s with VALIDATION_ERROR / 1001 —
// `filterInterop.normalizeOperator` returns undefined and the predicate
// compiler explicitly rejects `includesAny`/`includesAll`.
//
// Internal QueryBuilder state stays in ABAC vocabulary (so operator dropdowns
// keep working); translate only at the submit/send boundary.

import type { FilterField } from "./types"

/** ABAC policy operator → Kittle list-endpoint operator. */
export const LIST_FILTER_OPERATORS: Record<string, string> = {
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  lessThan: "lt",
  greaterOrEqual: "gte",
  lessOrEqual: "lte",
  includesAny: "in",
  // Scalar list columns have no "match all" semantics; `in` (match any) is
  // the closest valid operator and keeps multiselect filters working instead
  // of 400ing. Array-valued columns are out of scope for list filtering.
  includesAll: "in",
  // List endpoints have no before/after; they are range comparisons.
  before: "lt",
  after: "gt",
}

/** Translate one operator to the list-endpoint vocabulary (idempotent). */
export function translateListOperator(operator: string): string {
  return LIST_FILTER_OPERATORS[operator] ?? operator
}

function displayOperatorForCrudOperator(
  operator: string,
  fieldType?: FilterField["type"]
): string {
  switch (operator) {
    case "eq":
      return "equals"
    case "neq":
      return "notEquals"
    case "in":
      return "includesAny"
    case "gt":
      return fieldType === "date" || fieldType === "time"
        ? "after"
        : "greaterThan"
    case "lt":
      return fieldType === "date" || fieldType === "time"
        ? "before"
        : "lessThan"
    case "gte":
      return "greaterOrEqual"
    case "lte":
      return "lessOrEqual"
    default:
      return operator
  }
}

/**
 * Normalize a possibly-stale persisted/CRUD operator back to the ABAC display
 * vocabulary. Pass-through when the operator is already valid for the field.
 */
export function normalizeDisplayOperator(
  operator: string,
  field?: FilterField
): string {
  if (!operator) return operator
  if (field?.operators.some((op) => op.value === operator)) return operator
  const mapped = displayOperatorForCrudOperator(operator, field?.type)
  if (field?.operators.some((op) => op.value === mapped)) return mapped
  return operator
}

function isFilterGroupNode(value: unknown): value is {
  logic: unknown
  conditions: unknown[]
} {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { conditions?: unknown }).conditions)
  )
}

/**
 * Deep-translate a DataTable FilterState payload to the list-endpoint
 * vocabulary. Idempotent: already-translated payloads pass through unchanged.
 * Used at the send boundary so stale persisted ABAC filters cannot 400.
 */
export function toListFilterPayload<T>(filters: T): T {
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return filters
  if (isFilterGroupNode(filters)) {
    return {
      ...(filters as Record<string, unknown>),
      conditions: filters.conditions.map((c) => toListFilterPayload(c)),
    } as T
  }
  const node = filters as Record<string, unknown>
  if (typeof node.field === "string" && typeof node.operator === "string") {
    return { ...node, operator: translateListOperator(node.operator) } as T
  }
  return filters
}
