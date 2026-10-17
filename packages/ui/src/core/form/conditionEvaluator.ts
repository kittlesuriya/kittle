// Condition evaluation for field visibility

import { getByPath } from "./pathUtils"
import type { VisibilityCondition, FormValues } from "./types"

/**
 * Evaluate a single condition against form values
 */
export function evaluateCondition(
  condition: VisibilityCondition,
  values: FormValues
): boolean {
  const fieldValue = getByPath(values, condition.field)

  switch (condition.operator) {
    case "equals":
      return fieldValue === condition.value

    case "notEquals":
      return fieldValue !== condition.value

    case "contains":
      if (typeof fieldValue === "string") {
        return fieldValue.includes(String(condition.value))
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value)
      }
      return false

    case "notContains":
      if (typeof fieldValue === "string") {
        return !fieldValue.includes(String(condition.value))
      }
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(condition.value)
      }
      return false

    case "greaterThan": {
      const gtValue = Number(fieldValue)
      const gtCompare = Number(condition.value)
      return !isNaN(gtValue) && !isNaN(gtCompare) && gtValue > gtCompare
    }

    case "lessThan": {
      const ltValue = Number(fieldValue)
      const ltCompare = Number(condition.value)
      return !isNaN(ltValue) && !isNaN(ltCompare) && ltValue < ltCompare
    }

    default:
      return false
  }
}

/**
 * Evaluate multiple conditions (all must be true)
 */
export function evaluateConditions(
  conditions: VisibilityCondition | VisibilityCondition[] | undefined,
  values: FormValues
): boolean {
  if (!conditions) return true

  const conditionArray = Array.isArray(conditions) ? conditions : [conditions]
  return conditionArray.every((condition) =>
    evaluateCondition(condition, values)
  )
}

/**
 * Check if a field should be visible
 */
export function isFieldVisible(
  _fieldName: string,
  visibleWhen: VisibilityCondition | VisibilityCondition[] | undefined,
  values: FormValues
): boolean {
  if (!visibleWhen) return true
  return evaluateConditions(visibleWhen, values)
}
